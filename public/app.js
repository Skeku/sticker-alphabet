// Sticker Alphabet: composes words with fruit-sticker letters on a Canvas 2D stage.
const VARIANTS = 3;
// Letters with a 4th, fruit-shaped variant (O = orange, J = banana...).
const FRUIT_LETTERS = 'CDJOQSUVXY';
const variantCount = (letter) => VARIANTS + (FRUIT_LETTERS.includes(letter) ? 1 : 0);
// maxLetter: max letter height vs canvas height.
const FORMATS = {
  square: { w: 2160, h: 2160, maxLetter: 0.34 },
  wide: { w: 2400, h: 1350, maxLetter: 0.34 },
  banner: { w: 3000, h: 1000, maxLetter: 0.62 },
  story: { w: 1350, h: 2400, maxLetter: 0.3 },
};
// Holographic foil: rare, rolled per letter from its own RNG so it never shifts the layout of existing links.
const HOLO_CHANCE = 1 / 40;
const SURFACES = {
  paper: { base: '#ecebe7', shadow: '40, 32, 20' },
  kraft: { base: '#c9a77c', shadow: '60, 36, 12' },
  mint: { base: '#cfe3d6', shadow: '20, 45, 35' },
  ink: { base: '#1d1d1f', shadow: '0, 0, 0' },
};
const LAYOUT = {
  overlap: 0.9,        // advance = sticker width * overlap
  spaceWidth: 0.42,    // word gap, in letter-height units
  lineGap: 0.12,       // extra gap between lines, in letter-height units
  padding: 0.1,        // canvas padding, fraction of the shortest side
};

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const input = document.getElementById('text');
const loadingEl = document.getElementById('loading');
const statusEl = document.getElementById('status');

const state = {
  text: 'FRESH',
  seed: randomSeed(),
  format: 'square',
  surface: 'paper',
};

const imageCache = new Map();
let grainTile = null;
let renderToken = 0;
let scene = null; // last laid-out composition, reused by the video export
let recording = false;

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
function drawBackground(g, W, H) {
  const surface = SURFACES[state.surface];
  g.fillStyle = surface.base;
  g.fillRect(0, 0, W, H);

  // Soft key light from the top-left.
  const light = g.createRadialGradient(W * 0.25, H * 0.15, 0, W * 0.25, H * 0.15, Math.hypot(W, H) * 0.9);
  const dark = state.surface === 'ink';
  light.addColorStop(0, dark ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.35)');
  light.addColorStop(1, 'rgba(0,0,0,0.10)');
  g.fillStyle = light;
  g.fillRect(0, 0, W, H);

  // Paper grain.
  grainTile = grainTile || makeGrain();
  g.save();
  g.globalAlpha = dark ? 0.05 : 0.07;
  g.globalCompositeOperation = 'overlay';
  g.fillStyle = g.createPattern(grainTile, 'repeat');
  g.fillRect(0, 0, W, H);
  g.restore();
}

// Unifying light pass so all stickers share the same illumination.
function drawLightPass(g, W, H) {
  g.save();
  g.globalCompositeOperation = 'soft-light';
  const pass = g.createLinearGradient(0, 0, W, H);
  pass.addColorStop(0, 'rgba(255,255,255,0.22)');
  pass.addColorStop(1, 'rgba(0,0,0,0.18)');
  g.fillStyle = pass;
  g.fillRect(0, 0, W, H);
  g.restore();
}

let fxCanvas = null;

// Paints `paint(g, cw, ch)` into a scratch canvas, masked to the sticker's alpha.
function maskedLayer(img, cw, ch, paint) {
  fxCanvas = fxCanvas || document.createElement('canvas');
  fxCanvas.width = cw;
  fxCanvas.height = ch;
  const g = fxCanvas.getContext('2d');
  g.drawImage(img, 0, 0, cw, ch);
  g.globalCompositeOperation = 'source-in';
  paint(g, cw, ch);
  return fxCanvas;
}

// Gradient axis along the world light direction (top-left → bottom-right), counter-rotated into local space.
function lightAxis(g, cw, ch, rot) {
  const r = Math.hypot(cw, ch) / 2;
  const a = Math.PI / 4 - rot;
  const dx = Math.cos(a) * r, dy = Math.sin(a) * r;
  return g.createLinearGradient(cw / 2 - dx, ch / 2 - dy, cw / 2 + dx, ch / 2 + dy);
}

// Vinyl sheen: a diagonal highlight band that stays fixed top-left whatever the sticker's rotation.
function glossLayer(img, cw, ch, rot) {
  return maskedLayer(img, cw, ch, (g) => {
    const grad = lightAxis(g, cw, ch, rot);
    grad.addColorStop(0, 'rgba(255,255,255,0.10)');
    grad.addColorStop(0.3, 'rgba(255,255,255,0.26)');
    grad.addColorStop(0.42, 'rgba(255,255,255,0.03)');
    grad.addColorStop(0.7, 'rgba(255,255,255,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.10)');
    g.fillStyle = grad;
    g.fillRect(0, 0, cw, ch);
  });
}

// Holographic foil: repeating rainbow bands; `shift` slides them to make the foil shimmer in the video.
function holoLayer(img, cw, ch, rot, shift) {
  return maskedLayer(img, cw, ch, (g) => {
    const grad = lightAxis(g, cw, ch, rot);
    const bands = 3;
    for (let i = 0; i <= 24; i++) {
      const p = i / 24;
      const hue = ((p * bands + shift) * 360) % 360;
      grad.addColorStop(p, `hsl(${hue}, 95%, 62%)`);
    }
    g.fillStyle = grad;
    g.fillRect(0, 0, cw, ch);
  });
}

// k: output scale (canvas shadows ignore transforms, so their sizes are scaled by hand).
// lift: 0 = flat on the surface, 1 = top of the pile. Higher stickers cast longer, softer shadows.
function drawSticker(g, k, d, unit, lift, fx = {}) {
  const { img, w, h, it } = d;
  const scale = fx.scale ?? 1;
  const shadowRgb = SURFACES[state.surface].shadow;
  const px = unit * k;
  g.save();
  g.translate(d.cx, d.cy);
  g.rotate(it.rot + (fx.rot || 0));
  g.scale(scale, scale);
  g.globalAlpha = fx.alpha ?? 1;

  // Ambient shadow: wide and soft, falls down-right away from the key light.
  g.shadowColor = `rgba(${shadowRgb}, ${0.16 + 0.12 * Math.min(lift, 1)})`;
  g.shadowBlur = px * (0.035 + 0.07 * lift);
  g.shadowOffsetX = px * (0.006 + 0.018 * lift);
  g.shadowOffsetY = px * (0.016 + 0.04 * lift);
  g.drawImage(img, -w / 2, -h / 2, w, h);

  // Contact shadow: tight, where the vinyl touches the surface.
  g.shadowColor = `rgba(${shadowRgb}, 0.32)`;
  g.shadowBlur = px * 0.008;
  g.shadowOffsetX = px * 0.002;
  g.shadowOffsetY = px * 0.006;
  g.drawImage(img, -w / 2, -h / 2, w, h);
  g.shadowColor = 'transparent';

  const cw = Math.max(1, Math.ceil(w * k * scale)), ch = Math.max(1, Math.ceil(h * k * scale));
  if (it.holo) {
    const foil = holoLayer(img, cw, ch, it.rot, fx.shimmer || 0);
    const a = g.globalAlpha;
    g.globalCompositeOperation = 'color';
    g.globalAlpha = a * 0.5;
    g.drawImage(foil, -w / 2, -h / 2, w, h);
    g.globalCompositeOperation = 'overlay';
    g.globalAlpha = a * 0.45;
    g.drawImage(foil, -w / 2, -h / 2, w, h);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = a;
  }
  g.drawImage(glossLayer(img, cw, ch, it.rot), -w / 2, -h / 2, w, h);

  g.restore();
}

// Paints the scene at output scale k. With t (seconds) set, stickers slap down one by one in reading order.
function paint(g, k, t = null, sc = scene) {
  const { W, H, unit, drawList, anim } = sc;
  g.setTransform(k, 0, 0, k, 0, 0);
  drawBackground(g, W, H);
  const last = Math.max(1, drawList.length - 1);
  drawList.forEach((d, i) => {
    const lift = i / last;
    if (t === null) return drawSticker(g, k, d, unit, lift);
    const p = Math.min(1, Math.max(0, (t - anim.start(d.order)) / anim.drop));
    if (p <= 0) return;
    const e = easeOutBack(p);
    drawSticker(g, k, d, unit, lift + (1 - p) * 1.6, {
      scale: 1 + 0.4 * (1 - e),
      rot: (1 - e) * 0.18 * (d.order % 2 ? 1 : -1),
      alpha: Math.min(1, p * 4),
      shimmer: t * 0.35,
    });
  });
  drawLightPass(g, W, H);
  g.setTransform(1, 0, 0, 1, 0, 0);
}

function easeOutBack(x) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
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
    Array.from({ length: variantCount(L) }, async (_, v) => {
      const img = await loadImage(stickerSrc(L, v));
      if (img) aspects[`${L}${v}`] = img.naturalWidth / img.naturalHeight;
    })
  ));
  if (token !== renderToken) return;
  loadingEl.hidden = true;

  const avgAspect = (L) => {
    const vals = Array.from({ length: variantCount(L) }, (_, v) => aspects[`${L}${v}`]).filter(Boolean);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0.8;
  };

  const pad = Math.min(W, H) * LAYOUT.padding;
  const innerW = W - pad * 2;
  const innerH = H - pad * 2;

  const lineTexts = chooseLines(text, avgAspect, innerW, innerH);
  const rnd = mulberry32(state.seed);
  const holoRnd = mulberry32(state.seed ^ 0x5eed5);
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
  const unit = Math.min(innerW / maxWidth, innerH / totalHeight, H * FORMATS[state.format].maxLetter);

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
  for (const d of drawList) {
    d.img = await loadImage(stickerSrc(d.it.letter, d.it.variant));
    if (token !== renderToken) return;
  }

  const n = drawList.length;
  const stagger = Math.min(0.16, Math.max(0.07, 1.6 / Math.max(1, n)));
  const anim = { drop: 0.34, hold: 1.8, start: (order) => 0.25 + order * stagger };
  anim.total = anim.start(Math.max(0, n - 1)) + anim.drop + anim.hold;
  scene = { W, H, unit, drawList: drawList.filter((d) => d.img), anim };

  canvas.width = W;
  canvas.height = H;
  paint(ctx, 1);

  const holos = drawList.filter((d) => d.it.holo).length;
  setStatus(holos ? `Holo sticker! About 1 in 40 letters gets the foil.` : '');
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

function setStatus(msg) {
  statusEl.textContent = msg;
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

async function copyImage() {
  try {
    // Passing a promise keeps Safari's user-gesture requirement happy.
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': canvasBlob() })]);
    setStatus('Image copied. Paste it into a post.');
  } catch {
    setStatus('Copy is blocked in this browser. Use Download PNG instead.');
  }
}

const VIDEO_TYPES = ['video/mp4;codecs=avc1.42E01F', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
const videoType = () => window.MediaRecorder && VIDEO_TYPES.find((t) => MediaRecorder.isTypeSupported(t));

// Records the slap-down animation in real time from an offscreen canvas.
async function recordVideo(btn) {
  if (recording || !scene) return;
  const type = videoType();
  if (!type) return setStatus('Video export is not supported in this browser.');
  recording = true;
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Recording…';
  setStatus('Recording the video. Keep this tab open.');

  const sc = scene; // snapshot: typing during the recording must not change the clip
  const { W, H, anim } = sc;
  const k = Math.min(1080 / Math.min(W, H), 1920 / Math.max(W, H));
  const rec = document.createElement('canvas');
  rec.width = Math.round((W * k) / 2) * 2;
  rec.height = Math.round((H * k) / 2) * 2;
  const g = rec.getContext('2d');
  paint(g, k, 0, sc);

  const stream = rec.captureStream(30);
  const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8e6 });
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((resolve) => (recorder.onstop = resolve));
  recorder.start();

  const t0 = performance.now();
  await new Promise((resolve) => {
    const frame = () => {
      const t = (performance.now() - t0) / 1000;
      paint(g, k, Math.min(t, anim.total), sc);
      if (t < anim.total) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
  recorder.stop();
  await done;
  stream.getTracks().forEach((tr) => tr.stop());

  const ext = type.startsWith('video/mp4') ? 'mp4' : 'webm';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(chunks, { type: type.split(';')[0] }));
  a.download = fileName().replace(/\.png$/, `.${ext}`);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);

  setStatus(ext === 'webm' ? 'Saved as WebM. X needs MP4: convert it, or record in Safari or a recent Chrome.' : 'Video saved.');
  btn.textContent = label;
  btn.disabled = false;
  recording = false;
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
  const copyBtn = document.getElementById('copy');
  if (window.ClipboardItem && navigator.clipboard?.write) copyBtn.addEventListener('click', copyImage);
  else copyBtn.hidden = true;
  const videoBtn = document.getElementById('video');
  if (videoType()) videoBtn.addEventListener('click', () => recordVideo(videoBtn));
  else videoBtn.hidden = true;
  document.querySelectorAll('[data-suggest]').forEach((el) =>
    el.addEventListener('click', () => {
      state.text = sanitize(el.dataset.suggest);
      input.value = state.text;
      state.seed = randomSeed();
      render();
    })
  );
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
