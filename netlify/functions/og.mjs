// Link-preview image per word: /og?t=HELLO&s=123&b=paper → 1200×630 JPEG.
// Uses the same layout as the app (public/layout.js), with a simplified sticker shadow.
// Each URL is rendered once and then served from Netlify's durable CDN cache.
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { OG_FORMAT, variantCount, sanitize, stickerSrc, layoutScene } from '../../public/layout.js';

const SURFACES = {
  paper: { base: '#ecebe7', shadow: { r: 40, g: 32, b: 20 } },
  kraft: { base: '#c9a77c', shadow: { r: 60, g: 36, b: 12 } },
  mint: { base: '#cfe3d6', shadow: { r: 20, g: 45, b: 35 } },
  ink: { base: '#1d1d1f', shadow: { r: 0, g: 0, b: 0 } },
};

// Stickers ship with the function (included_files); fetching them from the site is the fallback.
async function loadSticker(src, origin) {
  try {
    return await readFile(path.join(process.cwd(), 'public', src));
  } catch {
    const res = await fetch(new URL(`/${src}`, origin));
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  }
}

function backdropSvg(W, H, base, dark) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs><radialGradient id="l" cx="25%" cy="15%" r="95%">
    <stop offset="0" stop-color="#fff" stop-opacity="${dark ? 0.07 : 0.35}"/>
    <stop offset="1" stop-color="#000" stop-opacity="0.10"/>
  </radialGradient></defs>
  <rect width="100%" height="100%" fill="${base}"/><rect width="100%" height="100%" fill="url(#l)"/></svg>`);
}

function lightPassSvg(W, H) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs><linearGradient id="p" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#fff" stop-opacity="0.22"/><stop offset="1" stop-color="#000" stop-opacity="0.18"/>
  </linearGradient></defs><rect width="100%" height="100%" fill="url(#p)"/></svg>`);
}

export default async (req) => {
  const url = new URL(req.url);
  const text = sanitize(url.searchParams.get('t') || '') || 'FRESH';
  const s = url.searchParams.get('s') || '';
  const seed = /^\d+$/.test(s) ? Number(s) : 1;
  const surfaceKey = SURFACES[url.searchParams.get('b')] ? url.searchParams.get('b') : 'paper';
  const surface = SURFACES[surfaceKey];
  const { w: W, h: H } = OG_FORMAT;

  const buffers = {};
  const aspects = {};
  const letters = [...new Set(text.replace(/[ /]/g, ''))];
  await Promise.all(letters.flatMap((L) =>
    Array.from({ length: variantCount(L) }, async (_, v) => {
      const buf = await loadSticker(stickerSrc(L, v), url.origin);
      if (!buf) return;
      const { width, height } = await sharp(buf).metadata();
      buffers[`${L}${v}`] = buf;
      aspects[`${L}${v}`] = width / height;
    })
  ));

  const { unit, drawList } = layoutScene({ text, seed, ...OG_FORMAT, aspects });
  const shadowPad = Math.ceil(unit * 0.1);
  const layers = [{ input: backdropSvg(W, H, surface.base, surfaceKey === 'ink') }];

  for (const [i, d] of drawList.entries()) {
    const buf = buffers[`${d.it.letter}${d.it.variant}`];
    if (!buf) continue;
    const lift = i / Math.max(1, drawList.length - 1);
    const resized = await sharp(buf).resize(Math.round(d.w), Math.round(d.h), { fit: 'fill' }).png().toBuffer();
    const { data: sticker, info } = await sharp(resized)
      .rotate((d.it.rot * 180) / Math.PI, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer({ resolveWithObject: true });
    const left = Math.round(d.cx - info.width / 2);
    const top = Math.round(d.cy - info.height / 2);

    // Shadow: the sticker's own silhouette, tinted and blurred, offset down-right; higher stickers cast further.
    const padded = await sharp(sticker)
      .extend({ top: shadowPad, bottom: shadowPad, left: shadowPad, right: shadowPad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    const shadow = await sharp({
      create: {
        width: info.width + shadowPad * 2,
        height: info.height + shadowPad * 2,
        channels: 4,
        background: { ...surface.shadow, alpha: 0.2 + 0.12 * lift },
      },
    })
      .composite([{ input: padded, blend: 'dest-in' }])
      .blur(Math.max(0.3, unit * (0.02 + 0.03 * lift)))
      .png()
      .toBuffer();

    layers.push({
      input: shadow,
      left: Math.max(0, left - shadowPad + Math.round(unit * (0.006 + 0.018 * lift))),
      top: Math.max(0, top - shadowPad + Math.round(unit * (0.016 + 0.04 * lift))),
    });
    layers.push({ input: sticker, left: Math.max(0, left), top: Math.max(0, top) });
  }
  layers.push({ input: lightPassSvg(W, H), blend: 'soft-light' });

  const jpeg = await sharp({ create: { width: W, height: H, channels: 3, background: surface.base } })
    .composite(layers)
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();

  return new Response(jpeg, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=86400',
      'Netlify-CDN-Cache-Control': 'public, durable, max-age=31536000, immutable',
    },
  });
};

export const config = { path: '/og' };
