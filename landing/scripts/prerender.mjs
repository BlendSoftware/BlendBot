// Último paso de `npm run build`: toma el bundle SSR (dist-ssr/) y escribe el
// HTML de la landing ya renderizado dentro de dist/index.html, más el JSON-LD
// en el <head>. Así los crawlers y las vistas previas de WhatsApp ven el texto
// sin ejecutar JavaScript; en el navegador main.tsx hidrata ese HTML.
import { readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SITE_URL } from '../site.config.mjs';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const indexHtml = `${raiz}dist/index.html`;
const ssrDir = `${raiz}dist-ssr`;

const { render, jsonLd } = await import(pathToFileURL(`${ssrDir}/entry-server.js`).href);

const html = await readFile(indexHtml, 'utf8');
const MARCA_ROOT = '<div id="root"></div>';
if (!html.includes(MARCA_ROOT)) {
  throw new Error(`prerender: no encontré ${MARCA_ROOT} en dist/index.html`);
}

// `<` escapado: un "</script>" dentro de un texto del FAQ no puede cerrar el tag.
const ld = jsonLd(SITE_URL)
  .map((d) => `<script type="application/ld+json">${JSON.stringify(d).replace(/</g, '\\u003c')}</script>`)
  .join('\n    ');

const final = html
  .replace(MARCA_ROOT, `<div id="root">${render()}</div>`)
  .replace('</head>', `    ${ld}\n  </head>`);

await writeFile(indexHtml, final);
await rm(ssrDir, { recursive: true, force: true });

console.log(`prerender: dist/index.html listo (${(final.length / 1024).toFixed(0)} KB, ${SITE_URL})`);
