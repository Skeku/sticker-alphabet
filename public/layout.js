// Pure layout shared by the browser renderer (app.js) and the link-preview function (netlify/functions/og.mjs).
// Same text + seed + format must give the same stickers in both.
export const VARIANTS = 3;
// Letters with a 4th, fruit-shaped variant (O = orange, J = banana...).
export const FRUIT_LETTERS = 'CDJOQSUVXY';
export const variantCount = (letter) => VARIANTS + (FRUIT_LETTERS.includes(letter) ? 1 : 0);
// maxLetter: max letter height vs canvas height.
export const FORMATS = {
  square: { w: 2160, h: 2160, maxLetter: 0.34 },
  wide: { w: 2400, h: 1350, maxLetter: 0.34 },
  banner: { w: 3000, h: 1000, maxLetter: 0.62 },
  story: { w: 1350, h: 2400, maxLetter: 0.3 },
};
// Link-preview card (Open Graph), rendered by netlify/functions/og.mjs.
export const OG_FORMAT = { w: 1200, h: 630, maxLetter: 0.36 };
// Holographic foil: rare, rolled per letter from its own RNG so it never shifts the layout of existing links.
export const HOLO_CHANCE = 1 / 40;
export const LAYOUT = {
  overlap: 0.9,        // advance = sticker width * overlap
  spaceWidth: 0.42,    // word gap, in letter-height units
  lineGap: 0.12,       // extra gap between lines, in letter-height units
  padding: 0.1,        // canvas padding, fraction of the shortest side
};

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sanitize(text) {
  return text.toUpperCase().replace(/[^A-Z /]/g, '').replace(/ {2,}/g, ' ').slice(0, 40);
}

export function stickerSrc(letter, variant) {
  return `stickers/${letter}${variant + 1}.webp`;
}

function measure(lines) {
  // Recompute x positions with real aspect ratios.
  let maxWidth = 0;
  for (const items of lines) {
    let x = 0;
    let prev = null;
    for (const it of items) {
      if (prev && it.gapBefore) x += LAYOUT.spaceWidth;
      it.x = x;
      x += it.aspect * it.scale * LAYOUT.overlap;
      prev = it;
    }
    const last = items[items.length - 1];
    const width = last ? last.x + last.aspect * last.scale : 0;
    items.width = width;
    maxWidth = Math.max(maxWidth, width);
  }
  return maxWidth;
}

// Chooses line breaks: explicit "/" first, then greedy word wrap to best fill the canvas.
function chooseLines(text, aspectOf, canvasW, canvasH) {
  const explicit = text.split('/').map((s) => s.trim()).filter(Boolean);
  const words = explicit.map((l) => l.split(' ').filter(Boolean));
  const approxWidth = (ws) =>
    ws.reduce((sum, w) => sum + [...w].reduce((s, ch) => s + aspectOf(ch) * LAYOUT.overlap, 0), 0) +
    Math.max(0, ws.length - 1) * LAYOUT.spaceWidth;

  let best = null;
  const totalWords = words.reduce((n, ws) => n + ws.length, 0);
  for (let maxLines = words.length; maxLines <= Math.max(words.length, totalWords); maxLines++) {
    const lines = [];
    for (const ws of words) {
      // Split each explicit line into roughly balanced chunks.
      const share = Math.max(1, Math.round((maxLines * ws.length) / totalWords));
      const target = approxWidth(ws) / share;
      let cur = [];
      for (const w of ws) {
        if (cur.length && approxWidth([...cur, w]) > target * 1.15) { lines.push(cur); cur = []; }
        cur.push(w);
      }
      if (cur.length) lines.push(cur);
    }
    const width = Math.max(...lines.map(approxWidth));
    const height = lines.length + (lines.length - 1) * LAYOUT.lineGap;
    const s = Math.min(canvasW / width, canvasH / height);
    if (!best || s > best.s * 1.02) best = { s, lines: lines.map((ws) => ws.join(' ')) };
  }
  return best ? best.lines : [];
}

// Picks variants and positions. aspects: { 'A0': width/height, ... } for the variants of the letters in use.
// Returns draw items sorted back-to-front, each with its reading order.
export function layoutScene({ text, seed, w: W, h: H, maxLetter, aspects }) {
  const avgAspect = (L) => {
    const vals = Array.from({ length: variantCount(L) }, (_, v) => aspects[`${L}${v}`]).filter(Boolean);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0.8;
  };

  const pad = Math.min(W, H) * LAYOUT.padding;
  const innerW = W - pad * 2;
  const innerH = H - pad * 2;

  const lineTexts = chooseLines(text, avgAspect, innerW, innerH);
  const rnd = mulberry32(seed);
  const holoRnd = mulberry32(seed ^ 0x5eed5);
  const lines = lineTexts.map((line) => {
    const items = [];
    let gap = false;
    for (const ch of line) {
      if (ch === ' ') { gap = true; continue; }
      const variant = Math.floor(rnd() * variantCount(ch));
      items.push({
        letter: ch,
        variant,
        aspect: aspects[`${ch}${variant}`] || 0.8,
        rot: (rnd() - 0.5) * 0.2,
        dy: (rnd() - 0.5) * 0.08,
        scale: 0.94 + rnd() * 0.1,
        z: rnd(),
        holo: holoRnd() < HOLO_CHANCE,
        gapBefore: gap,
      });
      gap = false;
    }
    return items;
  }).filter((items) => items.length);

  const maxWidth = measure(lines);
  const totalHeight = lines.length + (lines.length - 1) * LAYOUT.lineGap;
  const unit = Math.min(innerW / maxWidth, innerH / totalHeight, H * maxLetter);

  const blockH = totalHeight * unit;
  const top = (H - blockH) / 2;
  const drawList = [];
  lines.forEach((items, li) => {
    const left = (W - items.width * unit) / 2;
    const lineTop = top + li * (1 + LAYOUT.lineGap) * unit;
    for (const it of items) {
      const h = unit * it.scale;
      const w = h * it.aspect;
      drawList.push({
        it,
        order: drawList.length, // reading order, for the video
        cx: left + it.x * unit + w / 2,
        cy: lineTop + unit / 2 + it.dy * unit,
        w, h,
      });
    }
  });

  drawList.sort((a, b) => a.it.z - b.it.z);
  return { unit, drawList };
}
