import fs from 'node:fs';
import { chromium } from 'playwright';

const pad = n => String(n).padStart(2, '0');
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = new Date(); today.setHours(12, 0, 0, 0);
const TODAY = isoDate(today);
const plus = new Date(today); plus.setDate(plus.getDate() + 240);
const LIMIT = isoDate(plus);
const MONTHS = { januar: 1, februar: 2, märz: 3, april: 4, mai: 5, juni: 6, juli: 7, august: 8, september: 9, oktober: 10, november: 11, dezember: 12 };
const mon = s => MONTHS[s.toLowerCase()];
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const OUT = /Winterthur|Technorama|Aathal|Bülach|Dübendorf|Uster\b|\bZug\b|Kilchberg|Küsnacht|Wetzikon|Kloten|Dietikon|Horgen|Meilen|Hinwil|Pfäffikon|Rüti|Zollikon|Zumikon|Flughafen|Opfikon|Wädenswil|Thalwil|Adliswil/i;
const ageText = (min, max) => min == null ? '' : max == null ? `${min}+ years` : `${min} to ${max} years`;
const DOWMAP = { mo: 1, di: 2, mi: 3, do: 4, fr: 5, sa: 6, so: 0, montag: 1, dienstag: 2, mittwoch: 3, donnerstag: 4, freitag: 5, samstag: 6, sonntag: 0 };

const GZ_OUT = /Affoltern|Leimbach|Seebach|Witikon|Höngg|Hoengg/i;
function cleanTitle(t) {
  t = t.replace(/^\d{1,2}\. \p{L}+ \d{4}(\s*[–-]\s*\d{1,2}\. \p{L}+ \d{4})?\s*/u, '')
    .replace(/^((?:(?:Mo|Di|Mi|Do|Fr|Sa|So)\.|(?:Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag)\b):?,?\s*)+/, '')
    .replace(/^\d{1,2}[.:]\d{2}\s*Uhr(\s*[–-]\s*\d{1,2}[.:]\d{2}\s*Uhr)?\s*/, '')
    .replace(/\s+/g, ' ').trim();
  if (t.length > 60) { const c = t.slice(0, 60); t = c.slice(0, Math.max(c.lastIndexOf(' '), 30)).replace(/[,:;\s-]+$/, '') + '…'; }
  return t;
}
function impliedAge(o) {
  if (o.min != null) return o;
  if (/Baby\s?massage/i.test(o.title)) return { ...o, min: 0, max: 1 };
  if (/Mittelstufe/i.test(o.title)) return { ...o, min: 10, max: 12 };
  return o;
}
function mk(source, o) {
  o = impliedAge({ ...o, title: cleanTitle(o.title) });
  return {
    note: o.note || '',
    source, date: o.date, end: o.end || null, dow: o.dow || null, time: o.time || '',
    title: o.title, place: o.place || '', min: o.min ?? null, max: o.max ?? null, cost: o.cost ?? null, age: ageText(o.min ?? null, o.max ?? null),
    url: o.url, reg: OUT.test(`${o.title} ${o.place || ''}`) ? 'out' : 'city', always: !!o.always
  };
}
const keep = e => (e.end || e.date) >= TODAY && e.date <= LIMIT;

async function pmap(items, n, fn) {
  const res = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; res[k] = await fn(items[k], k); } }));
  return res;
}
async function withPage(browser, url, fn) {
  const ctx = await browser.newContext({ locale: 'de-CH', userAgent: 'Mozilla/5.0 (X11; Linux x86_64) kids-activities-bot' });
  await ctx.route('**/*', r => ['image', 'font', 'media'].includes(r.request().resourceType()) ? r.abort() : r.continue());
  const p = await ctx.newPage();
  try {
    await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await p.getByRole('button', { name: /^(ok|einverstanden|akzeptieren|alle akzeptieren)$/i }).first().click({ timeout: 1500 }).catch(() => {});
    return await fn(p);
  } finally { await ctx.close(); }
}
const anchors = (p, sel) => p.$$eval(sel, as => as.map(a => ({ h: a.href, t: (a.innerText || a.textContent).replace(/\s+/g, ' ').trim() })));

// ---------- gz-zh.ch (renders with JS, one page per date, "Mehr laden" paging) ----------
const GZ_SRC = 'https://gz-zh.ch/';
const GZ_KIDS = /Kinder|Kleinkind|Krabbel|Spielplatz|Spielzimmer|Spielraum|\bMinis?\b|Eltern|Baby|Playball|Familie|zwerg|Bilderbuch|Märchen|Znüni|Zmorge|Vorschul|Zauber|Zirkus|Kasperli|Laterne|Kerzenzieh|Bastel|Malen|Musig/i;
async function gz(browser) {
  const out = []; const seen = new Set();
  const days = await pmap([...Array(14).keys()], 4, async i => {
    const d = new Date(today); d.setDate(d.getDate() + i);
    const q = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
    const cards = await withPage(browser, `https://gz-zh.ch/?dates=${q}`, async p => {
      await p.waitForFunction(() => /[1-9]\d* Angebote? gefunden/.test(document.body.innerText) && document.querySelector('article.grid-item'), null, { timeout: 20000 }).catch(() => {});
      let miss = 0;
      for (let k = 0; k < 300 && miss < 3; k++) {
        const b = p.locator('button.view-more-button').first();
        if (!(await b.isVisible().catch(() => false))) break;
        const before = await p.$$eval('article.grid-item', a => a.length);
        await b.scrollIntoViewIfNeeded().catch(() => {});
        await b.click().catch(() => {});
        const grew = await p.waitForFunction(n => document.querySelectorAll('article.grid-item').length > n, before, { timeout: 6000 }).then(() => true).catch(() => false);
        miss = grew ? 0 : miss + 1;
      }
      return p.$$eval('article.grid-item', as => as.map(a => {
        const h = a.querySelector('h2.entry-title');
        const t = h ? [...h.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim() : '';
        const q = s => (a.querySelector(s)?.textContent || '').trim();
        return { title: t, cat: q('.cat-title'), date: (a.querySelector('.filter-date')?.innerHTML || '').replace(/<br\s*\/?>/g, '|'), place: q('.location'), url: a.dataset.link || '' };
      }));
    });
    return { q, cards };
  });
  for (const { q, cards } of days) {
    for (const c of cards) {
      const m = c.date.match(/(\d{2})\.(\d{2})\.(\d{4})\|?(\d{2}:\d{2})\s*[–-]\s*(\d{2}:\d{2})?/);
      if (!m || !c.title) continue;
      if (!(/Spiel|Tiere/i.test(c.cat) || GZ_KIDS.test(c.title) || GZ_ALWAYS.test(c.title))) continue;
      const date = ymd(m[3], m[2], m[1]);
      const key = c.title + c.place + date + m[4];
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(mk(GZ_SRC, { date, time: m[5] ? `${m[4]} to ${m[5]}` : m[4], title: c.title, place: c.place, url: c.url || GZ_SRC }));
    }
    console.log(`  gz ${q}: ${cards.length} cards, ${out.length} candidates so far`);
  }
  return await gzDetails(browser, out);
}

// Fetch each offer page once: keep only free offers, attach "Besondere Hinweise".
// Offers we always want, whatever they cost.
const GZ_ALWAYS = /Mittagessen|Mittagstisch|Malen|Kerzenzieh/i;
const FREE_RE = /kostenlos|gratis|gebührenfrei|keine kosten|freiwillig|kollekte|unkostenbeitrag|spende|eintritt frei/i;
function cheap(cost) {
  if (FREE_RE.test(cost)) return true;
  const amts = [...cost.matchAll(/(?:CHF|Fr\.)\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(?:CHF|Fr\.)/g)].map(m => parseFloat((m[1] || m[2]).replace(',', '.')));
  return amts.length > 0 && Math.max(...amts) <= 20;
}
async function gzDetails(browser, events) {
  const CF = 'data/gzcache.json';
  let cache = {}; try { cache = JSON.parse(fs.readFileSync(CF, 'utf8')); } catch {}
  const urls = [...new Set(events.map(e => e.url))].filter(u => u !== GZ_SRC);
  const todo = urls.filter(u => !cache[u] || cache[u].v !== 3 || Date.now() - cache[u].at > 7 * 864e5);
  console.log(`  gz details: ${urls.length} pages, ${todo.length} to fetch`);
  const ctx = await browser.newContext({ locale: 'de-CH' });
  await ctx.route('**/*', r => ['image', 'font', 'media', 'stylesheet'].includes(r.request().resourceType()) ? r.abort() : r.continue());
  let idx = 0;
  const worker = async () => {
    const p = await ctx.newPage();
    while (idx < todo.length) {
      const u = todo[idx++];
      try {
        await p.goto(u, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await p.waitForTimeout(600);
        const txt = await p.evaluate(() => (document.querySelector('main') || document.body).innerText);
        const lines = txt.split('\n').map(l => l.trim());
        const sec = {}; let cur = null;
        for (const l of lines) {
          if (!l) continue;
          if (l.length >= 4 && l.length < 40 && l === l.toUpperCase() && /[A-ZÄÖÜ]{3}/.test(l)) { cur = l; sec[cur] = ''; }
          else if (cur) sec[cur] += (sec[cur] ? ' ' : '') + l;
        }
        const cost = sec['KOSTEN'] || '';
        cache[u] = { v: 3, at: Date.now(), cost: cost.slice(0, 300), note: (sec['BESONDERE HINWEISE'] || '').slice(0, 900) };
      } catch (err) { cache[u] = { v: 3, at: Date.now(), cost: '', note: '', err: 1 }; }
    }
    await p.close();
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  await ctx.close();
  fs.writeFileSync(CF, JSON.stringify(cache));
  const res = events.map(e => {
    const c = cache[e.url] || {}; const cost = c.cost || '';
    const free = FREE_RE.test(cost);
    const amts = [...cost.matchAll(/(?:CHF|Fr\.)\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(?:CHF|Fr\.)/g)].map(m => parseFloat((m[1] || m[2]).replace(',', '.')));
    const num = free ? 0 : amts.length ? Math.max(...amts) : null;
    const price = !free && cost ? `Cost: ${cost.replace(/\s+/g, ' ').slice(0, 100)}` : '';
    return { ...e, cost: num, note: [price, c.note].filter(Boolean).join('. ') };
  });
  console.log(`  gz offers: ${res.length}`);
  return res;
}

// ---------- kikuka.ch (infinite scroll) ----------
const WD = '(?:Mo|Di|Mi|Do|Fr|Sa|So)';
function kTimes(s) {
  const r = [];
  for (const m of s.matchAll(/(\d\d)\.(\d\d) Uhr\s*[–-]\s*(\d\d)\.(\d\d) Uhr/g)) {
    const a = `${m[1]}:${m[2]}`, b = `${m[3]}:${m[4]}`;
    r.push(b === '00:00' || a === b ? a : `${a} to ${b}`);
  }
  return r.join(', ');
}
function parseKikuka({ h, t }) {
  let min = null, max = null;
  const age = t.match(/(\d{1,2})\s*[-–]\s*(\d{1,2}) Jahre\s*$/);
  if (age) { min = +age[1]; max = +age[2]; } else if (/< ?1 Jahr\s*$/.test(t)) { min = 0; max = 1; }
  const clean = s => s.replace(/\s*\d{1,2}\s*-\s*\d{1,2} Jahre\s*$/, '').replace(/\s*< ?1 Jahr\s*$/, '').trim();
  const rng = t.match(/^(.*?) (\d{1,2})\. (\p{L}+) (\d{4}) [–-] (\d{1,2})\. (\p{L}+) (\d{4})(.*)$/u);
  if (rng) {
    const [, title, d1, m1, y1, d2, m2, y2, rest] = rng;
    const second = rest.indexOf(title);
    const seg = second >= 0 ? rest.slice(0, second) : rest;
    const place = second >= 0 ? clean(rest.slice(second + title.length).replace(/\s*\d{1,2}\. \p{L}+ \d{4}.*$/u, '')) : '';
    const days = new Set();
    for (const m of seg.matchAll(/\b(Mo|Di|Mi|Do|Fr|Sa|So)\./g)) days.add(DOWMAP[m[1].toLowerCase()]);
    for (const m of seg.matchAll(/\b(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag)\b/g)) days.add(DOWMAP[m[1].toLowerCase()]);
    const date = ymd(y1, mon(m1), d1), end = ymd(y2, mon(m2), d2);
    const dow = days.size ? [...days].join('') : null;
    const span = (new Date(end) - new Date(date)) / 864e5;
    const always = span >= 90 && (!dow || dow.length >= 5);
    return { date, end, dow, time: kTimes(seg), title, place, min, max, url: h, always };
  }
  const one = t.match(new RegExp(`^(.*?) ${WD}\\. (\\d{1,2})\\. (\\p{L}+) (\\d{4})(.*)$`, 'u'));
  if (!one) return null;
  const [, title, d, m, y, rest] = one;
  const second = rest.indexOf(title);
  const seg = second >= 0 ? rest.slice(0, second) : rest;
  let place = '';
  if (second >= 0) place = clean(rest.slice(second + title.length).split(new RegExp(` ${WD}\\. \\d{1,2}\\. `))[0]);
  return { date: ymd(y, mon(m), d), time: kTimes(seg), title, place, min, max, url: h };
}
function parseKCard(c) {
  const ds = c.dates.map(x => x.replace(/\s+/g, ' ').trim());
  let min = null, max = null;
  const ag = (c.age || '').replace(/\s+/g, ' ');
  const a2 = ag.match(/(\d{1,2})\s*[-–]\s*(\d{1,2})/), a1 = ag.match(/ab (\d{1,2})/);
  if (a2) { min = +a2[1]; max = +a2[2]; } else if (/< ?1/.test(ag)) { min = 0; max = 1; } else if (a1) min = +a1[1];
  const base = { title: c.title, place: c.venue, min, max, url: c.h };
  const out = [];
  ds.forEach((d, i) => {
    const r = d.match(/(\d{1,2})\. (\p{L}+) (\d{4})\s*[–-]\s*(\d{1,2})\. (\p{L}+) (\d{4})/u);
    const one = d.match(/(\d{1,2})\. (\p{L}+) (\d{4})/u);
    const tm = kTimes(c.times.length === ds.length ? c.times[i] : c.times.join(' '));
    if (r) {
      const seg = c.sched || '';
      const days = new Set();
      for (const m of seg.matchAll(/\b(Mo|Di|Mi|Do|Fr|Sa|So)\./g)) days.add(DOWMAP[m[1].toLowerCase()]);
      for (const m of seg.matchAll(/\b(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag)\b/g)) days.add(DOWMAP[m[1].toLowerCase()]);
      const date = ymd(r[3], mon(r[2]), r[1]), end = ymd(r[6], mon(r[5]), r[4]);
      const dow = days.size ? [...days].join('') : null;
      const span = (new Date(end) - new Date(date)) / 864e5;
      out.push({ ...base, date, end, dow, time: tm || kTimes(seg), always: span >= 90 && (!dow || dow.length >= 5) });
    } else if (one) out.push({ ...base, date: ymd(one[3], mon(one[2]), one[1]), time: tm });
  });
  return out;
}
async function kikuka(browser) {
  const seen = new Set(), out = [];
  let raw = 0;
  const pages = await pmap([...Array(14).keys()], 4, async i => {
    const d = new Date(today); d.setDate(d.getDate() + i);
    const url = `https://kikuka.ch/kalender?start_date=${isoDate(d)}&age=&category=&district=&venue=&freecategory=`;
    const cards = await withPage(browser, url, async p => {
      await p.waitForSelector('.c-event-entry a[href*="/event/"]', { timeout: 15000 }).catch(() => {});
      let last = -1;
      for (let k = 0; k < 40; k++) {
        const n = await p.$$eval('.c-event-entry', as => as.length);
        if (n === last && k > 2) break;
        last = n;
        await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await p.waitForTimeout(500);
      }
      return p.$$eval('.c-event-entry', es => es.map(c => {
        const a = c.querySelector('a[href*="/event/"]'); if (!a) return null;
        const w = s => (c.querySelector(s)?.textContent || '').replace(/\s+/g, ' ').trim();
        return {
          h: a.href, title: w('h2'), venue: w('.venue'), age: w('.list-view-age'),
          dates: [...c.querySelectorAll('.list-view-time .schedule-date')].map(x => x.textContent),
          times: [...c.querySelectorAll('.list-view-time .schedule-time')].map(x => x.textContent.replace(/\s+/g, ' ').trim()),
          sched: (c.querySelector('.list-title .time') || c.querySelector('.list-view-time') || {}).textContent?.replace(/\s+/g, ' ') || ''
        };
      }).filter(Boolean));
    });
    return { d, cards };
  });
  for (const { d, cards } of pages) {
    let added = 0;
    for (const c of cards) {
      raw++;
      for (const o of parseKCard(c)) {
        if (!o.title || isNaN(Date.parse(o.date))) continue;
        const key = `${o.url}|${o.date}|${o.end}|${o.time}`;
        if (seen.has(key)) continue; seen.add(key);
        out.push(mk('https://kikuka.ch/kalender', o)); added++;
      }
    }
    console.log(`  kikuka ${isoDate(d)}: ${cards.length} cards, ${added} new`);
  }
  console.log(`  kikuka total: ${raw} cards, ${out.length} events`);
  return out;
}

// ---------- zko.ch ----------
async function zko(browser) {
  const items = await withPage(browser, 'https://zko.ch/kids/kinderkonzerte/', async p => { await p.waitForSelector('a[href*="/events/"]', { timeout: 15000 }).catch(() => {}); return anchors(p, 'a[href*="/events/"]'); });
  const out = [];
  console.log(`  zko anchors: ${items.length}`, items[0]?.t?.slice(0,80));
  for (const { h, t } of items) {
    const m = t.match(new RegExp(`^(?:Post Image )?${WD}\\.\\s*(.*?) (\\d{2})/(\\d{2}) (.*)$`, 'i'));
    if (!m || /Abschlusskonzert/i.test(t)) continue;
    const [, place, dd, mm, rest] = m;
    let y = today.getFullYear();
    if (ymd(y, +mm, +dd) < isoDate(new Date(today.getTime() - 7 * 864e5))) y++;
    let min = null, max = null, body = rest;
    const a1 = rest.match(/Altersempfehlung ab (\d+) Jahren?/), a2 = rest.match(/Altersempfehlung (\d+)\s*[–-]\s*(\d+) Jahr/);
    if (a1) { min = +a1[1]; body = rest.replace(a1[0], ''); } else if (a2) { min = +a2[1]; max = +a2[2]; body = rest.replace(a2[0], ''); }
    const times = [...rest.matchAll(/(\d{2}:\d{2}) - \d{2}:\d{2} Uhr/g)].map(x => x[1]).join(', ');
    let title = body.replace(/\d{2}:\d{2} - \d{2}:\d{2} Uhr/g, '').replace(/\s+/g, ' ').trim();
    const head = title.match(/^([^a-zäöüéèà]+?)(?=\s+\p{Lu}[\p{Ll}]|$)/u);   // upper-case title, performers follow in mixed case
    if (head && head[1].length > 6) title = head[1].trim();
    title = title.replace(/\s+[—–]\s+/, ': ').toLowerCase().replace(/(^|[\s:\-«(])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
    out.push(mk('https://zko.ch/kids/kinderkonzerte/', { date: ymd(y, +mm, +dd), time: times, title, place, min, max, url: h }));
  }
  return out;
}

// ---------- kinderregion.ch (event highlights only, see README) ----------
async function kinderregion(browser) {
  const SRC = 'https://kinderregion.ch/de/veranstaltungen/';
  const items = await withPage(browser, SRC, p => anchors(p, 'a'));
  const out = [];
  const lists = [...new Set(items.map(i => i.h).filter(h => /kinderregion\.ch\/de\/liste\//.test(h)))];
  const DRE = /([^|\n]*?)\s*\|\s*(\d{1,2})\.(?:\s*(\p{L}+))?(?:\s*(\d{4}))?(?:\s*bis\s*(\d{1,2})\.\s*(\p{L}+)\s*(\d{4}))?/u;
  for (const lu of lists) {
    const cards = await withPage(browser, lu, p => p.$$eval('a', as => as.map(a => ({
      h: a.href, title: (a.querySelector('h1,h2,h3,h4,h5')?.textContent || '').trim(), t: a.innerText.replace(/[ \t]+/g, ' ').trim()
    }))));
    let n = 0;
    for (const c of cards) {
      const m = c.t.match(DRE); if (!m || !c.title) continue;
      const [, place, d1, m1, y1, d2, m2, y2] = m;
      const mm = m1 || m2, yy = y1 || y2;
      if (!mm || !yy || !mon(mm)) continue;
      const date = ymd(yy, mon(mm), d1);
      const end = d2 ? ymd(y2, mon(m2), d2) : null;
      out.push(mk(SRC, { date, end, title: c.title, place: place.trim(), url: c.h })); n++;
    }
    console.log(`  kinderregion ${lu}: ${n} entries`);
  }
  // fallback: keep old-style highlight entries for pages that yielded nothing
  if (!out.length) {
    for (const { h, t } of items) {
      const m = t.match(/^(\d{1,2})\.(?: (\p{L}+))?(?: (\d{4}))? bis (\d{1,2})\. (\p{L}+) (\d{4}) (.*)$/u);
      if (!m) continue;
      const [, d1, m1, y1, d2, m2, y2, rest] = m;
      const title = rest.split(', ').pop().replace(/^\d{4} /, '').replace(/^(.+?)\s+\1$/, '$1').trim();
      out.push(mk(SRC, { date: ymd(y1 || y2, mon(m1 || m2), d1), end: ymd(y2, mon(m2), d2), title, place: '', url: h }));
    }
  }
  const seen = new Set();
  return out.filter(e => { const k = e.title + e.date + e.url; if (seen.has(k)) return false; seen.add(k); return true; });
}

// ---------- kreisflohmi.ch ----------
async function flohmi(browser) {
  const items = await withPage(browser, 'https://kreisflohmi.ch/', p => p.$$eval('a[href*="karte/?kreis="]', as => as.map(a => ({ h: a.href, t: a.textContent.replace(/\s+/g, ' ').trim() }))));
  const seen = new Set(), out = [];
  for (const { h, t } of items) {
    const n = new URL(h).searchParams.get('kreis');
    const m = t.match(new RegExp(`kreis\\s*${n}\\s*(\\d{1,2})\\.(\\d{1,2})\\.(\\d{2})$`, 'i'));
    if (!m || seen.has(n)) continue; seen.add(n);
    out.push(mk('https://kreisflohmi.ch/', { date: ymd(2000 + +m[3], +m[2], +m[1]), time: '11:00 to 18:00', title: `Kreisflohmi Kreis ${n}`, place: 'Neighbourhood flea market', url: h }));
  }
  return out;
}


// ---------- stadt-zuerich.ch (Soziokultur Kinder / FamilienTreff, public JSON behind the page) ----------
async function stadt() {
  const SRC = 'https://www.stadt-zuerich.ch/de/stadtleben/zusammenleben/in-den-quartieren/familienfreizeit/in-ganz-zuerich.html';
  const cr = '/content/web/de/stadtleben/zusammenleben/in-den-quartieren/familienfreizeit/in-ganz-zuerich/jcr:content/mainparsys/teaser_copy_copy_cop_4863519';
  const r = await fetch(`https://www.stadt-zuerich.ch/stzh/search?lang=de&compResource=${encodeURIComponent(cr)}&limit=200`);
  if (!r.ok) throw new Error(`stadt-zuerich search ${r.status}`);
  const j = await r.json();
  console.log(`  stadt-zuerich: ${j.results?.length || 0} results`);
  return (j.results || []).map(x => {
    const [d, t1] = (x.eventDateStart || '').split('T'), t2 = (x.eventDateEnd || '').split('T')[1];
    const desc = (x.description || '').trim();
    const a2 = desc.match(/(\d{1,2})\s*[-–]\s*(\d{1,2}) Jahre/), a1 = desc.match(/ab (\d{1,2}) Jahre/);
    const place = (x.eventLocation || '').replace(/\(weitere Daten vorhanden\)/, '').split(',')[0].trim();
    return mk(SRC, {
      date: d, time: t1 ? (t2 && t2 !== t1 ? `${t1.slice(0, 5)} to ${t2.slice(0, 5)}` : t1.slice(0, 5)) : '',
      title: (x.heading || '').replace(/\s+/g, ' ').trim(), place, note: desc,
      min: a2 ? +a2[1] : a1 ? +a1[1] : null, max: a2 ? +a2[2] : null, url: new URL(x.href, 'https://www.stadt-zuerich.ch').href
    });
  }).filter(e => e.date);
}

// ---------- theater-purpur.ch ----------
async function purpur(browser) {
  const SRC = 'https://theater-purpur.ch/theater';
  const txt = await withPage(browser, SRC, async p => { await p.waitForTimeout(1500); return p.evaluate(() => document.body.innerText); });
  const L = txt.split('\n').map(l => l.trim()).filter(Boolean);
  const DRE = /^(?:Mo|Di|Mi|Do|Fr|Sa|So), (\d{1,2})\. (\p{L}+) (\d{4}) (\d{2}:\d{2})$/u;
  const out = [];
  for (let i = 0; i < L.length; i++) {
    if (!DRE.test(L[i]) || (i > 0 && DRE.test(L[i - 1]))) continue;
    let ti = i - 1, sold = false;
    if (/^ausverkauft$/i.test(L[ti])) { sold = true; ti--; }
    const title = L[ti];
    let j = i; const dates = [];
    while (j < L.length && DRE.test(L[j])) { dates.push(L[j].match(DRE)); j++; }
    const win = L.slice(j, j + 14);
    const pi = win.findIndex(l => /^Preise:/.test(l));
    const price = pi >= 0 ? (win[pi + 1] || '') : '';
    const am = win.find(l => /^(\d{1,2})\+$/.test(l));
    const min = am ? parseInt(am) : null;
    for (const m of dates) out.push(mk(SRC, { date: ymd(m[3], mon(m[2]), m[1]), time: m[4], title, place: 'Theater Purpur', min, note: [sold ? 'Sold out.' : '', price ? `Tickets: ${price}` : ''].filter(Boolean).join(' '), url: SRC }));
  }
  return out;
}

// ---------- ideesport.ch (MiniMove Kern, Sunday sessions) ----------
async function ideesport(browser) {
  const SRC = 'https://www.ideesport.ch/de/angebot/minimove/minimove-kern';
  const raw = await withPage(browser, SRC, async p => { await p.waitForTimeout(1500); return p.evaluate(() => document.body.innerText); });
  const L = raw.replace(/\u00ad/g, '').split('\n').map(l => l.trim()).filter(Boolean);
  const title = 'MiniMove Kern';
  const ortLine = L.find(l => /^Ort:/.test(l)) || '';
  const place = ortLine.replace(/^Ort:\s*/, '').replace(/,\s*8\d{3}.*$/, '').trim();
  const out = [];
  for (let i = 0; i < L.length; i++) {
    const d = L[i].match(/^(\d{2})\.(\d{2})\.(\d{4})$/); if (!d) continue;
    const t = (L[i + 1] || '').match(/^(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})$/); if (!t) continue;
    const rem = L[i + 2] && !/^(Sonntag|Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Ort:)/.test(L[i + 2]) ? L[i + 2] : '';
    out.push(mk(SRC, { date: ymd(d[3], d[2], d[1]), time: `${t[1]} to ${t[2]}`, title, place, min: 0, max: 6,
      cost: 0, note: ['Free, no registration.', rem].filter(Boolean).join(' '), url: SRC }));
  }
  console.log(`  ideesport: ${out.length} dates`);
  return out;
}

// ---------- main ----------
const SOURCES = {
  'https://kikuka.ch/kalender': kikuka,
  'https://gz-zh.ch/': gz,
  'https://zko.ch/kids/kinderkonzerte/': zko,
  'https://kinderregion.ch/de/veranstaltungen/': kinderregion,
  'https://kreisflohmi.ch/': flohmi,
  'https://www.stadt-zuerich.ch/de/stadtleben/zusammenleben/in-den-quartieren/familienfreizeit/in-ganz-zuerich.html': stadt,
  'https://theater-purpur.ch/theater': purpur,
  'https://www.ideesport.ch/de/angebot/minimove/minimove-kern': ideesport
};
let data = JSON.parse(fs.readFileSync('data/events.json', 'utf8'));
const browser = await chromium.launch();
let ok = 0;
const results = await Promise.all(Object.entries(SOURCES).map(async ([src, fn]) => {
  try {
    console.log(`Scraping ${src}`);
    const ev = (await fn(browser)).filter(keep);
    console.log(`  ${src} -> ${ev.length} events`);
    return { src, ev };
  } catch (err) { console.log(`  ${src} -> FAILED (${err.message.split('\n')[0]}), keeping previous data`); return { src, ev: [] }; }
}));
for (const { src, ev } of results) if (ev.length) { data = data.filter(e => e.source !== src).concat(ev); ok++; }
await browser.close();
fs.writeFileSync('data/events.json', JSON.stringify(data, null, 1));
console.log(`Done: ${ok}/${Object.keys(SOURCES).length} sources updated, ${data.length} events total`);
if (!ok) process.exit(1);
