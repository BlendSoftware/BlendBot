import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { SITE_URL, PAGINAS } from './site.config.mjs';

// Lo que un crawler necesita con la URL absoluta del sitio: reemplaza
// %SITE_URL% en index.html y emite robots.txt y sitemap.xml en el build.
function seo(): Plugin {
  return {
    name: 'blendbot-seo',
    // 'pre': antes de que Vite parsee el HTML, que rechaza "%SITE_URL%" en un href.
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replaceAll('%SITE_URL%', SITE_URL),
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: `User-agent: *\nAllow: /\nDisallow: /panel/\nDisallow: /api/\n\nSitemap: ${SITE_URL}/sitemap.xml\n`,
      });
      const hoy = new Date().toISOString().slice(0, 10);
      const urls = PAGINAS.map(
        (p) => `  <url><loc>${SITE_URL}${p}</loc><lastmod>${hoy}</lastmod></url>`,
      ).join('\n');
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
      });
    },
  };
}

// El build SSR del prerender no emite robots ni sitemap: eso es del cliente.
export default defineConfig(({ isSsrBuild }) => ({
  plugins: [react(), ...(isSsrBuild ? [] : [seo()])],
  server: {
    port: 5173,
    host: true
  }
}));
