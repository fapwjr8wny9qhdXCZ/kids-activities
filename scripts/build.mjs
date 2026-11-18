import fs from 'node:fs';
const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const EXC = read('config/exclude.json');
const excluded = e => EXC.titles.some(t => new RegExp(t, 'i').test(e.title)) || EXC.urls.some(u => new RegExp(u, 'i').test(e.url));
const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\b(pbz|bibliothek|bibl|zuerich|zurich|gz)\b/g, '').replace(/[^a-z0-9]+/g, '');
const implied = e => {
  if (e.min != null) return e;
  if (/Baby\s?massage/i.test(e.title)) return { ...e, min: 0, max: 1, age: '0 to 1 years' };
  if (/Mittelstufe/i.test(e.title)) return { ...e, min: 10, max: 12, age: '10 to 12 years' };
  return e;
};
const seen = new Map();
for (const e of [...read('data/events.json'), ...read('data/manual.json')].map(implied)) {
  if (excluded(e)) continue;
  const key = [e.date, e.end || '', (e.time || '').slice(0, 5), norm(e.title), norm(e.place)].join('|');
  const prev = seen.get(key);
  if (!prev || ((e.note || '').length > (prev.note || '').length)) seen.set(key, e);
}
const events = [...seen.values()];
const updated = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Zurich' });
const json = JSON.stringify(events).replace(/</g, '\\u003c');
const html = fs.readFileSync('template/index.html', 'utf8')
  .replace('/*EVENTS*/[]/*END*/', () => json)
  .replace('__UPDATED__', updated);
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/index.html', html);
console.log(`dist/index.html written with ${events.length} events`);
