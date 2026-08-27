# Copiloto Comercios — atajos de desarrollo y deploy
#
# El sistema entero:
#   cp env.compose.example .env   (una vez)
#   make up && make smoke
#
# Sólo la infra, para desarrollar con el core local:
#   make infra && make core-run

.PHONY: up down build logs ps smoke restart \
        infra infra-down core-run core-build core-test \
        arnes arnes-todo arnes-libre arnes-dueno arnes-listar arnes-ejemplo

# ── Sistema completo (docker compose) ─────────────────────────────────────────

## Buildea las cuatro imágenes (core, arca-sidecar, gateway, panel+landing)
build:
	docker compose build

## Levanta todo: db, redis, core, sidecar, gateway y panel (con la landing adentro)
up:
	docker compose up -d --build

## Baja todo (los volúmenes de datos quedan; `down -v` los borra)
down:
	docker compose down

## Recrea los contenedores releyendo el .env.
## `docker compose restart` NO relee env_file ni environment: por eso va --force-recreate.
restart:
	docker compose up -d --force-recreate

ps:
	docker compose ps

logs:
	docker compose logs -f --tail=100

## El producto entero por la API real. Levanta lo que falte y deja todo andando.
smoke:
	bash scripts/smoke.sh

# ── Desarrollo local ──────────────────────────────────────────────────────────

## Levanta sólo postgres y redis (el core corre en la máquina con `make core-run`)
infra:
	docker compose up -d db redis

infra-down:
	docker compose down

## Corre el core local (necesita core/.env con JWT_SECRET)
core-run:
	cd core && go run ./cmd/server

core-build:
	cd core && go build ./...

core-test:
	cd core && go test ./...

# ── Landing Page (Editorial & Experimental) ──────────────────────────────────

## Levanta el servidor de desarrollo de la landing page (Vite)
landing-dev:
	cd landing && npm run dev

## Compila la landing page para producción (HTML/CSS/JS optimizado en landing/dist)
landing-build:
	cd landing && npm run build


# ── Arnés de tres actores (arnes/) ───────────────────────────────────────────
#
# Otra pregunta que el smoke. El smoke pregunta "¿el sistema responde?"; el
# arnés pregunta "¿la conversación termina donde dice el documento?". Ninguno
# reemplaza al otro y NINGUNO de estos targets se cuelga de `smoke` ni de
# `core-test`: `go test ./...` tiene que seguir siendo gratis y offline.
#
# Necesita el compose arriba (`make up`). NO necesita API key, ni Playwright,
# ni Chromium. Todo el porqué está en arnes/README.md.
#
# Exit codes: 0 verde · 1 PRODUCTO · 2 ARNÉS ROTO (y el 2 NO dice nada del producto).

## Los escenarios @rapido, en modo guion. Es lo que se corre antes de un release.
arnes:
	@test -f arnes/escenarios/correr.js || { \
	  echo "✗ ARNÉS ROTO — falta arnes/escenarios/correr.js (grupo 6 del cambio arnes-tres-agentes)."; \
	  echo "  Mientras no esté, lo que sí corre:"; \
	  echo "    node arnes/puerta-andamio.js   el andamio, sin modelo y sin gastar"; \
	  echo "    node arnes/puerta-bot.js       el bot real y las aserciones deterministas"; \
	  exit 2; }
	node arnes/escenarios/correr.js --tag=@rapido

## Todos los escenarios, no sólo los rápidos. Tarda más y encuentra más.
arnes-todo:
	@test -f arnes/escenarios/correr.js || { echo "✗ ARNÉS ROTO — falta arnes/escenarios/correr.js. Ver \`make arnes\`."; exit 2; }
	node arnes/escenarios/correr.js

## Qué escenarios hay, con sus etiquetas. Gratis: no levanta nada.
arnes-listar:
	@test -f arnes/escenarios/correr.js || { echo "✗ ARNÉS ROTO — falta arnes/escenarios/correr.js. Ver \`make arnes\`."; exit 2; }
	node arnes/escenarios/correr.js --listar

## Modo libre: un cliente que improvisa. NUNCA rompe el build; deja candidatos a escenario.
arnes-libre:
	node arnes/libre.js

## El guión del dueño en Chrome. Lo ejecuta un AGENTE, no este comando: monta el
## escenario y lo sostiene vivo mientras alguien maneja el navegador (design §9).
arnes-dueno:
	ARNES_DUENO=navegador node arnes/guion-del-dueno.js

## Cómo se lee una falla del arnés, sin levantar nada y sin gastar un peso.
arnes-ejemplo:
	node arnes/informe/ejemplo.js rojo
