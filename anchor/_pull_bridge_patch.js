// ── POST /pull-bridge ──────────────────────────────────────────
// Bridge is a volume mount — no git pull needed, files are already live
app.post('/pull-bridge', async (req, res) => {
  try {
    const mdDir = path.join(BRIDGE_PATH, 'md');
    if (!fs.existsSync(mdDir)) return res.json({ ok: true, ingested: 0, skipped: 0, note: 'md/ folder not found' });

    const files = fs.readdirSync(mdDir).filter(f => f.endsWith('.md') || f.endsWith('.txt'));
    let ingested = 0, skipped = 0;
    for (const file of files) {
      const seenKey = 'bridge:file:' + file;
      const already = db.prepare('SELECT key FROM secrets WHERE key=?').get(seenKey);
      if (already) { skipped++; continue; }
      const content = fs.readFileSync(path.join(mdDir, file), 'utf8').trim();
      if (!content) { skipped++; continue; }
      const raw = '[Bridge: ' + file + ']\n' + content;
      db.prepare(`INSERT INTO notes (type,status,raw_input,formatted) VALUES ('pending','pending',?,?)`)
        .run(encrypt(raw), encrypt(raw));
      db.prepare('INSERT OR REPLACE INTO secrets (key,value) VALUES (?,?)').run(seenKey, '1');
      ingested++;
    }
    res.json({ ok: true, ingested, skipped });
  } catch(e) {
    console.error('pull-bridge error:', e);
    res.json({ ok: false, error: e.message });
  }
});