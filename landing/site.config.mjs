// URL pública de la landing. La usan el canonical, Open Graph, el sitemap,
// robots.txt y el JSON-LD: todo lo que un crawler necesita en absoluto.
// Se pisa con SITE_URL al buildear (`SITE_URL=https://otro.dominio npm run build`).
export const SITE_URL = (process.env.SITE_URL || 'https://blendbot.com.ar').replace(/\/+$/, '');

// Páginas que van al sitemap, relativas a SITE_URL.
export const PAGINAS = ['/', '/privacidad.html'];
