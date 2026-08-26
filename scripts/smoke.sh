#!/usr/bin/env bash
#
# smoke.sh — el producto entero, por la API real, contra el compose.
#
# No es un test unitario ni un reemplazo de `go test`: es la pregunta que
# importa después de un deploy — *¿puede un consultorio operar ahora mismo?*
# Levanta el stack, espera a que los cuatro servicios estén sanos y después
# recorre el camino completo: alta del negocio, configuración, disponibilidad,
# hold, turno, la máquina de estados, el cobro, el cierre del día y el token
# del agente.
#
#   bash scripts/smoke.sh
#
# Sale 0 si todo el flujo pasó. Sale distinto de 0 en el primer assert que
# falle, diciendo qué se esperaba, qué llegó y con qué cuerpo. Deja el compose
# corriendo: después de una corrida verde el sistema queda listo para usar.
#
# Es idempotente: cada corrida crea su propio negocio con un sufijo al azar, y
# los negocios no se pisan entre sí. Correrlo diez veces deja diez consultorios
# de prueba en la base de desarrollo y ningún error.
#
# Variables:
#   CORE_PORT ARCA_PORT GATEWAY_PORT PANEL_PORT   puertos publicados (ver .env)
#   ADMIN_USERNAME ADMIN_PASSWORD                 credenciales del admin
#   SMOKE_SKIP_UP=1                               no tocar el compose, sólo probar
#   SMOKE_BUILD=1                                 buildear antes de levantar

set -Eeuo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"

# ── Configuración ────────────────────────────────────────────────────────────
# El .env de la raíz manda; si no está, valen los mismos defaults que el
# docker-compose.yml (los `${VAR:-...}`), así el smoke funciona en frío.
leer_env() {
  local clave=$1 default=${2:-}
  if [[ -f .env ]]; then
    local v
    v=$(sed -n "s/^[[:space:]]*${clave}=//p" .env | tail -n1)
    v="${v%\"}"; v="${v#\"}"
    if [[ -n $v ]]; then printf '%s' "$v"; return; fi
  fi
  printf '%s' "${!clave:-$default}"
}

CORE_PORT=$(leer_env CORE_PORT 8080)
ARCA_PORT=$(leer_env ARCA_PORT 8001)
GATEWAY_PORT=$(leer_env GATEWAY_PORT 8090)
PANEL_PORT=$(leer_env PANEL_PORT 8081)
ADMIN_USERNAME=$(leer_env ADMIN_USERNAME admin)
ADMIN_PASSWORD=$(leer_env ADMIN_PASSWORD cambiame-admin-dev)

BASE="http://localhost:${CORE_PORT}"
TZ_NEGOCIO="America/Argentina/Mendoza"
OFFSET="-03:00"

# ── Salida ───────────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  ROJO=$'\033[31m'; VERDE=$'\033[32m'; GRIS=$'\033[90m'; NEGRITA=$'\033[1m'; FIN=$'\033[0m'
else
  ROJO=''; VERDE=''; GRIS=''; NEGRITA=''; FIN=''
fi

PASOS=0
titulo() { printf '\n%s── %s %s\n' "$NEGRITA" "$1" "$FIN"; }
ok()     { PASOS=$((PASOS + 1)); printf '  %s✓%s %s\n' "$VERDE" "$FIN" "$1"; }
nota()   { printf '  %s· %s%s\n' "$GRIS" "$1" "$FIN"; }

morir() {
  printf '\n%s✗ SMOKE FALLÓ%s — %s\n' "$ROJO$NEGRITA" "$FIN" "$1" >&2
  shift || true
  for linea in "$@"; do printf '    %s\n' "$linea" >&2; done
  printf '\n  Pistas:\n' >&2
  printf '    docker compose ps\n' >&2
  printf '    docker compose logs --tail=80 core gateway arca-sidecar panel\n' >&2
  exit 1
}
trap 'morir "error inesperado en la línea $LINENO (comando: $BASH_COMMAND)"' ERR

# ── Dependencias ─────────────────────────────────────────────────────────────
command -v curl >/dev/null || morir "hace falta curl"
command -v docker >/dev/null || morir "hace falta docker"

MOTOR_JSON=""
if command -v jq >/dev/null; then
  MOTOR_JSON=jq
elif command -v python3 >/dev/null; then
  MOTOR_JSON=python3
else
  morir "hace falta jq (o python3 como reemplazo) para leer las respuestas"
fi

# ── Cliente HTTP ─────────────────────────────────────────────────────────────
CUERPO=$(mktemp); trap 'rm -f "$CUERPO"' EXIT
RESP=''; STATUS=''

# api <método> <ruta> [token] [json]
api() {
  local metodo=$1 ruta=$2 token=${3:-} cuerpo=${4:-}
  local args=(-sS -X "$metodo" -o "$CUERPO" -w '%{http_code}' --max-time 30)
  [[ -n $token ]] && args+=(-H "Authorization: Bearer $token")
  [[ -n $cuerpo ]] && args+=(-H 'Content-Type: application/json' -d "$cuerpo")
  STATUS=$(curl "${args[@]}" "${BASE}${ruta}" || echo 000)
  RESP=$(cat "$CUERPO")
}

# exigir <status> <qué se estaba haciendo>
exigir() {
  local esperado=$1 que=$2
  [[ $STATUS == "$esperado" ]] && return 0
  morir "$que" "esperaba HTTP $esperado, llegó $STATUS" "cuerpo: ${RESP:0:600}"
}

# val <ruta>  —  ej: usuario.rol · huecos[0].inicio · huecos#  (# = length)
# El mismo dialecto lo entienden los dos motores, así que el script no cambia
# según qué haya instalado en la máquina.
val() {
  local ruta=$1
  if [[ $MOTOR_JSON == jq ]]; then
    if [[ $ruta == *'#' ]]; then
      printf '%s' "$RESP" | jq -r ".${ruta%\#} | length"
    else
      printf '%s' "$RESP" | jq -r ".${ruta}"
    fi
  else
    printf '%s' "$RESP" | python3 -c '
import json, re, sys
ruta = sys.argv[1]
largo = ruta.endswith("#")
if largo: ruta = ruta[:-1]
d = json.load(sys.stdin)
for tramo in [t for t in re.split(r"\.|(\[\d+\])", ruta) if t]:
    m = re.fullmatch(r"\[(\d+)\]", tramo)
    d = d[int(m.group(1))] if m else (d or {}).get(tramo)
    if d is None: break
if largo: print(len(d or []))
elif d is None: print("null")
elif isinstance(d, bool): print("true" if d else "false")
else: print(d)
' "$ruta"
  fi
}

# igual <esperado> <obtenido> <qué>
igual() {
  [[ "$1" == "$2" ]] && { ok "$3"; return 0; }
  morir "$3" "esperaba: $1" "obtuvo:   $2" "cuerpo: ${RESP:0:600}"
}

contiene() {
  [[ "$2" == *"$1"* ]] && { ok "$3"; return 0; }
  morir "$3" "esperaba que contuviera: $1" "obtuvo: $2"
}

# igual_num compara plata por valor y no por texto: numeric(12,2) vuelve de la
# base como "8500.00" y eso es el MISMO número que 8500. Comparar los strings
# haría fallar el smoke por una diferencia que no existe.
igual_num() {
  if awk -v a="$1" -v b="$2" 'BEGIN { exit !(a + 0 == b + 0) }'; then ok "$3"; return 0; fi
  morir "$3" "esperaba (numérico): $1" "obtuvo: $2" "cuerpo: ${RESP:0:600}"
}

# esperar_http <url> <intentos> <descripción> [texto que tiene que aparecer]
esperar_http() {
  local url=$1 intentos=$2 desc=$3 buscar=${4:-}
  local i cuerpo code
  for ((i = 1; i <= intentos; i++)); do
    code=$(curl -sS -o "$CUERPO" -w '%{http_code}' --max-time 5 "$url" 2>/dev/null || echo 000)
    if [[ $code == 200 ]]; then
      cuerpo=$(cat "$CUERPO")
      if [[ -z $buscar || $cuerpo == *"$buscar"* ]]; then
        ok "$desc (${i}s)"
        return 0
      fi
    fi
    sleep 1
  done
  morir "$desc no respondió en ${intentos}s ($url)" "último status: ${code:-?}" "cuerpo: $(head -c 300 "$CUERPO" 2>/dev/null)"
}

# ── 0. El stack ──────────────────────────────────────────────────────────────
titulo "Levantando el stack"
if [[ ${SMOKE_SKIP_UP:-0} == 1 ]]; then
  nota "SMOKE_SKIP_UP=1 — pruebo contra lo que ya esté corriendo"
else
  if [[ ${SMOKE_BUILD:-0} == 1 ]]; then
    nota "docker compose build"
    docker compose build >/dev/null || morir "falló el build de las imágenes"
  fi
  nota "docker compose up -d"
  docker compose up -d >/dev/null 2>&1 || morir "falló 'docker compose up -d'"
fi

titulo "Salud de los servicios"
esperar_http "http://localhost:${CORE_PORT}/health"      90 "core sano"    '"status":"ok"'
esperar_http "http://localhost:${ARCA_PORT}/health"      60 "sidecar ARCA sano"
esperar_http "http://localhost:${GATEWAY_PORT}/salud"    60 "gateway sano" '"ok":true'
esperar_http "http://localhost:${PANEL_PORT}/"                 60 "landing servida en la raíz" '<!doctype html'
esperar_http "http://localhost:${PANEL_PORT}/panel/"           60 "panel sirviendo el bundle" 'id="raiz"'
esperar_http "http://localhost:${PANEL_PORT}/api-health"       30 "panel proxya /api al core" '"status":"ok"'
esperar_http "http://localhost:${PANEL_PORT}/panel/cierre"     15 "el panel resuelve rutas del SPA" 'id="raiz"'

# El gateway sin credenciales de Meta arranca igual, pero tiene que decirlo.
curl -sS "http://localhost:${GATEWAY_PORT}/salud" -o "$CUERPO"
RESP=$(cat "$CUERPO")
DEGRADADO=$(val 'degradado#')
if [[ $DEGRADADO != 0 ]]; then
  nota "gateway degradado: faltan $(val 'degradado' | tr '\n' ' ')— normal en desarrollo"
fi

# ── 1. El admin de la plataforma entra ───────────────────────────────────────
titulo "Admin de la plataforma"
api POST /api/auth/login '' "$(printf '{"username":"%s","password":"%s"}' "$ADMIN_USERNAME" "$ADMIN_PASSWORD")"
if [[ $STATUS == 401 ]]; then
  morir "el admin no pudo entrar" \
    "usuario: $ADMIN_USERNAME" \
    "ADMIN_PASSWORD sale del .env de la raíz (o del default del compose)." \
    "Si la base ya tenía un admin, la contraseña es la de ESE alta: el bootstrap no la pisa."
fi
exigir 200 "login del admin"
TOKEN_ADMIN=$(val access_token)
igual admin "$(val usuario.rol)" "el admin entró con rol admin"
igual null "$(val usuario.negocio_id)" "el admin de la plataforma no tiene negocio"

# ── 2. Alta del negocio ──────────────────────────────────────────────────────
titulo "Alta del consultorio"
SUFIJO="${RANDOM}${RANDOM}"
NOMBRE_NEG="Consultorio Smoke ${SUFIJO}"
USUARIO_DUENO="smoke${SUFIJO}"

api POST /api/admin/negocios "$TOKEN_ADMIN" "$(printf \
  '{"nombre":"%s","vertical":"salud","timezone":"%s","usuario_dueno":"%s"}' \
  "$NOMBRE_NEG" "$TZ_NEGOCIO" "$USUARIO_DUENO")"
exigir 201 "alta del negocio"
NEGOCIO_ID=$(val negocio_id)
PASS_TEMPORAL=$(val password_temporal)
igual salud "$(val vertical)" "vertical del negocio"
igual dueno "$(val usuario_dueno.rol)" "rol del usuario dueño"
igual true "$(val usuario_dueno.must_change_password)" "el dueño arranca obligado a cambiar la contraseña"
igual "$NEGOCIO_ID" "$(val usuario_dueno.negocio_id)" "el dueño cuelga de su negocio"
[[ -n $PASS_TEMPORAL && $PASS_TEMPORAL != null ]] || morir "el alta no devolvió password temporal"
nota "negocio $NEGOCIO_ID · usuario $USUARIO_DUENO"

# ── 3. El dueño entra y cambia la contraseña ─────────────────────────────────
titulo "Primer login del dueño"
api POST /api/auth/login '' "$(printf '{"username":"%s","password":"%s"}' "$USUARIO_DUENO" "$PASS_TEMPORAL")"
exigir 200 "login con la contraseña temporal"
igual true "$(val usuario.must_change_password)" "must_change_password con la temporal"
TOKEN_TMP=$(val access_token)

PASS_DEF="smoke-clave-${SUFIJO}"
api POST /api/auth/cambiar-password "$TOKEN_TMP" "$(printf '{"password_nueva":"%s"}' "$PASS_DEF")"
exigir 200 "cambio de contraseña"

api POST /api/auth/login '' "$(printf '{"username":"%s","password":"%s"}' "$USUARIO_DUENO" "$PASS_TEMPORAL")"
exigir 401 "la contraseña temporal dejó de servir"

api POST /api/auth/login '' "$(printf '{"username":"%s","password":"%s"}' "$USUARIO_DUENO" "$PASS_DEF")"
exigir 200 "login con la contraseña nueva"
igual false "$(val usuario.must_change_password)" "el flag se apagó"
TOKEN=$(val access_token)

# ── 4. Configuración del consultorio ─────────────────────────────────────────
titulo "Catálogo y agenda"
api POST /api/coberturas "$TOKEN" '{"nombre":"OSDE"}'
exigir 201 "alta de la cobertura"
COBERTURA_ID=$(val id)
igual "$NEGOCIO_ID" "$(val negocio_id)" "la cobertura queda en el tenant correcto"

api POST /api/servicios "$TOKEN" '{"nombre":"Consulta","duracion_min":30,"precio_base":"8500"}'
exigir 201 "alta del servicio"
SERVICIO_ID=$(val id)
igual true "$(val disponible)" "el servicio nace disponible"
igual 30 "$(val duracion_min)" "duración del servicio"

api POST /api/recursos "$TOKEN" '{"tipo":"profesional","nombre":"Dra. Gómez"}'
exigir 201 "alta del recurso"
RECURSO_ID=$(val id)
igual profesional "$(val tipo)" "tipo del recurso"

for DIA in 1 2 3 4 5; do
  api POST "/api/recursos/${RECURSO_ID}/horarios" "$TOKEN" \
    "$(printf '{"dia_semana":%s,"desde":"09:00","hasta":"13:00"}' "$DIA")"
  exigir 201 "horario del día $DIA"
done

api GET "/api/recursos/${RECURSO_ID}/horarios" "$TOKEN"
exigir 200 "listado de horarios"
igual 5 "$(val '#')" "quedaron las cinco franjas semanales"

# ── 5. Disponibilidad ────────────────────────────────────────────────────────
# El lunes que viene, 09:00 en la zona del negocio. Se calcula acá y no se toma
# del primer hueco de la respuesta: si el cálculo se corriera de hora, tomarlo
# de ahí haría pasar igual todo el resto del flujo.
titulo "Disponibilidad"
LUNES=$(date -d 'next monday' +%F)
INICIO="${LUNES}T09:00:00${OFFSET}"
FIN="${LUNES}T09:30:00${OFFSET}"

api POST /api/disponibilidad/consultar "$TOKEN" \
  "$(printf '{"servicio_id":"%s","desde":"%s","dias":1}' "$SERVICIO_ID" "$LUNES")"
exigir 200 "consulta de disponibilidad"
igual "$TZ_NEGOCIO" "$(val timezone)" "la respuesta viaja en la zona del negocio"
igual 30 "$(val duracion_min)" "duración del slot"
igual "$LUNES" "$(val desde)" "día consultado"
# 09:00–13:00 con paso de 30 minutos son ocho turnos.
igual 8 "$(val 'huecos#')" "huecos del lunes"
igual "$INICIO" "$(val 'huecos[0].inicio')" "inicio del primer hueco"
igual "$FIN" "$(val 'huecos[0].fin')" "fin del primer hueco"
igual "$RECURSO_ID" "$(val 'huecos[0].recurso_id')" "recurso del primer hueco"
contiene "$OFFSET" "$(val 'huecos[7].inicio')" "el último hueco también viene con offset (un 'Z' son turnos a las 6 AM)"
igual "${LUNES}T12:30:00${OFFSET}" "$(val 'huecos[7].inicio')" "el último hueco arranca 12:30"

# ── 6. El agente bloquea el hueco ────────────────────────────────────────────
titulo "Hold"
SESION="54926110${SUFIJO:0:5}"
api POST /api/holds "$TOKEN" \
  "$(printf '{"recurso_id":"%s","inicio":"%s","fin":"%s","sesion":"%s"}' "$RECURSO_ID" "$INICIO" "$FIN" "$SESION")"
exigir 201 "el hold se tomó"
HOLD_ID=$(val id)
igual "$SESION" "$(val sesion)" "sesión del hold"

api POST /api/holds "$TOKEN" \
  "$(printf '{"recurso_id":"%s","inicio":"%s","fin":"%s","sesion":"otra-sesion"}' "$RECURSO_ID" "$INICIO" "$FIN")"
exigir 409 "otra sesión no puede robar el hueco bloqueado"

api POST /api/disponibilidad/consultar "$TOKEN" \
  "$(printf '{"servicio_id":"%s","desde":"%s","dias":1}' "$SERVICIO_ID" "$LUNES")"
exigir 200 "disponibilidad con el hold puesto"
igual 7 "$(val 'huecos#')" "el hueco bloqueado desapareció de la oferta"

# ── 7. La paciente y el turno ────────────────────────────────────────────────
titulo "Turno"
api POST /api/clientes "$TOKEN" \
  "$(printf '{"telefono":"%s","nombre":"Juana Pérez","cobertura_id":"%s"}' "$SESION" "$COBERTURA_ID")"
exigir 201 "alta de la paciente"
CLIENTE_ID=$(val id)

api POST /api/compromisos "$TOKEN" "$(printf '{
  "cliente_id":"%s","tipo":"turno","origen":"whatsapp","recurso_id":"%s",
  "inicio":"%s","fin":"%s","sesion":"%s",
  "lineas":[{"servicio_id":"%s","cantidad":1}]}' \
  "$CLIENTE_ID" "$RECURSO_ID" "$INICIO" "$FIN" "$SESION" "$SERVICIO_ID")"
exigir 201 "creación del turno"
TURNO_ID=$(val id)
igual pendiente "$(val estado)" "el turno nace pendiente"
igual "$NEGOCIO_ID" "$(val negocio_id)" "el turno queda en el tenant correcto"
igual_num 8500 "$(val total)" "el precio se congeló desde el catálogo"
igual_num 8500 "$(val 'lineas[0].precio_unit')" "precio unitario congelado de la línea"

# ── 8. La máquina de estados ─────────────────────────────────────────────────
titulo "Máquina de estados"
api PATCH "/api/compromisos/${TURNO_ID}/estado" "$TOKEN" '{"estado":"confirmado"}'
exigir 200 "pendiente → confirmado"
[[ $(val confirmado_en) != null ]] || morir "confirmar tiene que sellar confirmado_en"

api PATCH "/api/compromisos/${TURNO_ID}/estado" "$TOKEN" '{"estado":"completado"}'
exigir 409 "saltarse en_curso está prohibido (la máquina vive en el core)"

api PATCH "/api/compromisos/${TURNO_ID}/estado" "$TOKEN" '{"estado":"en_curso"}'
exigir 200 "confirmado → en_curso"

api PATCH "/api/compromisos/${TURNO_ID}/estado" "$TOKEN" '{"estado":"completado"}'
exigir 200 "en_curso → completado"
[[ $(val cerrado_en) != null ]] || morir "completado es terminal: tiene que sellar cerrado_en"

api PATCH "/api/compromisos/${TURNO_ID}/estado" "$TOKEN" '{"estado":"cancelado"}'
exigir 409 "terminal es terminal"

api GET "/api/agenda?fecha=${LUNES}" "$TOKEN"
exigir 200 "agenda del día"
igual 1 "$(val 'recursos#')" "un recurso en la agenda"
igual 1 "$(val 'recursos[0].turnos#')" "el turno aparece en la agenda"
igual completado "$(val 'recursos[0].turnos[0].estado')" "estado del turno en la agenda"
contiene "$OFFSET" "$(val 'recursos[0].turnos[0].inicio')" "la agenda también viene en hora local"

# ── 9. Cobro ─────────────────────────────────────────────────────────────────
# Sin FISCAL_CIPHER_KEY ni configuración fiscal, el cobro se registra igual y
# la respuesta lo dice en castellano. Eso es el contrato: cobrar nunca depende
# de que ARCA esté disponible.
titulo "Cobro"
api POST /api/cobros "$TOKEN" "$(printf '{"compromiso_id":"%s","medio_pago":"efectivo"}' "$TURNO_ID")"
exigir 201 "cobro del turno"
COBRO_ID=$(val id)
igual_num 8500 "$(val monto)" "el monto sale del total congelado"
igual efectivo "$(val medio_pago)" "medio de pago"
igual null "$(val comprobante)" "sin configuración fiscal no hay comprobante"
contiene "no se emite factura" "$(val facturacion)" "la respuesta explica por qué no se factura"

api POST /api/cobros "$TOKEN" "$(printf '{"compromiso_id":"%s","medio_pago":"efectivo"}' "$TURNO_ID")"
exigir 409 "no se cobra dos veces el mismo turno"

api GET "/api/cobros/${TURNO_ID}" "$TOKEN"
exigir 200 "el cobro se puede releer por compromiso"
igual "$COBRO_ID" "$(val id)" "es el mismo cobro"

# ── 10. Cierre del día ───────────────────────────────────────────────────────
# El cierre cuenta por `cerrado_en` y `cobrado_en`, no por la fecha del turno:
# lo que se cerró y se cobró hoy es de hoy, aunque el turno fuera del lunes.
titulo "Cierre del día"
HOY=$(TZ="$TZ_NEGOCIO" date +%F)
api GET "/api/cierre?fecha=${HOY}" "$TOKEN"
exigir 200 "cierre del día"
igual "$HOY" "$(val fecha)" "fecha del cierre en la zona del negocio"
igual "$TZ_NEGOCIO" "$(val timezone)" "timezone del cierre"
igual 1 "$(val compromisos)" "un compromiso cerrado hoy"
igual 1 "$(val completados)" "y está completado"
igual 0 "$(val cancelados)" "sin cancelados"
igual 0 "$(val ausentes)" "sin ausentes"
igual 1 "$(val por_origen.whatsapp)" "el turno entró por whatsapp"
igual 1 "$(val cobros)" "un cobro"
igual_num 8500 "$(val total_cobrado)" "total cobrado"
igual_num 8500 "$(val ticket_promedio)" "ticket promedio"
igual_num 8500 "$(val por_medio_pago.efectivo)" "desglose por medio de pago"
igual 0 "$(val comprobantes.emitidos)" "ningún comprobante emitido (módulo fiscal apagado)"

# ── 11. El token del agente ──────────────────────────────────────────────────
# Es la credencial con la que el MCP entra al core. Va a tenants.json y es lo
# único que impide que un negocio lea a otro.
titulo "Token del agente"
api POST "/api/admin/negocios/${NEGOCIO_ID}/token-agente" "$TOKEN_ADMIN" ''
exigir 200 "rotación del token de agente"
TOKEN_AGENTE=$(val token)
case "$TOKEN_AGENTE" in
  cop_*) ok "el token es un token de agente (cop_…)" ;;
  *) morir "el token de agente no arranca con cop_: ${TOKEN_AGENTE:0:12}…" ;;
esac

api GET /api/negocio "$TOKEN_AGENTE"
exigir 200 "GET /api/negocio con el token del agente"
igual "$NEGOCIO_ID" "$(val id)" "el token resuelve su propio negocio"
igual "$NOMBRE_NEG" "$(val nombre)" "nombre del negocio"
igual "$TZ_NEGOCIO" "$(val timezone)" "timezone del negocio"
igual 1 "$(val 'coberturas#')" "las coberturas viajan en la ficha del agente"

# El token del agente NO es un token de panel: no puede tocar el admin.
api GET /api/admin/negocios "$TOKEN_AGENTE"
[[ $STATUS == 403 || $STATUS == 401 ]] || \
  morir "el token del agente entró al panel admin" "status: $STATUS" "cuerpo: ${RESP:0:300}"
ok "el token del agente no llega al panel de la plataforma ($STATUS)"

# ── Final ────────────────────────────────────────────────────────────────────
trap - ERR
printf '\n%s✓ SMOKE OK%s — %d asserts, el sistema entero responde.\n' "$VERDE$NEGRITA" "$FIN" "$PASOS"
printf '  Negocio de prueba: %s (%s)\n' "$NOMBRE_NEG" "$NEGOCIO_ID"
printf '  Panel:   http://localhost:%s   (usuario %s)\n' "$PANEL_PORT" "$USUARIO_DUENO"
printf '  Core:    http://localhost:%s/health\n' "$CORE_PORT"
printf '  Gateway: http://localhost:%s/salud\n' "$GATEWAY_PORT"
printf '  El compose queda corriendo. Para bajarlo: make down\n'
