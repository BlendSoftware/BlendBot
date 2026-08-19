#!/bin/bash
# ============================================================================
# Generador de clave privada + CSR para ARCA (ex AFIP) Homologación
# ============================================================================
#
# Este script genera un par de certificados autofirmados (.crt y .key)
# para testing LOCAL del sidecar.
#
# IMPORTANTE: Estos certificados NO son válidos para AFIP real.
# Para conectar con AFIP (incluso homologación), debes obtener
# certificados oficiales desde: https://www.afip.gob.ar/ws/WSAA/certificado.asp
#
# ============================================================================

set -e

CERTS_DIR="${CERTS_DIR:-./certs-locales}"
KEY_FILE="$CERTS_DIR/arca.key"
CSR_FILE="$CERTS_DIR/arca.csr"
CRT_FILE="$CERTS_DIR/arca.crt"

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}  Copiloto Comercios — Clave + CSR para ARCA${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

# Crear directorio si no existe
mkdir -p "$CERTS_DIR"

# Verificar si ya existen certificados
if [ -f "$KEY_FILE" ] || [ -f "$CRT_FILE" ]; then
    echo -e "${YELLOW}⚠  Advertencia: Ya existen certificados en $CERTS_DIR${NC}"
    read -p "¿Deseas sobrescribirlos? (s/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Ss]$ ]]; then
        echo -e "${RED}✗ Operación cancelada${NC}"
        exit 1
    fi
    rm -f "$KEY_FILE" "$CSR_FILE" "$CRT_FILE"
fi

# Solicitar CUIT
read -p "Ingresa tu CUIT (sin guiones, ej: 20123456789): " CUIT

if [ -z "$CUIT" ]; then
    echo -e "${RED}✗ Error: CUIT es requerido${NC}"
    exit 1
fi

echo -e "\n${GREEN}1. Generando clave privada (2048 bits)...${NC}"
openssl genrsa -out "$KEY_FILE" 2048 2>/dev/null

echo -e "${GREEN}2. Generando CSR (Certificate Signing Request)...${NC}"
openssl req -new -key "$KEY_FILE" -out "$CSR_FILE" \
    -subj "/C=AR/O=Copiloto Comercios/CN=wsfe/serialNumber=CUIT $CUIT" 2>/dev/null

echo -e "${GREEN}3. Generando certificado autofirmado (válido 365 días)...${NC}"
openssl x509 -req -days 365 -in "$CSR_FILE" -signkey "$KEY_FILE" -out "$CRT_FILE" 2>/dev/null

# Establecer permisos restrictivos
chmod 600 "$KEY_FILE"
chmod 644 "$CRT_FILE"

echo -e "\n${GREEN}✓ Certificados generados exitosamente:${NC}"
echo -e "  ${GREEN}→${NC} Clave privada: $KEY_FILE"
echo -e "  ${GREEN}→${NC} Certificado:   $CRT_FILE"
echo -e "  ${GREEN}→${NC} CSR (backup):  $CSR_FILE"

echo -e "\n${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}  IMPORTANTE: Certificados Oficiales de AFIP${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

echo -e "${RED}⚠  Estos certificados son autofirmados y NO funcionan con AFIP real.${NC}\n"

echo -e "Para obtener certificados válidos para AFIP Homologación:"
echo -e "1. Ve a: ${GREEN}https://www.afip.gob.ar/ws/WSAA/certificado.asp${NC}"
echo -e "2. Selecciona servicio: ${GREEN}WSFE - Factura Electrónica${NC}"
echo -e "3. Sube el archivo ${GREEN}$CSR_FILE${NC}"
echo -e "4. Descarga el certificado ${GREEN}.crt${NC} y reemplaza ${GREEN}$CRT_FILE${NC}"
echo -e "5. Mantén ${GREEN}$KEY_FILE${NC} (no lo pierdas)"

echo -e "\n${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

echo -e "${GREEN}Próximos pasos:${NC}"
echo -e "1. Subir el CSR a ARCA y bajar el .crt oficial"
echo -e "2. Dar de alta el punto de venta (Factura Electrónica - Webservice)"
echo -e "3. Cargar el par cert/key en el negocio: PUT /api/admin/negocios/:id/fiscal"
echo -e "4. El sidecar los recibe por request; acá no se configura ningún CUIT\n"
