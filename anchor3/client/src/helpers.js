export const COLORS = {
  'work-task': '#0ea5e9', 'work-decision': '#0284c7', 'work-idea': '#7dd3fc',
  'work-project': '#38bdf8', 'work-meeting': '#fb923c', 'work-password': '#f87171',
  'personal-task': '#d946ef', 'personal-decision': '#a21caf', 'personal-idea': '#c084fc',
  'personal-project': '#e879f9', 'personal-recipe': '#fb923c', 'personal-password': '#f87171',
  'personal-meeting': '#f59e0b',
  'health-task': '#ef4444', 'health-idea': '#fca5a5', 'health-project': '#f87171',
  'finance-task': '#16a34a', 'finance-idea': '#86efac', 'finance-project': '#4ade80',
  'Kathie-Wife': '#fcd34d', 'Zach-Son': '#fde68a', 'Ethan-Son': '#fbbf24',
  'Andy-FatherInLaw': '#f59e0b', 'Maureen-Aunt': '#fde68a', 'Kathy-Aunt': '#fcd34d',
  'Micky-Stepmother': '#fbbf24', 'Lee-Brother': '#f59e0b', 'Charity-SisterInLaw': '#fde68a',
  'Kevin-Dog': '#2dd4bf', 'Mat-Cat': '#5eead4', 'Phil-Cat': '#99f6e4',
  'Ace-Cat': '#67e8f9', 'Herschel-Lizard': '#a5f3fc', 'hens': '#34d399', 'hey-hey-Rooster': '#4ade80',
  'pi': '#fcd34d', 'list': '#22d3ee', 'remind': '#f472b6', 'random': '#94a3b8',
  'open-loop': '#fb923c', 'closed-loop': '#6b7280', 'calendar': '#c084fc', 'anchor': '#34d399',
  'employment': '#94a3b8', 'claude-handoff': '#60a5fa',
  'pending': '#f59e0b',
  'private-thoughts': '#a855f7',
};

export function typeColor(t) { return COLORS[t] || '#60a5fa'; }

export const TYPE_GROUPS = [
  { label: 'Work',     types: ['work-task','work-decision','work-idea','work-project','work-meeting','work-password'] },
  { label: 'Personal', types: ['personal-task','personal-decision','personal-idea','personal-project','personal-recipe','personal-password','personal-meeting'] },
  { label: 'Health',   types: ['health-task','health-idea','health-project'] },
  { label: 'Finance',  types: ['finance-task','finance-idea','finance-project'] },
  { label: 'Family',   types: ['Kathie-Wife','Zach-Son','Ethan-Son','Andy-FatherInLaw','Maureen-Aunt','Kathy-Aunt','Micky-Stepmother','Lee-Brother','Charity-SisterInLaw'] },
  { label: 'Pets',     types: ['Kevin-Dog','Mat-Cat','Phil-Cat','Ace-Cat','Herschel-Lizard','hens','hey-hey-Rooster'] },
  { label: 'System',   types: ['pi','remind','random','list','open-loop','closed-loop','calendar','anchor','employment','claude-handoff','pending','private-thoughts','personal-thought'] },
];

export function isLocal() {
  const h = window.location.hostname;
  return h === 'localhost' || h.startsWith('192.168.') || h.startsWith('10.') || h.startsWith('172.');
}

export function fmtDate(ts) {
  if (!ts) return '';
  try {
    const u = ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z';
    return new Date(u).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch { return ts; }
}

export function relTime(ts) {
  if (!ts) return '';
  try {
    const u = ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z';
    const diff = Date.now() - new Date(u).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d ago`;
    if (d < 30) return `${Math.floor(d / 7)}w ago`;
    return fmtDate(ts);
  } catch { return ts; }
}

export function firstLine(note) {
  const text = note.formatted || note.raw_input || '';
  return text.split('\n').find(l => l.trim()) || '';
}
