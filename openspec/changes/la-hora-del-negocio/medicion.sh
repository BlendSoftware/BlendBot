#!/usr/bin/env bash
#
# medicion.sh — qué endpoints devuelven la hora en la TZ del negocio y cuáles en UTC.
#
# Es la evidencia del cambio `la-hora-del-negocio`: se corre ANTES para fijar el
# punto de partida y DESPUÉS para demostrar que quedó en cero. No reemplaza a los
# tests; es lo que se pega en el proposal para que el antes/después sea un dato y
# no una afirmación.
#
#   bash openspec/changes/la-hora-del-negocio/medicion.sh
#
# Necesita el compose arriba y un negocio con datos (ver el seed del panel).
# Sale 0 si NINGUNA hora viaja en UTC; 1 si alguna todavía sale con `Z`.
#
# Variables:
#   CORE_PORT                       puerto del core (default 8080)
#   USUARIO / CLAVE                 dueño del negocio a medir
#   ADMIN_USUARIO / ADMIN_CLAVE     admin de plataforma (mide /api/admin/*)

set -Eeuo pipefail

CORE_PORT="${CORE_PORT:-8080}"
BASE="http://localhost:${CORE_PORT}"
USUARIO="${USUARIO:-fogon}"
CLAVE="${CLAVE:-fogon-dev-2026}"
ADMIN_USUARIO="${ADMIN_USUARIO:-admin}"
ADMIN_CLAVE="${ADMIN_CLAVE:-cambiame-admin-dev}"

command -v curl >/dev/null || { echo "hace falta curl" >&2; exit 2; }
PY=$(command -v python3 || command -v python) || { echo "hace falta python3" >&2; exit 2; }

login() {
  curl -sS -X POST "${BASE}/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"$1\",\"password\":\"$2\"}" \
  | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p'
}

TOKEN=$(login "$USUARIO" "$CLAVE")
[[ -n $TOKEN ]] || { echo "no pude entrar como $USUARIO" >&2; exit 2; }
TOKEN_ADMIN=$(login "$ADMIN_USUARIO" "$ADMIN_CLAVE")

export BASE TOKEN TOKEN_ADMIN

"$PY" - <<'PYEOF'
import json, os, sys, urllib.request, urllib.error
from datetime import datetime

BASE = os.environ["BASE"]

def get(ruta, token):
    req = urllib.request.Request(BASE + ruta)
    req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        return {"__http__": e.code}

def primero(d):
    """La primera fila de un listado, o el objeto tal cual."""
    if isinstance(d, list):
        return d[0] if d else None
    return d

# (etiqueta, ruta, token, cómo llegar al objeto que lleva la hora, campos, espera)
#
# `espera` es "local" o "utc". Las rutas de plataforma van en UTC A PROPÓSITO
# (design §4): son cross-tenant y no tienen una timezone única. Que salgan con
# `Z` es lo correcto, no un hallazgo — por eso no cuentan como falla.
TOK, ADM = os.environ["TOKEN"], os.environ["TOKEN_ADMIN"]
SONDAS = [
    ("compromiso",  "/api/compromisos",    TOK, lambda d: primero(d),              ["creado_en", "confirmado_en"], "local"),
    ("consulta",    "/api/consultas",      TOK, lambda d: primero(d),              ["creado_en", "respondida_en"], "local"),
    ("jornada",     "/api/jornada/actual", TOK, lambda d: (d or {}).get("jornada"), ["abierta_en", "cerrada_en"],  "local"),
    ("cliente",     "/api/clientes",       TOK, lambda d: primero(d),              ["creado_en", "ultimo_pedido"], "local"),
    ("lista_espera","/api/lista-espera",   TOK, lambda d: primero(d),              ["creado_en", "notificado_en"], "local"),
    ("negocio(admin)", "/api/admin/negocios", ADM, lambda d: primero(d),           ["creado_en"],                  "utc"),
]

# Los movimientos de insumo cuelgan de un insumo: hay que resolverlo primero.
insumos = get("/api/insumos", TOK)
if isinstance(insumos, list) and insumos:
    iid = insumos[0]["id"]
    SONDAS.append(("movimiento", f"/api/insumos/{iid}/movimientos", TOK,
                   lambda d: primero(d), ["creado_en"], "local"))

# El cobro cuelga de un compromiso completado.
comps = get("/api/compromisos", TOK)
if isinstance(comps, list):
    hechos = [c for c in comps if c.get("estado") == "completado"]
    if hechos:
        SONDAS.append(("cobro", f"/api/cobros/{hechos[0]['id']}", TOK,
                       lambda d: d, ["cobrado_en"], "local"))

ANCHO = 22
print(f"\nreloj de pared local: {datetime.now().astimezone().isoformat(timespec='seconds')}")
print("─" * 78)

mal, bien, sin_dato = [], [], []
for etiqueta, ruta, token, extraer, campos, espera in SONDAS:
    d = get(ruta, token)
    if isinstance(d, dict) and "__http__" in d:
        sin_dato.append(f"{etiqueta} (HTTP {d['__http__']})")
        continue
    obj = extraer(d)
    if not obj:
        sin_dato.append(f"{etiqueta} (sin datos)")
        continue
    for campo in campos:
        v = obj.get(campo)
        if not v:
            continue
        clave = f"{etiqueta}.{campo}"
        es_utc = v.endswith("Z")
        correcto = (es_utc and espera == "utc") or (not es_utc and espera == "local")
        marca = "ok  " if correcto else "MAL "
        nota = "  ← UTC a propósito (plataforma)" if espera == "utc" else ""
        print(f"  {marca} {clave:<{ANCHO}} {v}{nota}")
        (bien if correcto else mal).append(clave)

print("─" * 78)
print(f"  como corresponde: {len(bien)}")
print(f"  mal:              {len(mal)}")
if sin_dato:
    print(f"  sin medir:        {', '.join(sin_dato)}")
    print("    (cargá datos de esos endpoints para que la medición sea completa)")

if mal:
    print("\n  Rutas de negocio que todavía salen en UTC:")
    for k in mal:
        print(f"    · {k}")
    sys.exit(1)
print("\n  Toda hora de negocio viaja en la TZ del negocio.")
PYEOF
