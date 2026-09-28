# Sticker Alphabet

Tipo: prototipo de un uso. No sigue el sistema de docs (backlog/devlog).

Mini web app para componer palabras con un alfabeto de pegatinas de fruta (PLU labels), pensada para compartir en X/Twitter.

## Stack
- Estático, sin framework: `public/index.html`, `public/app.js`, `public/style.css`.
- Render en Canvas 2D: sombras por canal alfa (contacto + ambiente), rotación/solape aleatorios, exportación PNG.
- 3 variantes por letra (A-Z), elegidas al azar: `public/stickers/{LETTER}{1-3}.webp`.

## Assets
- Generados con Magnific (GPT 2.5, fondo transparente), proyecto "Sticker Alphabet".
- Los textos impresos en las etiquetas son contenido de ejemplo inventado.
- `scripts/fetch-stickers.mjs` descarga, recorta (trim de alfa) y convierte a webp en el build de Netlify. Las URLs firmadas de `scripts/manifest.json` caducan el 2026-10-01; a partir de ahí el script usa como fallback los assets ya publicados en el sitio (`FALLBACK_BASE`).

## Deploy
Netlify, build `npm run build`, publish `public`.
