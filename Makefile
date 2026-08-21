# Copiloto Comercios — atajos de desarrollo y deploy
#
# El sistema entero:
#   cp env.compose.example .env   (una vez)
#   make up && make smoke
#
# Sólo la infra, para desarrollar con el core local:
#   make infra && make core-run

.PHONY: up down build logs ps smoke restart \
        infra infra-down core-run core-build core-test

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

