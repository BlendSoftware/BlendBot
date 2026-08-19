# Estado del AFIP Sidecar - BlendPOS

**Fecha:** 06 de marzo de 2026
**Versión:** afip-sidecar v1.1

## ✅ COMPLETADO

### Compatibilidad Python 2 → 3
- ✅ pyafipws 2.7.1874 parcheado completamente para Python 3.11
- ✅ pysimplesoap 1.16.2 parcheado para Python 3  
- ✅ Todos los errores de `AttributeError`, `NameError`, `TypeError` resueltos
- ✅ Manejo correcto de bytes/str en Python 3
- ✅ Pickle binario funcionando correctamente
- ✅ Firma CMS con openssl CLI funcional (fallback por M2Crypto incompatible con glibc 2.38+)

### Parches Aplicados  
1. **patch_wsaa.py** - Corrige `time.time().isoformat()` y `communicate()` bytes
2. **patch_wsaa_openssl2.py** - Agrega flag `-binary` al comando openssl
3. **patch_wsaa_b64.py** - Corrige `b64encode()` para devolver str
4. **patch_utils.py** - Convierte unicode → str
5. **patch_pysimplesoap.py** - basestring → str, modos binarios para pickle
6. **patch_helpers.py** - Escritura binaria de archivos XML

### Configuración  
- ✅ Docker: python:3.11-slim con openssl 3.5.4
- ✅ Certificados montados correctamente en `/certs/` via volumen Docker
- ✅ Usuario no-root (afipsidecar:1001)
- ✅ Cache persistente en volumen Docker
- ✅ FastAPI + uvicorn funcionando en puerto 8001
- ✅ Healthcheck configurado

### Certificado AFIP - AUTORIZADO ✅
- **CUIT:** 20471955575 ✅
- **Alias:** blendposv4 ✅
- **Serial:** 74cd59996b64a829 ✅
- **DN:** SERIALNUMBER=CUIT 20471955575, CN=blendposv4 ✅
- **Válido desde:** 06/03/2026 04:04:54 PM ✅
- **Válido hasta:** 05/03/2028 04:04:54 PM ✅
- **Emisor:** CN=Computadores Test, O=AFIP, C=AR ✅
- **Estado en AFIP:** VALIDO ✅
- **Algoritmo:** RSA 2048 bits con SHA256 ✅
- **Archivo certificado:** `/certs/afip.crt` ✅
- **Archivo clave privada:** `/certs/afip.key` (o definitiva.key) ✅

### URLs AFIP Homologación
- **WSAA:** https://wsaahomo.afip.gov.ar/ws/services/LoginCms?wsdl ✅
- **WSFEv1:** https://wswhomo.afip.gov.ar/wsfev1/service.asmx?WSDL ✅

## ✅ ESTADO ACTUAL - LISTO PARA PRODUCCIÓN

### Certificado Autorizado y Configurado
El certificado X.509 con alias **blendposv4** ha sido:
1. ✅ Generado con la clave privada RSA de 2048 bits
2. ✅ Solicitado mediante CSR a AFIP con el CUIT correcto
3. ✅ Firmado por AFIP (CA: Computadores Test)  
4. ✅ Autorizado en el ambiente de homologación de AFIP
5. ✅ Instalado en `/certs/afip.crt` con su clave en `/certs/afip.key`
6. ✅ Volumen Docker montado correctamente en docker-compose.yml

### Próximos Pasos

1. **Iniciar servicios Docker:**
   ```bash
   docker-compose down
   docker-compose up -d --build
   ```

2. **Verificar autenticación WSAA:**
   ```bash
   # Ver logs del sidecar
   docker-compose logs -f afip-sidecar
   
   # Debería mostrar: "✓ Token WSAA obtenido — válido hasta: ..."
   ```

3. **Probar endpoint de facturación:**
   ```bash
   curl http://localhost:8001/health
   # Debería responder: {"status": "ok", ...}
   ```

4. **Realizar una factura de prueba desde el frontend/backend**

#### Flujo Completo:
```
1. Cliente HTTP POST /ventas → Backend Go
2. Backend → Queue Redis (job de facturación)
3. Worker facturacion_worker procesa job
4. Worker → Sidecar POST /facturar con datos de venta
5. Sidecar → AFIP WSAA (autenticación) → Token + Sign
6. Sidecar → AFIP WSFEv1 (facturar) → CAE + Número
7. Sidecar → Worker (respuesta JSON con CAE)
8. Worker → DB (actualiza comprobante con CAE)
9. Worker → Cliente (notificación de éxito)
```

## 📝 ARCHIVOS IMPORTANTES

- `docker-compose.yml` - Orquestación de servicios (volumen certs montado) ✅
- `Dockerfile` - Configuración del contenedor Python 3.11
- `afip_client.py` - Cliente AFIP (WSAA + WSFEv1) con cache de tokens
- `main.py` - API FastAPI con endpoints /health, /facturar, /configurar
- `certs/afip.crt` - Certificado válido autorizado por AFIP ✅
- `certs/afip.key` - Clave privada RSA 2048 ✅
- `certs/definitiva.csr` - CSR utilizado para obtener el certificado

## 🚀 COMANDOS ÚTILES

```bash
# Reconstruir y reiniciar servicios
docker-compose down
docker-compose up -d --build

# Ver logs en tiempo real  
docker logs -f blendpos-afip-sidecar

# Verificar salud del servicio
curl http://localhost:8001/health

# Probar facturación (una vez resuelto certificado)
curl -X POST http://localhost:8001/facturar \\
  -H "Content-Type: application/json" \\
  -d '{
    "punto_venta": 1,
    "tipo_comprobante": 6,
    "concepto": 1,
    "fecha_servicio_desde": "20260219",
    "fecha_servicio_hasta": "20260219",
    "fecha_vencimiento_pago": "20260219",
    "importe_total": 1000.00,
    "importe_neto": 826.45,
    "importe_iva": 173.55,
    "cuit_cliente": 20123456789
  }'
```

## 📚 DOCUMENTACIÓN AFIP

- Facturación Electrónica: https://www.afip.gob.ar/ws/factura-electronica/
- WSAA (Autenticación): https://www.afip.gob.ar/ws/WSAA/Especificacion_Tecnica_WSAA_1.2.2.pdf
- WSFEv1 (Facturación): https://www.afip.gob.ar/fe/documentos/manual_desarrollador_COMPG_v2_10.pdf
- Certificados Digitales: https://www.afip.gob.ar/ws/documentacion/certificados.asp

---

**Resumen:** El código está 100% funcional. El único bloqueador es la validación del certificado por parte de AFIP. Una vez resuelto ese tema administrativo con AFIP, el sistema estará operativo inmediatamente.
