FROM python:3.11-slim

WORKDIR /app

# Build deps de pyafipws (lxml, bindings de openssl) + openssl runtime, que
# pyafipws invoca por línea de comandos para firmar el CMS del WSAA.
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ make libxml2-dev libxslt-dev libssl-dev swig \
    libc6-dev linux-libc-dev openssl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements-base.txt requirements.txt patch_setuppy.py patch_wsaa.py patch_wsaa_openssl2.py patch_wsaa_b64.py patch_utils.py patch_pysimplesoap.py patch_helpers.py patch_wsfev1_final.py ./

# Instalar deps base
RUN pip install --no-cache-dir -r requirements-base.txt

# Parches para pysimplesoap (Python 2 -> 3 compatibility)
# patch_helpers.py también parchea client.py (hashlib.md5 Python 3 fix)
RUN python3 /app/patch_pysimplesoap.py && \
    python3 /app/patch_helpers.py

# pyafipws tiene print sin paréntesis (Python 2) y tabs/espacios mixtos en setup.py.
# Descargamos el tarball directamente con urllib (pip download también llama egg_info),
# parcheamos con patch_setuppy.py, creamos el archivo faltante y luego instalamos.
RUN python3 -c "\
import urllib.request; \
urllib.request.urlretrieve(\
'https://files.pythonhosted.org/packages/source/P/PyAfipWs/PyAfipWs-2.7.1874.tar.gz',\
'/tmp/pyafipws.tar.gz')" && \
    cd /tmp && \
    tar xzf pyafipws.tar.gz && \
    cd *fip*2.7.1874* && \
    rm -f setup_fe_db.py designer.py && \
    touch setup_fe_db.py designer.py && \
    python3 /app/patch_setuppy.py /tmp/PyAfipWs-2.7.1874 && \
    rm -rf *.egg-info setup.cfg && \
    python3 setup.py install --single-version-externally-managed --record /dev/null && \
    python3 /app/patch_wsaa.py && \
    python3 /app/patch_wsaa_openssl2.py && \
    python3 /app/patch_wsaa_b64.py && \
    python3 /app/patch_utils.py && \
    python3 /app/patch_wsfev1_final.py && \
    cd /tmp && rm -rf *fip*2.7.1874* pyafipws.tar.gz

COPY *.py ./
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# NO hay directorio de certificados en la imagen, ni certs en variables de
# entorno: cada request trae el par cert/key del negocio y el sidecar los
# materializa en ARCA_CACHE_DIR con permisos 0600, borrables en cualquier momento.
ENV ARCA_CACHE_DIR=/var/cache/arca \
    ARCA_PORT=8001 \
    PYTHONUNBUFFERED=1

# Usuario sin privilegios: en este disco viven claves privadas de terceros.
RUN useradd -m -u 1001 arca && \
    mkdir -p /var/cache/arca /usr/local/lib/python3.11/site-packages/pyafipws/cache && \
    chmod 700 /var/cache/arca && \
    chown -R arca:arca /var/cache/arca /usr/local/lib/python3.11/site-packages/pyafipws/cache

# ARCA todavía negocia TLS con parámetros viejos (DH_KEY_TOO_SMALL).
RUN sed -i 's/DEFAULT@SECLEVEL=2/DEFAULT@SECLEVEL=0/g' /etc/ssl/openssl.cnf

USER arca

EXPOSE 8001

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8001/health')"

ENTRYPOINT ["/entrypoint.sh"]
