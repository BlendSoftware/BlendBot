# Core (Go) — imagen de deploy.
#
# Multi-stage: el toolchain de Go se queda en la etapa de build y la imagen
# final es un alpine con un binario estático adentro.
#
# Dos cosas que NO son cosméticas:
#  · `tzdata`: el core hace time.LoadLocation("America/Argentina/Mendoza") para
#    resolver la agenda y el cierre en la zona del negocio. Sin la base de
#    zonas, eso devuelve error y los huecos salen en UTC (turnos a las 6 AM).
#  · `migrations/`: golang-migrate las lee del disco (file://$MIGRATIONS_PATH),
#    no están embebidas en el binario. Si no viajan con la imagen, el core no
#    arranca.

FROM golang:1.25-alpine AS build

WORKDIR /src

# Capa de dependencias: cambia sólo cuando cambia go.mod/go.sum.
COPY go.mod go.sum ./
RUN go mod download

COPY . .

# CGO_ENABLED=0: binario estático, corre en una alpine pelada.
RUN CGO_ENABLED=0 GOOS=linux go build \
    -trimpath -ldflags="-s -w" \
    -o /out/copiloto-core ./cmd/server

# ──────────────────────────────────────────────────────────────────────────────

FROM alpine:3.21

RUN apk add --no-cache ca-certificates tzdata && \
    adduser -D -u 1001 copiloto

WORKDIR /app

COPY --from=build /out/copiloto-core /usr/local/bin/copiloto-core
COPY migrations /app/migrations

# Defaults de la imagen. Todo lo demás (DATABASE_URL, JWT_SECRET, …) entra por
# entorno desde el compose: en la imagen no vive ningún secreto.
ENV PORT=8080 \
    MIGRATIONS_PATH=/app/migrations

USER copiloto

EXPOSE 8080

# /health pinguea la base: un core "arriba" sin postgres no está sano.
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=6 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1

ENTRYPOINT ["copiloto-core"]
