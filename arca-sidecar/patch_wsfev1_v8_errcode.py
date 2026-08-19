#!/usr/bin/env python3
"""
Patch 8 for wsfev1.py:
Fix error.get('Obs')['Code'] TypeError: list indices must be integers.
When AFIP returns Observaciones, obs['Obs'] may be a list of {Code,Msg} dicts.
The code assumes obs['Obs'] is a dict with 'Code' key, but it's a list.
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

# Fix: error.get('Err', error.get('Obs'))['Code']
# When error = {'Obs': [{'Code': 10246, 'Msg': '...'}]}, 
# error.get('Obs') returns a list, and ['Code'] fails.
# Fix: unwrap list before accessing 'Code'
old_err = "                    err_code = str(error.get('Err', error.get('Obs'))['Code'])"
new_err = (
    "                    _err_val = error.get('Err', error.get('Obs'))\n"
    "                    if isinstance(_err_val, list): _err_val = _err_val[0]\n"
    "                    err_code = str(_err_val['Code']) if _err_val and isinstance(_err_val, dict) else '0'"
)

if old_err in content:
    content = content.replace(old_err, new_err)
    print("  OK: Fixed error.get('Obs')['Code'] TypeError")
else:
    print("  ERR: Pattern not found")
    idx = content.find("error.get('Err'")
    if idx >= 0:
        print(repr(content[max(0,idx-20):idx+100]))
    raise SystemExit(1)

# Also fix the Observaciones formatting on line ~316
# self.Observaciones.append("%(Code)s: %(Msg)s" % (obs['Obs']))
# When obs['Obs'] is a list, % formatting fails
old_obs_fmt = '                self.Observaciones.append("%(Code)s: %(Msg)s" % (obs[\'Obs\']))'
new_obs_fmt = (
    "                _obs_item = obs.get('Obs', obs)\n"
    "                if isinstance(_obs_item, list): _obs_item = _obs_item[0]\n"
    "                if isinstance(_obs_item, dict):\n"
    "                    self.Observaciones.append(\"%(Code)s: %(Msg)s\" % _obs_item)"
)
if old_obs_fmt in content:
    content = content.replace(old_obs_fmt, new_obs_fmt)
    print("  OK: Fixed Observaciones.append formatting")
else:
    print("  WARN: Observaciones.append pattern not found (may be OK)")

if content != original:
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("File patched OK")
else:
    print("No change")
    raise SystemExit(1)
