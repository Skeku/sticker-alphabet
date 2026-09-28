// Downloads sticker PNGs, trims transparent padding and writes optimized webp files.
// Primary source: signed Magnific URLs in manifest.json (expire 2026-10-01).
// Fallback: stickers already published on the live site (FALLBACK_BASE).
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import sharp from 'sharp';

const OUT_DIR = new URL('../public/stickers/', import.meta.url);
const FALLBACK_BASE = process.env.FALLBACK_BASE || process.env.URL || '';
const TARGET_HEIGHT = 560;

const manifest = JSON.parse(await readFile(new URL('./manifest.json', import.meta.url), 'utf8'));
await mkdir(OUT_DIR, { recursive: true });

async function exists(url) {
  try { await access(url); return true; } catch { return false; }
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function processSticker(letter, index, url) {
  const name = `${letter}${index + 1}.webp`;
  const outUrl = new URL(name, OUT_DIR);
  if (await exists(outUrl)) return 'cached';

  try {
    const png = await download(url);
    const out = await sharp(png)
      .trim({ threshold: 10 })
      .resize({ height: TARGET_HEIGHT, withoutEnlargement: true })
      .webp({ quality: 88, alphaQuality: 100 })
      .toBuffer();
    await writeFile(outUrl, out);
    return 'source';
  } catch (err) {
    if (!FALLBACK_BASE) throw err;
    const out = await download(`${FALLBACK_BASE.replace(/\/$/, '')}/stickers/${name}`);
    await writeFile(outUrl, out);
    return 'fallback';
  }
}

const jobs = [];
for (const [letter, urls] of Object.entries(manifest)) {
  urls.forEach((url, i) => jobs.push({ letter, i, url }));
}

const stats = {};
const failures = [];
const CONCURRENCY = 8;
for (let k = 0; k < jobs.length; k += CONCURRENCY) {
  await Promise.all(jobs.slice(k, k + CONCURRENCY).map(async ({ letter, i, url }) => {
    try {
      const r = await processSticker(letter, i, url);
      stats[r] = (stats[r] || 0) + 1;
    } catch (err) {
      failures.push(`${letter}${i + 1}: ${err.message}`);
    }
  }));
}

console.log('Stickers:', stats);
if (failures.length) {
  console.error('Failed:', failures);
  process.exit(1);
}
