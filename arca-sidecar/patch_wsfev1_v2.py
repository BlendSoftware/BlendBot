#!/usr/bin/env python3
"""
Patch 2 for wsfev1.py: Add list unwrapping for FECAEDetResponse.
After the previous patch, fedetresp may still be a list - unwrap it.
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

# After prior patch, we have this block that assigns fedetresp.
# FECAEDetResponse itself may be a list in Python 3 SOAP response.
# We add an unwrap step after the if/elif/else block.
old = (
    "            fedetresp_raw = result['FeDetResp']\n"
    "            if isinstance(fedetresp_raw, list):\n"
    "                fedetresp = fedetresp_raw[0]['FECAEDetResponse']\n"
    "            elif isinstance(fedetresp_raw, dict):\n"
    "                fedetresp = fedetresp_raw.get('FECAEDetResponse', fedetresp_raw)\n"
    "            else:\n"
    "                fedetresp = fedetresp_raw[0]['FECAEDetResponse']"
)
new = (
    "            fedetresp_raw = result['FeDetResp']\n"
    "            if isinstance(fedetresp_raw, list):\n"
    "                fedetresp = fedetresp_raw[0]['FECAEDetResponse']\n"
    "            elif isinstance(fedetresp_raw, dict):\n"
    "                fedetresp = fedetresp_raw.get('FECAEDetResponse', fedetresp_raw)\n"
    "            else:\n"
    "                fedetresp = fedetresp_raw[0]['FECAEDetResponse']\n"
    "            # Python 3: FECAEDetResponse may itself be a list - unwrap\n"
    "            if isinstance(fedetresp, list):\n"
    "                fedetresp = fedetresp[0]"
)

if old in content:
    content = content.replace(old, new)
    print("  ✓ Added list unwrap for FECAEDetResponse")
else:
    print("  Pattern not found. Checking current state:")
    idx = content.find("fedetresp_raw")
    if idx >= 0:
        print(repr(content[max(0, idx-10):idx+500]))
    else:
        print("  No fedetresp_raw found. Already patched differently?")
        # Search for the original unpatched line
        idx2 = content.find("result['FeDetResp'][0]['FECAEDetResponse']")
        if idx2 >= 0:
            print(f"  Found original at {idx2}: {repr(content[max(0,idx2-50):idx2+100])}")
        else:
            print("  Neither pattern found - check file manually")
    raise SystemExit(1)

# Also fix CAEA variant if present
old2 = (
    "            fedetresp_a_raw = result['FeDetResp']\n"
    "            if isinstance(fedetresp_a_raw, list):\n"
    "                fedetresp = fedetresp_a_raw[0]['FECAEADetResponse']\n"
    "            elif isinstance(fedetresp_a_raw, dict):\n"
    "                fedetresp = fedetresp_a_raw.get('FECAEADetResponse', fedetresp_a_raw)\n"
    "            else:\n"
    "                fedetresp = fedetresp_a_raw[0]['FECAEADetResponse']"
)
new2 = (
    "            fedetresp_a_raw = result['FeDetResp']\n"
    "            if isinstance(fedetresp_a_raw, list):\n"
    "                fedetresp = fedetresp_a_raw[0]['FECAEADetResponse']\n"
    "            elif isinstance(fedetresp_a_raw, dict):\n"
    "                fedetresp = fedetresp_a_raw.get('FECAEADetResponse', fedetresp_a_raw)\n"
    "            else:\n"
    "                fedetresp = fedetresp_a_raw[0]['FECAEADetResponse']\n"
    "            # Python 3: FECAEADetResponse may itself be a list - unwrap\n"
    "            if isinstance(fedetresp, list):\n"
    "                fedetresp = fedetresp[0]"
)
if old2 in content:
    content = content.replace(old2, new2)
    print("  ✓ Added list unwrap for FECAEADetResponse (CAEA variant)")

if content != original:
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f"✓ File patched successfully")
else:
    print("No changes made")
    raise SystemExit(1)
