import { useState } from 'preact/hooks';
import { isLocal } from '../helpers';

const GROUPS = [
  { label: 'Work',     items: [['wt','task'],['wp','project'],['wd','decision'],['wm','meeting'],['wi','idea'],['wpw','password']] },
  { label: 'Personal', items: [['pst','task'],['pp','project'],['pd','decision'],['pm','meeting'],['pid','idea'],['rec','recipe'],['ppw','password']] },
  { label: 'Health & Finance', items: [['ht','task'],['hid','idea'],['hpr','project'],['ft','task'],['fid','idea'],['fpr','project']] },
  { label: 'Family',   items: [['kw','Kathie'],['zs','Zach'],['es','Ethan'],['afl','Andy'],['ma','Maureen'],['ka','Kathy-Aunt'],['ms','Micky'],['lb','Lee'],['csl','Charity']] },
  { label: 'Pets',     items: [['kd','Kevin'],['mc','Mat'],['pcc','Phil'],['acc','Ace'],['liz','Herschel'],['hen','hens'],['hhr','hey-hey-Rooster']] },
  { label: 'System',   items: [['pi','info'],['ls','list'],['re','remind'],['r','random'],['ol','open-loop'],['cal','calendar'],['anc','anchor'],['emp','employment'],['ch','claude-handoff'],['pt','private-thoughts']] },
];

export function Commands() {
  const [open, setOpen] = useState(false);

  return (
    <div class="panel">
      <div class="panel-hdr" onClick={() => setOpen(o => !o)}>
        <span class="dot" style="background:#22d3ee"></span>
        📖 Commands
        <span class={`chev${open ? ' open' : ''}`}>▼</span>
      </div>
      <div class={open ? 'cmd-ref' : 'collapsed cmd-ref'}>
        {GROUPS.map(g => (
          <div key={g.label} class="cmd-group">
            <div class="cmd-label">{g.label}</div>
            {g.items.map(([k, v]) => (
              <span key={k}><code>{k}</code> {v} &nbsp;</span>
            ))}
          </div>
        ))}
        <div class="cmd-group">
          <div class="cmd-label">Tips</div>
          <span style="color:#94a3b8">Lines with <code>[ ]</code> or <code>[x]</code> auto-render as checklist &nbsp;|&nbsp; <code>cat pp ls</code> auto-checkboxes every line &nbsp;|&nbsp; <code>cat wt,wp</code> creates two notes</span>
        </div>
        <div class="cmd-group">
          <div class="cmd-label">Reminders</div>
          <code>re</code> / <code>remind</code> — then: <span style="color:#64748b">call dentist, monday 9am</span><br />
          <code>done N</code> &nbsp; <code>snooze N</code> &nbsp; <code>snooze N friday 3pm</code>
        </div>
      </div>
    </div>
  );
}
