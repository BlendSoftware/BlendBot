#!/usr/bin/env python3
"""
Patch 3 for wsfev1.py:
- Fix result.get('Errors',[]) + fedetresp.get('Observaciones',[]) concatenation
  when Errors/Observaciones are dicts (Python 3 SOAP response) instead of lists.
- Also add debug logging to see what AFIP actually returns.
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

def ensure_list(val):
    """Helper: ensure a value that may be a dict or list is always a list."""
    if val is None:
        return []
    if isinstance(val, list):
        return val
    return [val]

path = find_wsfev1()
if not path:
    raise SystemExit("wsfev1.py not found")

print(f"Patching {path}")
with open(path, 'r', encoding='utf-8', errors='replace') as f:
    content = f.read()

original = content

# Fix line 286: concatenation of Errors + Observaciones
# Original (Python 2): result.get('Errors',[])+fedetresp.get('Observaciones',[])
# In Python 3, Errors may be a dict (single error) not a list
old286 = "                for error in result.get('Errors',[])+fedetresp.get('Observaciones',[]):"
new286 = (
    "                _errors_list = result.get('Errors',[])\n"
    "                if isinstance(_errors_list, dict): _errors_list = [_errors_list]\n"
    "                _obs_list = fedetresp.get('Observaciones',[])\n"
    "                if isinstance(_obs_list, dict): _obs_list = [_obs_list]\n"
    "                for error in _errors_list + _obs_list:"
)

if old286 in content:
    content = content.replace(old286, new286)
    print("  ✓ Fixed Errors+Observaciones concatenation (line ~286)")
else:
    print(f"  ✗ Pattern for line 286 not found")
    idx = content.find("result.get('Errors'")
    if idx >= 0:
        print(repr(content[max(0,idx-100):idx+200]))

# Also fix similar patterns with Observaciones iteration alone (line 300+)
# for obs in fedetresp.get('Observaciones', []):
# In Python 3 this might return a dict instead of list
old300 = "            for obs in fedetresp.get('Observaciones', []):"
new300 = (
    "            _obs_raw = fedetresp.get('Observaciones', [])\n"
    "            if isinstance(_obs_raw, dict): _obs_raw = [_obs_raw]\n"
    "            for obs in _obs_raw:"
)
if old300 in content:
    content = content.replace(old300, new300)
    print("  ✓ Fixed Observaciones iteration (line ~300)")

if content != original:
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("✓ File patched successfully")
else:
    print("No changes needed or patterns not found")
    raise SystemExit(1)
