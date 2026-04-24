import { useState, useRef } from 'preact/hooks';

export function AddNote({ onAdd, onPTCommand }) {
  const [text,    setText]    = useState('');
  const [file,    setFile]    = useState(null);
  const [status,  setStatus]  = useState('');
  const [loading, setLoading] = useState(false);
  const fileRef = useRef(null);
  const recRef  = useRef(null);
  const [listening, setListening] = useState(false);

  async function submitNote() {
    if (!text.trim() && !file) return;
    // PT show/hide commands — intercept before saving
    const trimmed = text.trim().toLowerCase();
    if (!file && (trimmed === 's' || trimmed === 'show')) {
      setText(''); onPTCommand && onPTCommand('show'); return;
    }
    if (!file && (trimmed === 'h' || trimmed === 'hide')) {
      setText(''); onPTCommand && onPTCommand('hide'); return;
    }
    setLoading(true); setStatus('');
    try {
      const fd = new FormData();
      if (text.trim()) fd.append('raw', text.trim());
      if (file) fd.append('file', file);
      const r = await fetch('/api/notes', { method: 'POST', body: fd });
      const d = await r.json();
      if (d.ok) {
        setText(''); setFile(null); if (fileRef.current) fileRef.current.value = '';
        setStatus(d.split > 1 ? `✓ Split into ${d.split} notes` : '✓ Saved');
        setTimeout(() => setStatus(''), 2000);
        onAdd();
      } else {
        setStatus('✗ ' + (d.error || 'Failed'));
      }
    } catch { setStatus('✗ Failed'); }
    setLoading(false);
  }

  function toggleMic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert('Use Chrome for mic support.'); return; }
    if (recRef.current) { recRef.current.stop(); recRef.current = null; setListening(false); return; }
    const r = new SR(); r.continuous = true; r.interimResults = false; r.lang = 'en-US';
    r.onresult = e => {
      const t = Array.from(e.results).map(r => r[0].transcript).join(' ');
      setText(prev => prev + (prev ? ' ' : '') + t);
    };
    r.onend = () => { setListening(false); recRef.current = null; };
    r.start(); recRef.current = r; setListening(true);
  }

  function handlePaste(e) {
    const items = (e.clipboardData || {}).items || [];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const f = item.getAsFile(); if (!f) continue;
        setFile(f);
        return;
      }
    }
  }

  return (
    <div class="panel panel-grow">
      <div class="panel-hdr"><span class="dot"></span>📝 Add Note</div>
      <textarea
        value={text}
        onInput={e => setText(e.target.value)}
        onPaste={handlePaste}
        placeholder="Brain dump here. Type, paste a URL, or paste/drag an image."
        onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submitNote(); }}
      />
      <div class="file-row">
        <label class="file-lbl">
          📎 Attach
          <input ref={fileRef} type="file" accept=".txt,.md,.csv,.pdf,.docx,.html,.htm,.jpg,.jpeg,.png,.gif,.webp" style="display:none"
            onChange={e => setFile(e.target.files[0] || null)} />
        </label>
        {file && <span class="file-name">{file.name}</span>}
        {file && <button class="btn-icon" onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ''; }}>✕</button>}
      </div>
      <div class="btn-row">
        <button class="btn btn-primary" onClick={submitNote} disabled={loading}>
          {loading ? 'Saving…' : 'Add Note'}
        </button>
        <button class={`btn btn-mic${listening ? ' listening' : ''}`} onClick={toggleMic}>
          {listening ? '🔴 Listening…' : '🎤 Mic'}
        </button>
      </div>
      {status && <div class={`status${status.startsWith('✗') ? ' err' : ''}`}>{status}</div>}
    </div>
  );
}
