// Post-build: the app is a single-page app, so every route is served the same
// index.html — which means every shared link (the shop, the recruitment page)
// previewed with the same title. This writes per-page copies of the built
// index.html with their own <title> and Open Graph tags; vercel.json then routes
// /shop and /join to these copies so each link previews correctly. The copies
// keep index.html's exact script/style tags, so the SPA still boots normally.
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const ORIGIN = 'https://tastyfoodph.vercel.app';

const base = readFileSync(join(DIST, 'index.html'), 'utf8');

function setTitle(html, v) {
  return html.replace(/<title>[\s\S]*?<\/title>/, `<title>${v}</title>`);
}
function setMetaProp(html, prop, v) {
  const re = new RegExp(`(<meta property="${prop}" content=")[\\s\\S]*?(" \\/>)`);
  return html.replace(re, `$1${v}$2`);
}
function setMetaName(html, name, v) {
  const re = new RegExp(`(<meta name="${name}" content=")[\\s\\S]*?(" \\/>)`);
  return html.replace(re, `$1${v}$2`);
}

const pages = [
  {
    file: 'shop.html',
    title: 'JuanPalaman — Order Online',
    ogTitle: 'JuanPalaman — Order Online',
    desc: 'Creamy, crunchy at choco spreads na may LIBRENG delivery. COD o pay-first. Mag-order na!',
    image: `${ORIGIN}/og-shop.png`,
    url: `${ORIGIN}/shop`,
  },
  {
    file: 'join.html',
    title: 'Be Our Distributor — Tasty Food',
    ogTitle: 'Be Our Distributor — Tasty Food',
    desc: 'Attend our free webinar and learn how to earn by selling JuanPalaman. Online via Zoom, no obligation.',
    image: `${ORIGIN}/og-join.png`,
    url: `${ORIGIN}/join`,
  },
];

for (const p of pages) {
  let html = base;
  html = setTitle(html, p.title);
  html = setMetaProp(html, 'og:title', p.ogTitle);
  html = setMetaProp(html, 'og:description', p.desc);
  html = setMetaProp(html, 'og:image', p.image);
  html = setMetaProp(html, 'og:url', p.url);
  html = setMetaName(html, 'description', p.desc);
  writeFileSync(join(DIST, p.file), html);
  console.log(`[og-pages] wrote dist/${p.file} — "${p.title}"`);
}
