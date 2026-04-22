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

async function anchorGet(path, caller) {
  const res = await fetch(ANCHOR_URL + path, {
    method: 'GET',
    headers: { 'x-mcp-caller': caller }
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

const REBUILD_SERVICES = [];
const FULL_BUILD_SERVICES = ['anchor3'];

function createMcpServer(caller) {
  const server = new McpServer({ name: 'anchor', version: '1.9.0' });

  server.tool('add_note',
    'Add a note to Anchor. Use cat markup for multiple notes: "cat p\\ntext\\ncat w\\ntext"',
    { raw: z.string().describe('The note content. Supports cat markup for multi-category dumps.') },
    async ({ raw }) => {
      const data = await anchorPost('/api/note', { raw }, caller);
      return { content: [{ type: 'text', text: data.ok ? 'Note saved.' + (data.split ? ' Split into ' + data.split + ' notes.' : ' Pending sync.') : 'Failed: ' + (data.error || 'Unknown error') }] };
    }
  );

  server.tool('get_notes',
    'Get notes from Anchor. Work callers only receive work-scoped notes.',
    {
      type: z.string().optional().describe('Filter by category'),
      limit: z.number().optional().describe('Max notes to return (default 20)'),
      sort: z.enum(['newest', 'oldest', 'open-loops']).optional().describe('Sort order'),
      label: z.string().optional().describe('Filter by label/tag (e.g. "casmas-bridge")')
    },
    async ({ type, limit = 20, sort = 'newest', label }) => {
      const data = await anchorGet('/api/notes', caller);
      let notes = data.notes || [];
      if (type) notes = notes.filter(n => n.type === type);
      if (label) notes = notes.filter(n => n.tags && n.tags.includes(label));
      if (sort === 'oldest') notes = notes.sort((a, b) => a.id - b.id);
      else if (sort === 'open-loops') notes = notes.filter(n => n.open_loops);
      else notes = notes.sort((a, b) => b.id - a.id);
      notes = notes.slice(0, limit);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, notes }, null, 2) }] };
    }
  );

  server.tool('search_notes',
    'Search Anchor notes by keyword.',
    { query: z.string().describe('Search keywords') },
    async ({ query }) => {
      const data = await anchorGet('/api/notes', caller);
      const notes = (data.notes || []).filter(n => {
        const text = ((n.formatted || '') + ' ' + (n.tags || '')).toLowerCase();
        return query.toLowerCase().split(' ').every(w => text.includes(w));
      });
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, notes }, null, 2) }] };
    }
  );

  server.tool('get_open_loops',
    'Get all notes with unresolved actions or open questions.',
    {},
    async () => {
      const data = await anchorGet('/api/notes', caller);
      const notes = (data.notes || []).filter(n => n.open_loops || n.type === 'open-loop');
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, notes }, null, 2) }] };
    }
  );

  server.tool('get_summary',
    'Get a recent activity digest from Anchor.',
    { days: z.number().optional().describe('How many days back to summarize (default 7)') },
    async ({ days = 7 }) => {
      const data = await anchorGet('/api/notes', caller);
      const cutoff = new Date(Date.now() - days * 86400000).toISOString();
      const notes = (data.notes || []).filter(n => n.created_at > cutoff);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, notes }, null, 2) }] };
    }
  );

  server.tool('get_pi',
    'Get personal information facts about Dan.',
    {},
    async () => {
      const data = await anchorGet('/api/notes', caller);
      const notes = (data.notes || []).filter(n => n.type === 'pi');
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, notes }, null, 2) }] };
    }
  );

  server.tool('reclassify_note',
    'Change the type/category of an existing note by ID.',
    {
      id: z.number().describe('The note ID to reclassify'),
      type: z.string().describe('The new category type')
    },
    async ({ id, type }) => {
      const data = await anchorPost('/api/reclassify', { id, type }, caller);
      return { content: [{ type: 'text', text: data.ok ? 'Note ' + id + ' reclassified to ' + type : 'Failed: ' + (data.error || 'Unknown') }] };
    }
  );

  server.tool('delete_note',
    'Permanently delete a note from Anchor by ID.',
    { id: z.number().describe('The note ID to delete') },
    async ({ id }) => {
      try {
        const data = await anchorDelete('/api/notes/' + id, caller);
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

  server.tool('str_replace',
    'Replace a unique string in a file in the casmas-bridge repo. old_str must appear exactly once.',
    {
      path: z.string().describe('Relative path within the repo, e.g. "anchor/routes/ui.js"'),
      old_str: z.string().describe('Exact string to find and replace (must be unique in the file)'),
      new_str: z.string().describe('Replacement string (empty string to delete)')
    },
    async ({ path: relPath, old_str, new_str }) => {
      const fullPath = `${REPO_PATH}/${relPath}`;
      let content;
      try { content = await readFile(fullPath, 'utf8'); }
      catch (err) { return { content: [{ type: 'text', text: `Read error: ${err.message}` }] }; }

      const count = content.split(old_str).length - 1;
      if (count === 0) return { content: [{ type: 'text', text: `Error: old_str not found in ${relPath}` }] };
      if (count > 1)  return { content: [{ type: 'text', text: `Error: old_str found ${count} times in ${relPath} — must be unique` }] };

      await writeFile(fullPath, content.replace(old_str, new_str), 'utf8');
      return { content: [{ type: 'text', text: `Patched: ${relPath}` }] };
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
    'Sync JS source files from casmas-bridge and restart the service. For anchor: copies routes/lib/server.js and restarts container (no image rebuild needed for JS changes).',
    { service: z.string().describe('Service name, e.g. "anchor", "gmr"') },
    async ({ service }) => {
      try {
        const prodPath = `${WAREHOUSE}/${service}`;
        const repoPath = `${REPO_PATH}/${service}`;
        let steps = [];

        const { stdout: pullOut } = await sh(`git pull`, { cwd: REPO_PATH, env: gitEnv() });
        steps.push('Git pull: ' + pullOut.trim().split('\n')[0]);

        if (REBUILD_SERVICES.includes(service)) {
          await sh(`rsync -a --exclude='data/' --exclude='backup/' --exclude='.env' --exclude='Dockerfile' --exclude='package.json' --exclude='package-lock.json' ${repoPath}/ ${prodPath}/`);
          steps.push('Source files synced.');
          await sh(`docker restart anchor`, { timeout: 30000 });
          steps.push('Container restarted.');
          steps.push('Done — no image rebuild needed for JS-only changes.');
        } else if (FULL_BUILD_SERVICES.includes(service)) {
          await sh(`rsync -a --exclude='data/' --exclude='.env' --exclude='node_modules/' --exclude='dist/' ${repoPath}/ ${prodPath}/`);
          steps.push('Source files synced.');
          const { stdout: buildOut } = await sh(`docker compose up --build -d 2>&1`, { timeout: 180000, cwd: prodPath });
          steps.push('Docker image rebuilt and container restarted.');
          if (buildOut) steps.push(buildOut.slice(0, 500));
        } else {
          await sh(`docker restart ${service}`);
          steps.push(`Restarted ${service}.`);
        }

        return { content: [{ type: 'text', text: steps.join('\n') }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `rebuild_service error: ${err.message}\n${err.stdout || ''}\n${err.stderr || ''}` }] };
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
