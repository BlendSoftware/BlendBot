#!/usr/bin/env python3
"""
Patch 4 for wsfev1.py:
Add debug logging just before result processing in CAESolicitar 
to see what AFIP actually returns.
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

# After: result = ret['FECAESolicitarResult']
# Add debug logging
old_result = "        result = ret['FECAESolicitarResult']\n        if 'FeCabResp' in result:"
new_result = (
    "        result = ret['FECAESolicitarResult']\n"
    "        import logging as _logging\n"
    "        _logging.getLogger('wsfev1_debug').warning('AFIP FECAESolicitarResult: %s', dict(result) if hasattr(result, 'items') else result)\n"
    "        if 'FeCabResp' in result:"
)

if old_result in content:
    content = content.replace(old_result, new_result)
    print("  ✓ Added debug logging for result")
else:
    print("  ✗ Pattern not found for debug insert")
    idx = content.find("FECAESolicitarResult")
    print(repr(content[max(0,idx-10):idx+200]))

if content != original:
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("✓ File patched")
else:
    print("No change")
    raise SystemExit(1)
