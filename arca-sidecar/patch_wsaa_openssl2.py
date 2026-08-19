"""
Patch para wsaa.py - Agrega flag -binary al comando openssl
Nota: La cadena de certificados se maneja mediante un bundle cert+CA
"""
import re

def patch_wsaa_openssl():
    import site
    site_packages = site.getsitepackages()[0]
    wsaa_path = f"{site_packages}/pyafipws/wsaa.py"
    
    with open(wsaa_path, 'r', encoding='latin-1') as f:
        content = f.read()
    
    original_content = content
    
    # Agregar -binary flag si no existe
    if '"-binary"' not in content and "'-binary'" not in content:
        content = re.sub(
            r'("-nodetach"\])',
            r'"-nodetach", "-binary"]',
            content,
            count=1
        )
        if content != original_content:
            print("✓ wsaa.py: agregado flag -binary")
    else:
        print("✓ wsaa.py ya tiene -binary")
    
    if content != original_content:
        with open(wsaa_path, 'w', encoding='latin-1') as f:
            f.write(content)

if __name__ == '__main__':
    patch_wsaa_openssl()
