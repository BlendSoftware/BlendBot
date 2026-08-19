# Panel (Vite + React) — build estático servido por nginx.
#
# El bundle NO necesita VITE_API_URL: el cliente pega a rutas relativas
# (`/api/...`) y nginx las proxya al core. Así la misma imagen sirve para
# cualquier dominio y no hay que rebuildear para cambiar de backend.
#
# Cache-busting (gotcha heredado del Copiloto Moodle): Vite ya emite los assets
# con hash en el nombre (`index-a1b2c3.js`), así que se pueden cachear para
# siempre. Lo que NO se cachea nunca es `index.html`, que es quien apunta al
# hash nuevo — si el navegador se queda con el index viejo, sirve el bundle
# viejo aunque el deploy haya salido bien. Eso está en nginx.conf.

FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# `vite build` a secas y no `npm run build`: el script del package.json corre
# antes `tsc --noEmit`, que es una verificación del desarrollador (y del CI),
# no del deploy. El chequeo de tipos se corre con `make panel-test`.
RUN npx vite build

# ──────────────────────────────────────────────────────────────────────────────

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
