import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { exec } from 'child_process';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { dirname } from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);

const PORT = 8000;
const ANCHOR_URL = process.env.ANCHOR_URL || 'http://192.168.50.23:7778';
const MCP_TOKEN = process.env.MCP_TOKEN;
const REPO_PATH = process.env.REPO_PATH || '/repo/casmas-bridge';
const SSH_KEY_PATH = process.env.SSH_KEY_PATH || '/root/.ssh/deploy_key';
const WAREHOUSE = process.env.WAREHOUSE || '/warehouse';
const WAREHOUSE_HOST = process.env.WAREHOUSE_HOST || '/srv/mergerfs/warehouse';

if (!MCP_TOKEN) { console.error('FATAL: MCP_TOKEN not set'); process.exit(1); }

const TOKENS = {};
MCP_TOKEN.split(',').forEach(entry => {
  const [caller, secret] = entry.trim().split(':');
  if (caller && secret) TOKENS[secret] = caller;
});

function identifyCaller(token) { return TOKENS[token] || null; }

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

async function anchorDelete(path, caller) {
  const res = await fetch(ANCHOR_URL + path, {
    method: 'DELETE',
    headers: { 'x-mcp-caller': caller }
  });
  if (!res.ok) throw new Error('Anchor returned ' + res.status);
  return res.json();
}

function gitEnv() {
  return { ...process.env, GIT_SSH_COMMAND: `ssh -i ${SSH_KEY_PATH} -o StrictHostKeyChecking=no` };
}

function sh(cmd, opts = {}) {
  return execAsync(cmd, { shell: true, ...opts });
}

const REBUILD_SERVICES = ['anchor'];

function createMcpServer(caller) {
  const server = new McpServer({ name: 'anchor', version: '1.7.0' });

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
      type: z.string().optional().describe('Filter by category'),
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
    'Get personal information facts about Dan.',
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

  server.tool('delete_note',
    'Permanently delete a note from Anchor by ID.',
    { id: z.number().describe('The note ID to delete') },
    async ({ id }) => {
      try {
        const data = await anchorDelete('/mcp/notes/' + id, caller);
        return { content: [{ type: 'text', text: data.ok ? 'Note ' + id + ' deleted.' : 'Failed: ' + (data.error || 'Unknown') }] };
      } catch (err) {
        return { content: [{ type: 'text', text: 'Delete error: ' + err.message }] };
      }
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

  server.tool('read_file',
    'Read a file from the casmas-bridge repo.',
    { path: z.string().describe('Relative path within the repo, e.g. "anchor/server.js"') },
    async ({ path: relPath }) => {
      try {
        const content = await readFile(`${REPO_PATH}/${relPath}`, 'utf8');
        return { content: [{ type: 'text', text: content }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Read error: ${err.message}` }] };
      }
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
    'Sync source from casmas-bridge repo and rebuild/restart a service. anchor = full compose rebuild. Others = docker restart.',
    { service: z.string().describe('Service name, e.g. "anchor", "gmr"') },
    async ({ service }) => {
      try {
        const prodPath = `${WAREHOUSE}/${service}`;
        const hostProdPath = `${WAREHOUSE_HOST}/${service}`;
        const repoPath = `${REPO_PATH}/${service}`;
        let steps = [];

        if (REBUILD_SERVICES.includes(service)) {
          // 1. Sync source files, protecting live DB and backup
          await sh(`rsync -a --exclude='data/' --exclude='backup/' --exclude='.env' ${repoPath}/ ${prodPath}/`);
          steps.push(`Synced source files`);

          // 2. Build image directly — avoids compose env var issues
          const { stdout: buildOut } = await sh(
            `docker build -t anchor-anchor ${hostProdPath} 2>&1`,
            { timeout: 180000 }
          );
          const lastLines = buildOut.trim().split('\n').slice(-3).join(' | ');
          steps.push(`Build: ${lastLines}`);

          // 3. Recreate container with new image via compose
          const composeFile = `${hostProdPath}/docker-compose.yml`;
          const envFile = `${hostProdPath}/.env`;
          await sh(`docker compose -f ${composeFile} --env-file ${envFile} up -d --no-build 2>&1`, { timeout: 30000 });
          steps.push('Container restarted.');
        } else {
          await sh(`docker restart ${service}`);
          steps.push(`Restarted ${service}.`);
        }

        return { content: [{ type: 'text', text: steps.join('\n') }] };
      } catch (err) {
        // Return full error including stderr for debugging
        return { content: [{ type: 'text', text: `rebuild_service error: ${err.message}\n${err.stderr || ''}` }] };
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

app.get('/health', (req, res) => res.json({ ok: true, service: 'anchor-mcp', port: PORT }));

app.listen(PORT, () => console.log('anchor-mcp running on port ' + PORT));
