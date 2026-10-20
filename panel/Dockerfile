# Panel + landing en un solo servidor: la landing vive en la raíz y el panel
# en /panel/, ambos bundles estáticos servidos por el mismo nginx (ver
# nginx.conf). El contexto del build es la RAÍZ del repo (como gateway/Dockerfile):
# esta imagen necesita panel/ y landing/ juntos.
#
# El panel NO necesita VITE_API_URL: el cliente pega a rutas relativas
# (`/api/...`) y nginx las proxya al core, sea cual sea el path desde el que
# se sirvió el HTML. Así la misma imagen sirve para cualquier dominio.
#
# Cache-busting (gotcha heredado del Copiloto Moodle): Vite ya emite los assets
# con hash en el nombre (`index-a1b2c3.js`), así que se pueden cachear para
# siempre. Lo que NO se cachea nunca es cada `index.html` — son quienes
# apuntan al hash nuevo — si el navegador se queda con el viejo, sirve el
# bundle viejo aunque el deploy haya salido bien. Eso está en nginx.conf.

FROM node:22-alpine AS panel-build

WORKDIR /app/panel

COPY panel/package.json panel/package-lock.json ./
RUN npm ci

COPY panel/. .

# `vite build` a secas y no `npm run build`: el script del package.json corre
# antes `tsc --noEmit`, que es una verificación del desarrollador (y del CI),
# no del deploy. El chequeo de tipos se corre con `make panel-test`.
RUN npx vite build

# ──────────────────────────────────────────────────────────────────────────────

FROM node:22-alpine AS landing-build

WORKDIR /app/landing

COPY landing/package.json landing/package-lock.json ./
RUN npm ci

COPY landing/. .

# La landing sí va por `npm run build`: además de `vite build` hace el
# prerender (HTML ya renderizado para crawlers y vistas previas) y emite
# robots.txt y sitemap.xml. SITE_URL cambia el dominio que llevan.
RUN npx tsc --noEmit && npm run build

# ──────────────────────────────────────────────────────────────────────────────

FROM nginx:1.27-alpine

COPY panel/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=landing-build /app/landing/dist /usr/share/nginx/html
COPY --from=panel-build /app/panel/dist /usr/share/nginx/html/panel

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
