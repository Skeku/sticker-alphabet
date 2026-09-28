# Sticker Alphabet

Type a word, get it spelled out in fruit stickers. Download it as a PNG or share it.

**Live demo:** https://sticker-alphabet.netlify.app

Inspired by [this photo by @rare_jpg](https://x.com/rare_jpg/status/2104225566643704270). Made by [@Skeku](https://x.com/Skeku) with Claude and Magnific.

## Features

- A–Z and spaces, up to 40 characters. Use `/` to force a line break.
- Three sticker variants per letter, picked at random, plus a fourth one where the letter's shape suggests a fruit: C bitten apple, D half lemon, J banana, O orange, Q apple with its stem as the tail, S orange-peel spiral, U melon slice, V watermelon wedge, X crossed bananas, Y cherries. **Shuffle** re-rolls them.
- Quick suggestions (GM, SHIP IT, LFG…) to get started in one tap.
- About 1 in 40 letters comes out as a **holographic foil** sticker, drawn on the canvas with no extra assets.
- Four formats: 1:1 (2160×2160), 16:9 (2400×1350), 9:16 for stories (1350×2400) and 3:1 for an X header (3000×1000). Four surfaces: paper, kraft, mint and ink.
- **Download PNG** exports at full resolution. **Save video** records the stickers slapping down one by one as an MP4 (WebM in browsers that can't record MP4), right in the browser. **Copy image** puts the PNG on the clipboard. **Share** uses the native share sheet with the image where available, and falls back to a post on X.
- Exports carry a small site credit in the corner, which you can switch off.
- Shared links get a preview card of that exact word: an edge function (`netlify/edge-functions/og-meta.js`) points `og:image` at `/og`, a function (`netlify/functions/og.mjs`) that renders it with `sharp` using the same layout as the app (`public/layout.js`). Each preview is rendered once and then cached on the CDN.
- The whole composition lives in the URL (`?t=HELLO&s=123&f=square&b=paper`), so any result can be linked and reproduced.

## How it works

Plain HTML, CSS and JavaScript, no framework. Everything is drawn on a 2D canvas:

- Letters are placed with a small random rotation, vertical jitter, scale and overlap, all driven by a seeded RNG.
- Shadows are cast from each sticker's alpha channel: a tight contact shadow plus an ambient one that grows with stacking order, so stickers on top of the pile look lifted.
- A vinyl gloss band is masked to each sticker, and a final light pass keeps the illumination consistent across the whole scene.

## Run locally

```bash
python3 -m http.server 5173 -d public
```

Then open http://localhost:5173. The processed stickers are committed in `public/stickers/`, so no build step is needed. The link-preview functions only run on Netlify (or with `netlify dev`).

## Stickers

The 88 stickers (26 letters × 3 variants, plus 10 fruit-shaped ones) were generated with Magnific (GPT 2.5, transparent background). `scripts/fetch-stickers.mjs` downloads the source PNGs, trims the transparent padding and converts them to WebP with `sharp`:

```bash
npm install
npm run build
```

Existing files are skipped. The signed source URLs in `scripts/manifest.json` expire on 2026-10-01.

The brands, slogans and PLU codes printed on the stickers are made up.
