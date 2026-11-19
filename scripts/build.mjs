import fs from 'node:fs';
const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const R = read('config/rules.json');
const KEEP = new RegExp(R.keep, 'i');
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const rules = R.rules.map(r => ({
  ...r,
  t: (r.titles || []).map(x => new RegExp(x, 'i')), u: (r.urls || []).map(x => new RegExp(x, 'i')), p: (r.places || []).map(x => new RegExp(x, 'i'))
}));
const implied = e => {
  if (e.min != null) return e;
  if (/Baby\s?massage/i.test(e.title)) return { ...e, min: 0, max: 1, age: '0 to 1 years' };
  if (/Mittelstufe/i.test(e.title)) return { ...e, min: 10, max: 12, age: '10 to 12 years' };
  return e;
};
const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\b(pbz|bibliothek|bibl|zuerich|zurich|gz)\b/g, '').replace(/[^a-z0-9]+/g, '');
const all = [...read('data/events.json'), ...read('data/manual.json')].map(implied);
const best = new Map();
for (const e of all) {
  const key = [e.date, e.end || '', (e.time || '').slice(0, 5), norm(e.title), norm(e.place)].join('|');
  e._k = key;
  const p = best.get(key);
  if (!p || (e.note || '').length > (p.note || '').length) best.set(key, e);
}
const counts = {};
const events = all.map(e => {
  const x = [];
  for (const r of rules) {
    if (r.hosts && !r.hosts.includes(host(e.source))) continue;
    if ((r.t.some(re => re.test(e.title))) || (r.u.some(re => re.test(e.url))) || (r.p.some(re => re.test(e.place || '')))) x.push(r.id);
  }
  if (best.get(e._k) !== e) x.push('dup');
  const o = { ...e }; delete o._k;
  if (x.length) o.x = x;
  if (KEEP.test(e.title)) o.k = 1;
  for (const id of x) counts[id] = (counts[id] || 0) + 1;
  return o;
});
const meta = R.rules.map(r => ({ id: r.id, label: r.label, hint: r.hint, n: counts[r.id] || 0 }));
meta.find(r => r.id === 'baby').n = events.filter(e => e.max != null && e.max <= 1).length;
const esc = o => JSON.stringify(o).replace(/</g, '\\u003c');
const updated = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Zurich' });
const html = fs.readFileSync('template/index.html', 'utf8')
  .replace('/*EVENTS*/[]/*END*/', () => esc(events))
  .replace('/*RULES*/[]/*END*/', () => esc(meta))
  .replace('__UPDATED__', updated);
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/index.html', html);
console.log(`dist/index.html written with ${events.length} events (${events.filter(e => e.x).length} tagged by an advanced rule)`);
