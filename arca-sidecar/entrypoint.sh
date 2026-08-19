#!/bin/sh
set -e

# Sidecar ARCA — arranque.
# Acá NO se escriben certificados: llegan en cada request desde el core y se
# materializan por tenant en $ARCA_CACHE_DIR con permisos 0600.

CACHE_DIR="${ARCA_CACHE_DIR:-/tmp/arca_cache}"
mkdir -p "$CACHE_DIR"
chmod 700 "$CACHE_DIR"

# Herencia de BlendPos: los pickles viejos de pysimplesoap/pyafipws rompen el
# arranque después de un upgrade. Se limpian siempre.
find /usr/local/lib/python3.11/site-packages/pyafipws/cache -name '*.pkl' -delete 2>/dev/null || true

echo "Sidecar ARCA escuchando en :${ARCA_PORT:-8001}"
exec uvicorn main:app --host 0.0.0.0 --port "${ARCA_PORT:-8001}"
