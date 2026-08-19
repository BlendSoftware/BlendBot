"""
Patch para wsaa.py - Corregir comando openssl para firma CMS compatible con AFIP
Agrega los flags -binary y -certfile necesarios para AFIP
"""
import re

def patch_wsaa_openssl():
    import site
    site_packages = site.getsitepackages()[0]
    wsaa_path = f"{site_packages}/pyafipws/wsaa.py"
    
    with open(wsaa_path, 'r', encoding='latin-1') as f:
        content = f.read()
    
    original_content = content
    
    # FASE 1: Agregar -binary si no existe
    if '"-binary"' not in content and "'-- binary'" not in content:
        # Buscar el Popen con openssl smime y agregar -binary
        content = re.sub(
            r'("-nodetach"\])',
            r'"-nodetach", "-binary"]',
            content,
            count=1  # Solo el primer match (wsaa.py solo tiene uno)
        )
        if content != original_content:
            print("✓ wsaa.py: agregado flag -binary al comando openssl smime")
            original_content = content
    else:
        print("✓ wsaa.py ya tiene flag -binary")
    
    # FASE 2: Agregar -certfile si no existe
    if '"-certfile"' not in content and "'-certfile'" not in content:
        # Buscar "inkey", privatekey, y agregar -certfile después
        content = re.sub(
            r'("-inkey", privatekey,)',
            r'"-inkey", privatekey,\n                       "-certfile", "/certs/afip_intermediate.pem",',
            content,
            count=1
        )
        if content != original_content:
            print("✓ wsaa.py: agregado -certfile con CA intermedia de AFIP")
        else:
            print("⚠ No se pudo agregar -certfile (patrón no encontrado)")
    else:
        print("✓ wsaa.py ya tiene flag -certfile")
    
    # Escribir archivo solo si hubo cambios
    if content != original_content or content.count('"openssl", "smime"') > 0:
        # Verificar que el resultado tenga ambos flags
        with open(wsaa_path, 'w', encoding='latin-1') as f:
            f.write(content)
        
        # Validación post-patch
        has_binary = '"-binary"' in content or "'-binary'" in content
        has_certfile = '"-certfile"' in content or "'-certfile'" in content
        
        if has_binary and has_certfile:
            print("✓✓ wsaa.py parcheado exitosamente: -binary ✓  -certfile ✓")
        elif has_binary:
            print("⚠ wsaa.py parcialmente parcheado: -binary ✓  -certfile reintente el patch...")
        else:
            print("⚠ wsaa.py no se pudo parchear correctamente")

if __name__ == '__main__':
    patch_wsaa_openssl()