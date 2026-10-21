## 1. Prerender

- [x] 1.1 `src/entry-server.tsx` con `render()` y el JSON-LD. Ningún componente toca `window` o `document` al renderizar (todo está en efectos o handlers), así que `renderToString` anda sin stubs.
- [x] 1.2 `main.tsx` hidrata si `#root` ya trae HTML; en `npm run dev` viene vacío y monta de cero.
- [x] 1.3 `scripts/prerender.mjs` inyecta el HTML y el JSON-LD en `dist/index.html` y borra `dist-ssr/`. Falla fuerte si no encuentra el `<div id="root"></div>`: un build que no prerenderiza en silencio es peor que uno roto.
- [x] 1.4 `npm run build` corre los tres pasos; el `Dockerfile` pasó de `npx vite build` a `npm run build`. `dist-ssr` en `.gitignore` y `.dockerignore`.

## 2. Metadatos

- [x] 2.1 `site.config.mjs` con `SITE_URL` (default `https://blendbot.com.ar`). El plugin reemplaza `%SITE_URL%` con `order: 'pre'`: sin eso Vite parsea el HTML antes y revienta con *URI malformed* en el `href` del canonical.
- [x] 2.2 Título con "WhatsApp", "ARCA" y "restaurantes" (64 caracteres), description, canonical, Open Graph, Twitter Card, theme-color, `lang="es-AR"`.
- [x] 2.3 `og-image.png` 1200×630 desde `scripts/og-image.html` (Chrome headless, el comando está en el archivo) y `apple-touch-icon.png` 180×180.

## 3. Crawlers

- [x] 3.1 `robots.txt` (deja afuera `/panel/` y `/api/`) y `sitemap.xml` emitidos por el build del cliente, no por el SSR.
- [x] 3.2 JSON-LD: Organization, WebSite, SoftwareApplication (79.000 ARS/mes), FAQPage desde `FAQ_DATA`. Ojo: desde 2023 Google sólo muestra el FAQ enriquecido a sitios de gobierno y salud; igual le sirve a Bing y a los buscadores con IA.

## 4. Enlaces y contenido

- [x] 4.1 Logo → `/`; pie → `privacidad.html` y `mailto:`. `privacidad.html` ganó description e ícono.
- [x] 4.2 Respuestas del FAQ siempre en el HTML, con `hidden` cuando están cerradas.
- [x] 4.3 **Encontrado de paso**: el `fetchPriority="high"` del hero nunca llegaba al HTML. React 18 no conoce la prop y la descarta (el SSR lo avisó). Ahora va en minúscula.

## 5. Verificación

- [x] 5.1 `dist/index.html` trae el H1, el texto y las 6 respuestas del FAQ sin JavaScript, más 4 bloques JSON-LD.
- [x] 5.2 `vite preview`: hidrata sin errores en consola y el acordeón del FAQ abre.
