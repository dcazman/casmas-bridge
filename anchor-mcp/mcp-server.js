import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { exec } from 'child_process';
import { writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);

const PORT = 8000;
const ANCHOR_URL = process.env.ANCHOR_URL || 'http://192.168.50.23:7778';
const MCP_TOKEN = process.env.MCP_TOKEN;
const REPO_PATH = process.env.REPO_PATH || '/repo/casmas-bridge';
const SSH_KEY_PATH = process.env.SSH_KEY_PATH || '/root/.ssh/deploy_key';

if (!MCP_TOKEN) { console.error('FATAL: MCP_TOKEN not set'); process.exit(1); }

const TOKENS = {};
MCP_TOKEN.split(',').forEach(entry => {
  const [caller, secret] = entry.trim().split(':');
  if (caller && secret) TOKENS[secret] = caller;
});

function identifyCaller(token) {
  return TOKENS[token] || null;
}

function authCheck(req, res, next) {
  const token = req.headers['x-anchor-token'] || req.headers['authorization']?.replace('Bearer ', '') || req.query.token;
  const caller = identifyCaller(token);
  if (!caller) return res.status(401).json({ error: 'Unauthorized' });
  req.caller = caller;
  next();
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

function gitEnv() {
  return {
    ...process.env,
    GIT_SSH_COMMAND: `ssh -i ${SSH_KEY_PATH} -o StrictHostKeyChecking=no`
  };
}

function sh(cmd, opts = {}) {
  return execAsync(cmd, { shell: true, ...opts });
}

function createMcpServer(caller) {
  const server = new McpServer({ name: 'anchor', version: '1.0.0' });

  server.tool('add_note',
    'Add a note to Anchor. Use cat markup for multiple notes: "cat p\\ntext\\ncat w\\ntext"',
    { raw: z.string().describe('The note content. Supports cat markup for multi-category dumps.') },
    async ({ raw }) => {
      const data = await anchorPost('/note', { raw }, caller);
      return { content: [{ type: 'text', text: data.ok ? 'Note saved.' + (data.split ? ' Split into ' + data.split + ' notes.' : ' Pending sync.') : 'Failed: ' + (data.error || 'Unknown error') }] };
    }
  );

  server.tool('get_notes',
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

  server.tool('search_notes',
    'Search Anchor notes by keyword.',
    { query: z.string().describe('Search keywords') },
    async ({ query }) => {
      const data = await anchorPost('/mcp/search', { query, caller }, caller);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool('get_open_loops',
    'Get all notes with unresolved actions or open questions.',
    {},
    async () => {
      const data = await anchorPost('/mcp/open-loops', { caller }, caller);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool('get_summary',
    'Get a recent activity digest from Anchor.',
    { days: z.number().optional().describe('How many days back to summarize (default 7)') },
    async ({ days = 7 }) => {
      const data = await anchorPost('/mcp/summary', { days, caller }, caller);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool('get_pi',
    'Get personal information facts about Dan (height, preferences, medical history etc).',
    {},
    async () => {
      const data = await anchorPost('/mcp/notes', { type: 'pi', limit: 50, caller }, caller);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool('reclassify_note',
    'Change the type/category of an existing note by ID.',
    {
      id: z.number().describe('The note ID to reclassify'),
      type: z.string().describe('The new category type')
    },
    async ({ id, type }) => {
      const data = await anchorPost('/reclassify', { id, type }, caller);
      return { content: [{ type: 'text', text: data.ok ? 'Note ' + id + ' reclassified to ' + type : 'Failed: ' + (data.error || 'Unknown') }] };
    }
  );

  server.tool('write_file',
    'Write content to a file in the casmas-bridge repo.',
    {
      path: z.string().describe('Relative path within the repo, e.g. "anchor/server.js"'),
      content: z.string().describe('Full file content to write')
    },
    async ({ path: relPath, content }) => {
      const fullPath = `${REPO_PATH}/${relPath}`;
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content, 'utf8');
      return { content: [{ type: 'text', text: `Written: ${relPath}` }] };
    }
  );

  server.tool('git_commit_push',
    'Stage all changes, commit, and push the casmas-bridge repo to GitHub.',
    { message: z.string().describe('Commit message') },
    async ({ message }) => {
      try {
        const env = gitEnv();
        const opts = { cwd: REPO_PATH, env };
        await sh('git add -A', opts);
        const { stdout: commitOut } = await sh(`git commit -m "${message.replace(/"/g, '\\"')}"`, opts);
        const { stdout: pushOut } = await sh('git push', opts);
        return { content: [{ type: 'text', text: `Committed & pushed.\n${commitOut}\n${pushOut}` }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Git error: ${err.message}` }] };
      }
    }
  );

  server.tool('rebuild_service',
    'Restart a running Docker container by name.',
    { service: z.string().describe('Container name, e.g. "anchor-mcp", "gmr", "anchor"') },
    async ({ service }) => {
      try {
        const { stdout } = await sh(`docker restart ${service}`);
        return { content: [{ type: 'text', text: `Restarted ${service}.\n${stdout}` }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Restart error: ${err.message}` }] };
      }
    }
  );

  return server;
}

const app = express();
app.use(express.json());

app.post('/mcp', authCheck, async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createMcpServer(req.caller);
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'anchor-mcp', port: PORT });
});

app.listen(PORT, () => console.log('anchor-mcp running on port ' + PORT));
