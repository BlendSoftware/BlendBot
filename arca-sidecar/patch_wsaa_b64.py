"""
Patch final para wsaa.py - Corregir b64encode para devolver string en vez de bytes
"""
import re

def patch_wsaa_b64():
    import site
    site_packages = site.getsitepackages()[0]
    wsaa_path = f"{site_packages}/pyafipws/wsaa.py"
    
    with open(wsaa_path, 'r', encoding='latin-1') as f:
        content = f.read()
    
    # El problema: b64encode(out) devuelve bytes en Python 3
    # Cuando se pasa a LoginCMS con str(cms), se convierte a "b'...'" literalmente
    # Solución: decodificar a ASCII/UTF-8 antes de devolver
    
    # Usar regex para manejar cualquier cantidad de espacios
    old_pattern = r'(\s+)return b64encode\(out\)'
    new_pattern = r'\1return b64encode(out).decode("ascii")  # Python 3: devolver str, no bytes'
    
    if re.search(old_pattern, content):
        content = re.sub(old_pattern, new_pattern, content)
        with open(wsaa_path, 'w', encoding='latin-1') as f:
            f.write(content)
        print(f"✓ wsaa.py patched: b64encode now returns str instead of bytes")
    else:
        print("⚠ Pattern not found - might be already patched")

if __name__ == '__main__':
    patch_wsaa_b64()
