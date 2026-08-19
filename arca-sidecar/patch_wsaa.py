#!/usr/bin/env python3
"""
Parcha específicamente el archivo wsaa.py de pyafipws instalado.
Corrige el bug de time.time().isoformat() que debería ser time.time()
"""
import os
import re
import sys
import site

def find_wsaa_py():
    """Encuentra el archivo wsaa.py instalado en site-packages."""
    for path in site.getsitepackages() + [site.getusersitepackages()]:
        if not path:
            continue
        wsaa_path = os.path.join(path, 'pyafipws', 'wsaa.py')
        if os.path.exists(wsaa_path):
            return wsaa_path
    return None

def patch_wsaa(path):
    """Aplica parches al archivo wsaa.py."""
    print(f"Parcheando {path}...")
    
    with open(path, 'r', encoding='utf-8', errors='replace') as f:
        content = f.read()
    
    original = content
    
    # PASO 1: Reemplazar time.time().isoformat() con time.time()
    # Este es el bug principal que causa el primer error
    if 'time.time().isoformat()' in content:
        content = content.replace('time.time().isoformat()', 'time.time()')
        print(f"  ✓ Corregido time.time().isoformat()")
    
    # PASO 2: Agregar .isoformat() donde falta
    old_gen = "tra.header.add_child('generationTime',str(datetime.datetime.fromtimestamp(int(time.time())-ttl)))"
    new_gen = "tra.header.add_child('generationTime',str(datetime.datetime.fromtimestamp(int(time.time())-ttl).isoformat()))"
    if old_gen in content:
        content = content.replace(old_gen, new_gen)
        print(f"  ✓ Corregido generationTime")
    
    old_exp = "tra.header.add_child('expirationTime',str(datetime.datetime.fromtimestamp(int(time.time())+ttl)))"
    new_exp = "tra.header.add_child('expirationTime',str(datetime.datetime.fromtimestamp(int(time.time())+ttl).isoformat()))"
    if old_exp in content:
        content = content.replace(old_exp, new_exp)
        print(f"  ✓ Corregido expirationTime")
    
    # PASO 3: Corregir el problema de communicate() que necesita bytes
    # El patrón es: .communicate(tra)[0]
    # Debe ser: .communicate(tra.encode() if isinstance(tra, str) else tra)[0]
    if '.communicate(tra)[0]' in content:
        content = content.replace(
            '.communicate(tra)[0]',
            '.communicate(tra.encode("utf-8") if isinstance(tra, str) else tra)[0]'
        )
        print(f"  ✓ Corregido communicate() para bytes")
    
    # PASO 4: Corregir el manejo de excepciones con errno
    # Buscar el patrón de excepción incorrecta
    old_exception_handling = """    except Exception as e:
        if e.errno == 2:"""
    
    new_exception_handling = """    except OSError as e:
        if e.errno == 2:"""
    
    if old_exception_handling in content:
        content = content.replace(old_exception_handling, new_exception_handling)
        print(f"  ✓ Corregido manejo de excepción errno")
    
    # Variante alternativa: puede estar como "except Exception, e:"
    old_exception_handling2 = """    except Exception, e:
        if e.errno == 2:"""
    
    if old_exception_handling2 in content:
        content = content.replace(old_exception_handling2, new_exception_handling)
        print(f"  ✓ Corregido manejo de excepción errno (v2)")
    
    # PASO 5: Corregir hashlib.md5() que en Python 3 requiere bytes, no str
    # La línea original: hashlib.md5(service + crt + key).hexdigest()
    # En Python 3 hashlib.md5() lanza TypeError: Strings must be encoded before hashing
    old_md5 = 'hashlib.md5(service + crt + key).hexdigest()'
    new_md5 = 'hashlib.md5((service + crt + key).encode("utf-8")).hexdigest()'
    if old_md5 in content:
        content = content.replace(old_md5, new_md5)
        print(f"  ✓ Corregido hashlib.md5() para Python 3 (encode UTF-8)")

    # PASO 6: Corregir M2Crypto BIO.MemoryBuffer que requiere bytes, no str
    # open().read() devuelve str en Python 3; hay que leer en modo binario
    old_read_key = "                privatekey = open(privatekey).read()"
    new_read_key = "                privatekey = open(privatekey, 'rb').read()"
    if old_read_key in content:
        content = content.replace(old_read_key, new_read_key)
        print(f"  ✓ Corregido open(privatekey).read() → open(privatekey, 'rb').read()")

    old_read_crt = "                cert = open(cert).read()"
    new_read_crt = "                cert = open(cert, 'rb').read()"
    if old_read_crt in content:
        content = content.replace(old_read_crt, new_read_crt)
        print(f"  ✓ Corregido open(cert).read() → open(cert, 'rb').read()")

    # Protección extra: si privatekey/cert llegan como str (PEM en memoria), encodear antes de BIO
    old_key_bio = "        key_bio = BIO.MemoryBuffer(privatekey)"
    new_key_bio = "        key_bio = BIO.MemoryBuffer(privatekey.encode('utf-8') if isinstance(privatekey, str) else privatekey)"
    if old_key_bio in content:
        content = content.replace(old_key_bio, new_key_bio)
        print(f"  ✓ Corregido BIO.MemoryBuffer(privatekey) para Python 3")

    old_crt_bio = "        crt_bio = BIO.MemoryBuffer(cert)"
    new_crt_bio = "        crt_bio = BIO.MemoryBuffer(cert.encode('utf-8') if isinstance(cert, str) else cert)"
    if old_crt_bio in content:
        content = content.replace(old_crt_bio, new_crt_bio)
        print(f"  ✓ Corregido BIO.MemoryBuffer(cert) para Python 3")

    # PASO 7: Corregir email.message_from_string() → message_from_bytes()
    # out.read() devuelve bytes en Python 3/M2Crypto pero message_from_string espera str
    old_msg = "        msg = email.message_from_string(out.read())"
    new_msg = "        _out_data = out.read(); msg = email.message_from_bytes(_out_data) if isinstance(_out_data, bytes) else email.message_from_string(_out_data)"
    if old_msg in content:
        content = content.replace(old_msg, new_msg)
        print(f"  ✓ Corregido email.message_from_string() → message_from_bytes() para Python 3")

    # PASO 8: Corregir BIO.MemoryBuffer(tra) — tra puede ser str cuando viene de SignTRA
    old_buf = "        buf = BIO.MemoryBuffer(tra)             # Crear un buffer desde el texto"
    new_buf = "        buf = BIO.MemoryBuffer(tra.encode('utf-8') if isinstance(tra, str) else tra)  # Python 3 compat"
    if old_buf in content:
        content = content.replace(old_buf, new_buf)
        print(f"  ✓ Corregido BIO.MemoryBuffer(tra) para Python 3")
    else:
        # Variante sin comentario al final
        old_buf2 = "        buf = BIO.MemoryBuffer(tra)"
        new_buf2 = "        buf = BIO.MemoryBuffer(tra.encode('utf-8') if isinstance(tra, str) else tra)"
        if old_buf2 in content and new_buf2 not in content:
            content = content.replace(old_buf2, new_buf2)
            print(f"  ✓ Corregido BIO.MemoryBuffer(tra) para Python 3 (variante sin comentario)")

    # PASO 9: Normalizar tipos str/bytes al inicio del path M2Crypto (if BIO:)
    # SignTRA envía cert/privatekey como bytes (encode('latin1')); hay que decodificar
    # a str para que la lógica de "startswith('-----BEGIN')" funcione
    # Buscamos la línea del startswith y anteponemos la normalización
    old_normalize = '        if not privatekey.startswith("-----BEGIN RSA PRIVATE KEY-----"):'
    new_normalize = (
        "        # Normalización Python 3: decodificar bytes a str si llegaron como bytes\n"
        "        if isinstance(privatekey, bytes):\n"
        "            privatekey = privatekey.decode('utf-8', errors='replace')\n"
        "        if isinstance(cert, bytes):\n"
        "            cert = cert.decode('utf-8', errors='replace')\n"
        '        if not privatekey.startswith("-----BEGIN RSA PRIVATE KEY-----"):'
    )
    if old_normalize in content and new_normalize not in content:
        content = content.replace(old_normalize, new_normalize)
        print(f"  ✓ Agregada normalización bytes→str para cert/privatekey (Python 3)")

    # PASO 10: Agregar timezone a generationTime y expirationTime en create_tra
    # AFIP's WSAA schema requires xsd:dateTime WITH timezone (e.g. 2026-02-19T21:50:38+00:00)
    # .isoformat() without timezone gives naive datetime → xml.bad schema error
    old_gen_tz = "tra.header.add_child('generationTime',str(datetime.datetime.fromtimestamp(int(time.time())-ttl).isoformat()))"
    new_gen_tz = "tra.header.add_child('generationTime',str(datetime.datetime.fromtimestamp(int(time.time())-ttl).astimezone().isoformat()))"
    if old_gen_tz in content:
        content = content.replace(old_gen_tz, new_gen_tz)
        print(f"  ✓ generationTime: agregada timezone con .astimezone()")

    old_exp_tz = "tra.header.add_child('expirationTime',str(datetime.datetime.fromtimestamp(int(time.time())+ttl).isoformat()))"
    new_exp_tz = "tra.header.add_child('expirationTime',str(datetime.datetime.fromtimestamp(int(time.time())+ttl).astimezone().isoformat()))"
    if old_exp_tz in content:
        content = content.replace(old_exp_tz, new_exp_tz)
        print(f"  ✓ expirationTime: agregada timezone con .astimezone()")

    # PASO 11: Corregir str(tra) en SignTRA — si tra es bytes, str(bytes) = "b'...'" (invalido)
    # CreateTRA devuelve bytes en Python 3. str(bytes) produce "b'<?xml...'" con b' prefix
    # que AFIP rechaza con xml.bad. Fix: usar decode() para bytes.
    old_signtra = "        return sign_tra(str(tra),cert.encode('latin1'),privatekey.encode('latin1'),passphrase.encode(\"utf8\"))"
    new_signtra = "        tra_str = tra.decode('utf-8') if isinstance(tra, bytes) else str(tra);  return sign_tra(tra_str,cert.encode('latin1'),privatekey.encode('latin1'),passphrase.encode(\"utf8\"))"
    if old_signtra in content:
        content = content.replace(old_signtra, new_signtra)
        print(f"  ✓ Corregido str(tra) → bytes.decode() en SignTRA (Python 3 fix)")

    # PASO 12: Corregir open(fn, "w").write(ta) donde ta es bytes (Python 3)
    # LoginCMS devuelve ta_xml = loginCmsReturn.encode("utf-8") → bytes
    # open("w") no acepta bytes, hay que abrir en "wb"
    old_write_ta = '                    open(fn, "w").write(ta)'
    new_write_ta = '                    open(fn, "wb").write(ta if isinstance(ta, bytes) else ta.encode("utf-8"))'
    if old_write_ta in content:
        content = content.replace(old_write_ta, new_write_ta)
        print(f"  ✓ Corregido open(fn, 'w').write(ta) → open(fn, 'wb') para Python 3")

    # También corregir la lectura del ticket guardado
    old_read_ta = '                ta = open(fn, "r").read()'
    new_read_ta = '                ta = open(fn, "rb").read()'
    if old_read_ta in content:
        content = content.replace(old_read_ta, new_read_ta)
        print(f"  ✓ Corregido open(fn, 'r').read() → open(fn, 'rb') para Python 3")

    if content != original:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"✓ Archivo parcheado exitosamente")
        return True
    else:
        print("⚠ No se encontraron cambios necesarios")
        return False

if __name__ == '__main__':
    wsaa_path = find_wsaa_py()
    if not wsaa_path:
        print("ERROR: No se encontró pyafipws/wsaa.py en site-packages")
        sys.exit(1)
    
    success = patch_wsaa(wsaa_path)
    sys.exit(0 if success else 1)
