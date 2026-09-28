// Shared links (/?t=HELLO&s=...) get a link-preview card of that exact word:
// swaps the static og:image / title for /og?t=...&s=...&b=... in the HTML crawlers read.
import { sanitize } from '../../public/layout.js';

const escapeAttr = (v) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

export default async (request, context) => {
  const url = new URL(request.url);
  const text = sanitize(url.searchParams.get('t') || '');
  if (!text) return;

  const res = await context.next();
  if (!res.headers.get('content-type')?.includes('text/html')) return res;

  const image = new URL('/og', url.origin);
  image.searchParams.set('t', text);
  for (const key of ['s', 'b']) {
    const v = url.searchParams.get(key);
    if (v && /^[a-z0-9]+$/i.test(v)) image.searchParams.set(key, v);
  }
  const word = text.replace(/\s*\/\s*/g, ' ');
  const title = `${word} in fruit stickers`;

  const html = (await res.text())
    .replace(/(<meta property="og:image" content=")[^"]*/, `$1${escapeAttr(image.href)}`)
    .replace(/(<meta name="twitter:image" content=")[^"]*/, `$1${escapeAttr(image.href)}`)
    .replace(/(<meta property="og:image:alt" content=")[^"]*/, `$1${escapeAttr(`The word ${word} spelled out in fruit stickers`)}`)
    .replace(/(<meta property="og:title" content=")[^"]*/, `$1${escapeAttr(title)}`)
    .replace(/(<meta property="og:url" content=")[^"]*/, `$1${escapeAttr(url.href)}`);

  const headers = new Headers(res.headers);
  headers.delete('content-length');
  return new Response(html, { status: res.status, headers });
};

export const config = { path: '/' };
