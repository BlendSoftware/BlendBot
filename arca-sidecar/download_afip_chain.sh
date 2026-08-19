#!/bin/bash
# Script para descargar la cadena de certificados de AFIP de homologación

echo "Descargando cadenas de certificados de AFIP..."

# Certificado raíz de AFIP (AC Raíz)
curl -o afip_root.crt "https://www.afip.gob.ar/ws/WSAA/cert/afip_root_desa_ca.crt"

# Certificado intermedio (AR)
curl -o afip_intermediate.crt "https://www.afip.gob.ar/ws/WSAA/cert/afip_intermediate_ca.crt"

echo "✓ Certificados descargados"
echo "  - afip_root.crt"
echo "  - afip_intermediate.crt"

# Combinar en una cadena
cat afip_intermediate.crt afip_root.crt > afip_chain.pem

echo "✓ Cadena combinada en afip_chain.pem"
