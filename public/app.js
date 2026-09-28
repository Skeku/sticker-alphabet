// Sticker Alphabet: composes words with fruit-sticker letters on a Canvas 2D stage.
const VARIANTS = 3;
const FORMATS = {
  square: { w: 2160, h: 2160 },
  wide: { w: 2400, h: 1350 },
};
const SURFACES = {
  paper: { base: '#ecebe7', shadow: '40, 32, 20' },
  kraft: { base: '#c9a77c', shadow: '60, 36, 12' },
  mint: { base: '#cfe3d6', shadow: '20, 45, 35' },
  ink: { base: '#1d1d1f', shadow: '0, 0, 0' },
};
const LAYOUT = {
  overlap: 0.84,       // advance = sticker width * overlap
  spaceWidth: 0.42,    // word gap, in letter-height units
  lineGap: 0.12,       // extra gap between lines, in letter-height units
  padding: 0.1,        // canvas padding, fraction of the shortest side
  maxLetterRatio: 0.34 // max letter height vs canvas height
};

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const input = document.getElementById('text');
const loadingEl = document.getElementById('loading');

const state = {
  text: 'FRESH',
  seed: randomSeed(),
  format: 'square',
  surface: 'paper',
};

const imageCache = new Map();
let grainTile = null;
let renderToken = 0;

// ---------- utils ----------
function randomSeed() {
  return Math.floor(Math.random() * 1e9);
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sanitize(text) {
  return text.toUpperCase().replace(/[^A-Z /]/g, '').replace(/ {2,}/g, ' ').slice(0, 40);
}

function loadImage(src) {
  if (imageCache.has(src)) return imageCache.get(src);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
  imageCache.set(src, p);
  return p;
}

function stickerSrc(letter, variant) {
  return `stickers/${letter}${variant + 1}.webp`;
}

function makeGrain() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const data = g.createImageData(size, size);
  const rnd = mulberry32(7);
  for (let i = 0; i < data.data.length; i += 4) {
    const v = 128 + (rnd() - 0.5) * 70;
    data.data[i] = data.data[i + 1] = data.data[i + 2] = v;
    data.data[i + 3] = 255;
  }
  g.putImageData(data, 0, 0);
  return c;
}

// ---------- layout ----------
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

// ---------- render ----------
function drawBackground(W, H) {
  const surface = SURFACES[state.surface];
  ctx.fillStyle = surface.base;
  ctx.fillRect(0, 0, W, H);

  // Soft key light from the top-left.
  const light = ctx.createRadialGradient(W * 0.25, H * 0.15, 0, W * 0.25, H * 0.15, Math.hypot(W, H) * 0.9);
  const dark = state.surface === 'ink';
  light.addColorStop(0, dark ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.35)');
  light.addColorStop(1, 'rgba(0,0,0,0.10)');
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, W, H);

  // Paper grain.
  grainTile = grainTile || makeGrain();
  ctx.save();
  ctx.globalAlpha = dark ? 0.05 : 0.07;
  ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = ctx.createPattern(grainTile, 'repeat');
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

function drawSticker(img, cx, cy, w, h, rot, unit) {
  const shadowRgb = SURFACES[state.surface].shadow;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);

  // Ambient shadow: wide and soft, falls down-right away from the key light.
  ctx.shadowColor = `rgba(${shadowRgb}, 0.22)`;
  ctx.shadowBlur = unit * 0.06;
  ctx.shadowOffsetX = unit * 0.012;
  ctx.shadowOffsetY = unit * 0.03;
  ctx.drawImage(img, -w / 2, -h / 2, w, h);

  // Contact shadow: tight, where the vinyl touches the surface.
  ctx.shadowColor = `rgba(${shadowRgb}, 0.32)`;
  ctx.shadowBlur = unit * 0.008;
  ctx.shadowOffsetX = unit * 0.002;
  ctx.shadowOffsetY = unit * 0.006;
  ctx.drawImage(img, -w / 2, -h / 2, w, h);

  ctx.restore();
}

async function render() {
  const token = ++renderToken;
  const { w: W, h: H } = FORMATS[state.format];
  const text = sanitize(state.text) || 'FRESH';
  const letters = [...new Set(text.replace(/[ /]/g, ''))];

  // Preload all variants of the letters in use, so shuffling is instant.
  loadingEl.hidden = false;
  const aspects = {};
  await Promise.all(letters.flatMap((L) =>
    Array.from({ length: VARIANTS }, async (_, v) => {
      const img = await loadImage(stickerSrc(L, v));
      if (img) aspects[`${L}${v}`] = img.naturalWidth / img.naturalHeight;
    })
  ));
  if (token !== renderToken) return;
  loadingEl.hidden = true;

  const avgAspect = (L) => {
    const vals = [0, 1, 2].map((v) => aspects[`${L}${v}`]).filter(Boolean);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0.8;
  };

  canvas.width = W;
  canvas.height = H;
  drawBackground(W, H);

  const pad = Math.min(W, H) * LAYOUT.padding;
  const innerW = W - pad * 2;
  const innerH = H - pad * 2;

  const lineTexts = chooseLines(text, avgAspect, innerW, innerH);
  const rnd = mulberry32(state.seed);
  const lines = lineTexts.map((line) => {
    const items = [];
    let gap = false;
    for (const ch of line) {
      if (ch === ' ') { gap = true; continue; }
      const variant = Math.floor(rnd() * VARIANTS);
      items.push({
        letter: ch,
        variant,
        aspect: aspects[`${ch}${variant}`] || 0.8,
        rot: (rnd() - 0.5) * 0.2,
        dy: (rnd() - 0.5) * 0.08,
        scale: 0.94 + rnd() * 0.1,
        z: rnd(),
        gapBefore: gap,
      });
      gap = false;
    }
    return items;
  }).filter((items) => items.length);

  const maxWidth = measure(lines);
  const totalHeight = lines.length + (lines.length - 1) * LAYOUT.lineGap;
  const unit = Math.min(innerW / maxWidth, innerH / totalHeight, H * LAYOUT.maxLetterRatio);

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
        cx: left + it.x * unit + w / 2,
        cy: lineTop + unit / 2 + it.dy * unit,
        w, h,
      });
    }
  });

  drawList.sort((a, b) => a.it.z - b.it.z);
  for (const d of drawList) {
    const img = await loadImage(stickerSrc(d.it.letter, d.it.variant));
    if (token !== renderToken) return;
    if (img) drawSticker(img, d.cx, d.cy, d.w, d.h, d.it.rot, unit);
  }

  // Unifying light pass so all stickers share the same illumination.
  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  const pass = ctx.createLinearGradient(0, 0, W, H);
  pass.addColorStop(0, 'rgba(255,255,255,0.22)');
  pass.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = pass;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  syncUrl();
}

// ---------- state <-> URL ----------
function syncUrl() {
  const params = new URLSearchParams({
    t: sanitize(state.text),
    s: String(state.seed),
    f: state.format,
    b: state.surface,
  });
  history.replaceState(null, '', `?${params}`);
}

function readUrl() {
  const p = new URLSearchParams(location.search);
  if (p.get('t')) state.text = sanitize(p.get('t'));
  if (p.get('s') && /^\d+$/.test(p.get('s'))) state.seed = Number(p.get('s'));
  if (FORMATS[p.get('f')]) state.format = p.get('f');
  if (SURFACES[p.get('b')]) state.surface = p.get('b');
}

// ---------- export ----------
function fileName() {
  const slug = sanitize(state.text).replace(/[ /]+/g, '-').toLowerCase() || 'stickers';
  return `sticker-alphabet-${slug}.png`;
}

function canvasBlob() {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

async function download() {
  const blob = await canvasBlob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName();
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function share() {
  const blob = await canvasBlob();
  const file = new File([blob], fileName(), { type: 'image/png' });
  const text = `${sanitize(state.text).replace(/\//g, ' ')} in fruit stickers`;
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text, url: location.href });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  const intent = new URL('https://x.com/intent/post');
  intent.searchParams.set('text', text);
  intent.searchParams.set('url', location.href);
  window.open(intent, '_blank', 'noopener');
}

// ---------- UI ----------
function setActive(selector, attr, value) {
  document.querySelectorAll(selector).forEach((el) => {
    const on = el.dataset[attr] === value;
    el.classList.toggle('is-on', on);
    el.setAttribute('aria-pressed', String(on));
  });
}

function bind() {
  let timer;
  input.addEventListener('input', () => {
    const clean = sanitize(input.value);
    if (clean !== input.value.toUpperCase()) input.value = clean;
    state.text = clean;
    clearTimeout(timer);
    timer = setTimeout(render, 120);
  });
  document.getElementById('composer').addEventListener('submit', (e) => { e.preventDefault(); render(); });
  document.getElementById('shuffle').addEventListener('click', () => { state.seed = randomSeed(); render(); });
  document.getElementById('download').addEventListener('click', download);
  document.getElementById('share').addEventListener('click', share);
  document.querySelectorAll('[data-format]').forEach((el) =>
    el.addEventListener('click', () => {
      state.format = el.dataset.format;
      setActive('[data-format]', 'format', state.format);
      render();
    })
  );
  document.querySelectorAll('[data-bg]').forEach((el) =>
    el.addEventListener('click', () => {
      state.surface = el.dataset.bg;
      setActive('[data-bg]', 'bg', state.surface);
      render();
    })
  );
}

readUrl();
input.value = state.text;
setActive('[data-format]', 'format', state.format);
setActive('[data-bg]', 'bg', state.surface);
bind();
render();
