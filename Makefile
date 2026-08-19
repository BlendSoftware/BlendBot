# Copiloto Comercios — atajos de desarrollo

.PHONY: infra infra-down core-run core-build core-test

## Levanta postgres y redis de desarrollo
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
