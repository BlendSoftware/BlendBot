# Gateway (Node) + agente MCP (Python).
#
# OJO: el contexto de build es la RAÍZ del repo, no `gateway/`. El gateway
# levanta el server MCP con `uv --directory <raiz>/agente run python server.py`,
# así que la imagen tiene que traer el agente adentro. Un gateway sin `agente/`
# arranca, contesta el webhook… y falla en el primer mensaje real.
#
#   docker build -f gateway/Dockerfile .
#
# El venv del agente se resuelve en tiempo de BUILD (`uv sync --frozen`): si se
# dejara para el primer mensaje, el primer cliente del día esperaría a que uv
# baje Python y las dependencias mientras el modelo tiene 90s de techo.

FROM ghcr.io/astral-sh/uv:0.12.5 AS uvbin

FROM node:22-bookworm-slim

# uv trae su propio Python: no hace falta python3 del sistema.
COPY --from=uvbin /uv /uvx /usr/local/bin/

# El intérprete y el cache van al HOME del usuario `node`, que es donde uv los
# busca POR DEFECTO. No es cosmético: el gateway lanza el MCP con un entorno
# mínimo (sólo PATH y HOME, para no filtrarle las API keys), así que estas
# variables NO llegan al proceso hijo. Si el Python de uv viviera en /opt, el
# MCP no lo encontraría y trataría de bajarse uno en medio de una conversación.
ENV UV_PYTHON_INSTALL_DIR=/home/node/.local/share/uv/python \
    UV_CACHE_DIR=/home/node/.cache/uv \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1

WORKDIR /app

# ── Node: sólo dependencias de runtime ───────────────────────────────────────
COPY gateway/package.json gateway/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY gateway/src ./src
COPY gateway/tenants.example.json ./tenants.example.json

# tenants.json por defecto: vacío. Sin esto el gateway no arranca si nadie
# montó el archivo real. Con esto arranca sin tenants y lo dice en el log.
RUN echo '{}' > /app/tenants.json

# ── Agente MCP (Python) ──────────────────────────────────────────────────────
COPY agente /opt/copiloto/agente
RUN uv sync --frozen --directory /opt/copiloto/agente

# El proceso escribe los resume-id de sesión a disco (si se pierden, cada
# conversación en curso arranca de cero) y uv toca el venv al resolverlo.
RUN mkdir -p /app/data/sesiones && \
    chown -R node:node /app /opt/copiloto /home/node

ENV PORT=8090 \
    TENANTS_PATH=/app/tenants.json \
    SESIONES_DIR=/app/data/sesiones \
    RAIZ_REPO=/opt/copiloto \
    NODE_ENV=production

USER node

EXPOSE 8090

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8090)+'/salud').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
