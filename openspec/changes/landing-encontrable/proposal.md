## Why

La landing es una SPA de Vite: el HTML que sirve nginx es un `<div id="root"></div>` vacío y todo el texto aparece recién cuando corre el JavaScript. Google lo termina renderizando, pero más tarde y con menos confianza; Bing, los buscadores con IA y **las vistas previas de WhatsApp, Facebook y LinkedIn ven una página en blanco**. Para un producto que se vende pasando el link por WhatsApp, eso es lo que más duele: el link sale sin título, sin imagen y sin descripción.

Además faltan las piezas básicas que cualquier crawler espera: `robots.txt`, `sitemap.xml`, `canonical`, Open Graph y datos estructurados.

## What Changes

1. **Prerender en el build.** `npm run build` arma el bundle del cliente, después un bundle SSR de `App`, y un script (`scripts/prerender.mjs`) escribe el HTML ya renderizado dentro de `dist/index.html`. En el navegador `main.tsx` hidrata en vez de montar de cero. No hay servidor nuevo: nginx sigue sirviendo estáticos.
2. **Metadatos en `index.html`**: título con las palabras que se buscan, `canonical`, Open Graph, Twitter Card, `theme-color`, `apple-touch-icon`.
3. **Imagen para compartir** `public/og-image.png` (1200×630), generada desde `scripts/og-image.html` para que se pueda rehacer.
4. **`robots.txt` y `sitemap.xml`** generados en el build con la URL del sitio.
5. **JSON-LD**: `Organization`, `WebSite`, `SoftwareApplication` (con el abono) y `FAQPage` armado desde `faqData.ts`, la misma fuente que pinta las preguntas.
6. **Detalles**: el logo enlaza a `/` en vez de `#`, el pie enlaza a la política de privacidad y el mail es un `mailto:`, y las respuestas del FAQ están en el HTML aunque estén cerradas (con `hidden`).

La URL del sitio sale de `SITE_URL` (por defecto `https://blendbot.com.ar`; falta confirmar el dominio real) y vive en un solo lugar: `site.config.mjs`.

## Fuera de alcance

- Cambiar el copy del H1. Hoy no nombra WhatsApp, pedidos ni ARCA; es una decisión de producto, no de SEO técnico.
- Autohospedar las fuentes o pasar las fotos de Unsplash a `public/` en WebP.
