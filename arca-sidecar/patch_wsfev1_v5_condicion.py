#!/usr/bin/env python3
"""
Patch 5 for wsfev1.py:
Add CondicionIVAReceptorId field to FECAEDetRequest.
Required by AFIP RG 5616 for all invoices.
Field is optional (minOccurs=0) in WSDL so None is ok if not set.
"""
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

# Add CondicionIVAReceptorId just before the closing of FECAEDetRequest
# (before the 'Opcionales' field or after 'MonCotiz' would be cleaner)
# We'll insert after 'MonCotiz' line:
old_moncotiz = "                     'MonCotiz': f['moneda_ctz'],"
new_moncotiz = (
    "                     'MonCotiz': f['moneda_ctz'],\n"
    "                     # RG 5616: condicion IVA receptor (5=ConsumidorFinal, etc.)\n"
    "                     'CondicionIVAReceptorId': f.get('condicion_iva_receptor_id'),"
)

if old_moncotiz in content:
    content = content.replace(old_moncotiz, new_moncotiz, 1)  # only first occurrence
    print("  ✓ Added CondicionIVAReceptorId to FECAEDetRequest")
else:
    print("  ✗ Pattern not found")
    idx = content.find("MonCotiz")
    print(repr(content[max(0,idx-20):idx+100]))
    raise SystemExit(1)

if content != original:
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("✓ File patched")
else:
    print("No change")
    raise SystemExit(1)
