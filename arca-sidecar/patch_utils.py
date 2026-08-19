#!/usr/bin/env python3
"""
Parcha específicamente el archivo utils.py de pyafipws instalado.
Corrige referencias a unicode que no existen en Python 3.
"""
import os
import re
import sys
import site

def find_utils_py():
    """Encuentra el archivo utils.py instalado en site-packages."""
    for path in site.getsitepackages() + [site.getusersitepackages()]:
        if not path:
            continue
        utils_path = os.path.join(path, 'pyafipws', 'utils.py')
        if os.path.exists(utils_path):
            return utils_path
    return None

def patch_utils(path):
    """Aplica parches al archivo utils.py."""
    print(f"Parcheando {path}...")
    
    with open(path, 'r', encoding='utf-8', errors='replace') as f:
        content = f.read()
    
    original = content
    
    # Reemplazar unicode como tipo con str
    # isinstance(x, unicode) -> isinstance(x, str)
    if 'isinstance(msg, unicode)' in content:
        content = content.replace('isinstance(msg, unicode)', 'isinstance(msg, str)')
        print(f"  ✓ Corregido isinstance(msg, unicode)")
    
    # Reemplazar cualquier otra referencia a unicode
    content = re.sub(r'\bunicode\b', 'str', content)
    
    if content != original:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"✓ Archivo parcheado exitosamente")
        return True
    else:
        print("⚠ No se encontraron cambios necesarios")
        return False

if __name__ == '__main__':
    utils_path = find_utils_py()
    if not utils_path:
        print("ERROR: No se encontró pyafipws/utils.py en site-packages")
        sys.exit(1)
    
    success = patch_utils(utils_path)
    sys.exit(0 if success else 1)
