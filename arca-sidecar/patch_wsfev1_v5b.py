#!/usr/bin/env python3
"""Patch wsfev1.py to add CondicionIVAReceptorId to FECAEDetRequest."""
import os, site

def find_wsfev1():
    for path in site.getsitepackages() + [site.getusersitepackages()]:
        if not path:
            continue
        p = os.path.join(path, 'pyafipws', 'wsfev1.py')
        if os.path.exists(p):
            return p
    return None

path = find_wsfev1()
if not path:
    raise SystemExit("wsfev1.py not found")

print(f"Patching {path}")
with open(path, 'r', encoding='utf-8', errors='replace') as f:
    content = f.read()

original = content

# The MonCotiz line has trailing spaces — use exact repr
old_line = "                    'MonCotiz': f['moneda_ctz'],                "
new_lines = (
    "                    'MonCotiz': f['moneda_ctz'],                \n"
    "                    # RG 5616: CondicionIVAReceptorId (5=ConsumidorFinal)\n"
    "                    'CondicionIVAReceptorId': f.get('condicion_iva_receptor_id'),"
)

if old_line in content:
    content = content.replace(old_line, new_lines, 1)  # only first occurrence in CAESolicitar
    print("  OK: Added CondicionIVAReceptorId to FECAEDetRequest")
else:
    print("  ERR: Pattern not found, trying strip variant")
    # try with stripped trailing spaces
    old_stripped = "                    'MonCotiz': f['moneda_ctz'],"
    idx = content.find(old_stripped)
    if idx >= 0:
        print(f"  Found stripped at {idx}: {repr(content[idx:idx+60])}")
    else:
        print("  NOT FOUND AT ALL")
    raise SystemExit(1)

if content != original:
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("File patched OK")
else:
    print("No change")
    raise SystemExit(1)
