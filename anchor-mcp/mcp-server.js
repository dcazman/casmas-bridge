import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const PORT = 8000;
const ANCHOR_URL = process.env.ANCHOR_URL || 'http://192.168.50.23:7778';
const MCP_TOKEN = process.env.MCP_TOKEN;

if (!MCP_TOKEN) { console.error('FATAL: MCP_TOKEN not set'); process.exit(1); }

// ── Caller identity from token ─────────────────────────────────
// Tokens encode who the caller is so Anchor can filter accordingly
// Format: <caller>:<secret>  e.g. "personal:abc123" or "work:xyz789"
// Store multiple tokens as comma-separated: "personal:abc,work:xyz"
const TOKENS = {};
MCP_TOKEN.split(',').forEach(entry => {
  const [caller, secret] = entry.trim().split(':');
  if (caller && secret) TOKENS[secret] = caller;
});

function identifyCaller(token) {
  return TOKENS[token] || null;
}

// ── Auth middleware ────────────────────────────────────────────
function authCheck(req, res, next) {
  const token = req.headers['x-anchor-token'] || req.headers['authorization']?.replace('Bearer ', '') || req.query.token;
  const caller = identifyCaller(token);
  if (!caller) return res.status(401).json({ error: 'Unauthorized' });
  req.caller = caller;
  next();
}

// ── Anchor API calls ───────────────────────────────────────────
async function anchorGet(path, caller) {
  const res = await fetch(ANCHOR_URL + path, {
    headers: { 'x-mcp-caller': caller }
  });
  if (!res.ok) throw new Error('Anchor returned ' + res.status);
  return res.json();
}

async function anchorPost(path, body, caller) {
  const res = await fetch(ANCHOR_URL + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-mcp-caller': caller },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error('Anchor returned ' + res.status);
  return res.json();
}

// ── MCP Server factory ─────────────────────────────────────────
function createMcpServer(caller) {
  const server = new McpServer({
    name: 'anchor',
    version: '1.0.0'
  });

  // ── INBOUND: add_note ────────────────────────────────────────
  server.tool(
    'add_note',
    'Add a note to Anchor. Use cat markup for multiple notes: "cat p\\ntext\\ncat w\\ntext"',
    { raw: z.string().describe('The note content. Supports cat markup for multi-category dumps.') },
    async ({ raw }) => {
      const data = await anchorPost('/note', { raw }, caller);
      return {
        content: [{
          type: 'text',
          text: data.ok
            ? 'Note saved.' + (data.split ? ' Split into ' + data.split + ' notes.' : ' Pending sync.')
            : 'Failed: ' + (data.error || 'Unknown error')
        }]
      };
    }
  );

  // ── OUTBOUND: get_notes ──────────────────────────────────────
  server.tool(
    'get_notes',
    'Get notes from Anchor. Work callers only receive work-scoped notes.',
    {
      type: z.string().optional().describe('Filter by category: work, personal, health, kids, finance, home, task, decision, idea, meeting, social, calendar, email, pi, random, brain-dump'),
      limit: z.number().optional().describe('Max notes to return (default 20)'),
      sort: z.enum(['newest', 'oldest', 'open-loops']).optional().describe('Sort order')
    },
    async ({ type, limit = 20, sort = 'newest' }) => {
      const data = await anchorPost('/mcp/notes', { type, limit, sort, caller }, caller);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── OUTBOUND: search_notes ───────────────────────────────────
  server.tool(
    'search_notes',
    'Search Anchor notes by keyword.',
    { query: z.string().describe('Search keywords') },
    async ({ query }) => {
      const data = await anchorPost('/mcp/search', { query, caller }, caller);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── OUTBOUND: get_open_loops ─────────────────────────────────
  server.tool(
    'get_open_loops',
    'Get all notes with unresolved actions or open questions.',
    {},
    async () => {
      const data = await anchorPost('/mcp/open-loops', { caller }, caller);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── OUTBOUND: get_summary ────────────────────────────────────
  server.tool(
    'get_summary',
    'Get a recent activity digest from Anchor.',
    { days: z.number().optional().describe('How many days back to summarize (default 7)') },
    async ({ days = 7 }) => {
      const data = await anchorPost('/mcp/summary', { days, caller }, caller);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── OUTBOUND: get_pi ─────────────────────────────────────────
  server.tool(
    'get_pi',
    'Get personal information facts about Dan (height, preferences, medical history etc).',
    {},
    async () => {
      const data = await anchorPost('/mcp/notes', { type: 'pi', limit: 50, caller }, caller);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );


  // ── RECLASSIFY ───────────────────────────────────────────────
  server.tool(
    'reclassify_note',
    'Change the type/category of an existing note by ID.',
    {
      id: z.number().describe('The note ID to reclassify'),
      type: z.string().describe('The new category type')
    },
    async ({ id, type }) => {
      const data = await anchorPost('/reclassify', { id, type }, caller);
      return {
        content: [{ type: 'text', text: data.ok ? 'Note ' + id + ' reclassified to ' + type : 'Failed: ' + (data.error || 'Unknown') }]
      };
    }
  );

  return server;
}

// ── Express app ────────────────────────────────────────────────
const app = express();
app.use(express.json());

app.post('/mcp', authCheck, async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined
  });
  const server = createMcpServer(req.caller);
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'anchor-mcp', port: PORT });
});

app.listen(PORT, () => console.log('anchor-mcp running on port ' + PORT));
