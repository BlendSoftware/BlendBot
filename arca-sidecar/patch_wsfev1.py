#!/usr/bin/env python3
"""
Parcha pyafipws/wsfev1.py para compatibilidad con Python 3.

Parche 1 — CAESolicitar FeDetResp KeyError: 0
  En Python 2, result['FeDetResp'] era una lista y [0] obtenía el primer elemento.
  En Python 3 con pysimplesoap, sort_dict retorna un Struct (dict), no una lista.
  El código asumía result['FeDetResp'][0]['FECAEDetResponse'] pero en Python 3
  result['FeDetResp'] es ya el dict con 'FECAEDetResponse' dentro.

Parche 2 — CAESolicitar FeDetResp línea de FECAEADetResponse (similar)
  result['FeDetResp'][0]['FECAEADetResponse'] → mismo bug.
"""
import os
import site


def find_wsfev1():
    for path in site.getsitepackages() + [site.getusersitepackages()]:
        if not path:
            continue
        p = os.path.join(path, 'pyafipws', 'wsfev1.py')
        if os.path.exists(p):
            return p
    return None


def patch_wsfev1(path):
    print(f"Parcheando {path}...")

    with open(path, 'r', encoding='utf-8', errors='replace') as f:
        content = f.read()

    original = content
    flags = []

    # ── Parche 1: CAESolicitar — result['FeDetResp'][0]['FECAEDetResponse'] ──
    old1 = "            fedetresp = result['FeDetResp'][0]['FECAEDetResponse']"
    new1 = (
        "            fedetresp_raw = result['FeDetResp']\n"
        "            if isinstance(fedetresp_raw, list):\n"
        "                fedetresp = fedetresp_raw[0]['FECAEDetResponse']\n"
        "                if isinstance(fedetresp, list):\n"
        "                    fedetresp = fedetresp[0]\n"
        "            elif isinstance(fedetresp_raw, dict):\n"
        "                fedetresp = fedetresp_raw.get('FECAEDetResponse', fedetresp_raw)\n"
        "                if isinstance(fedetresp, list):\n"
        "                    fedetresp = fedetresp[0]\n"
        "            else:\n"
        "                fedetresp = fedetresp_raw[0]['FECAEDetResponse']\n"
        "                if isinstance(fedetresp, list):\n"
        "                    fedetresp = fedetresp[0]"
    )
    if old1 in content:
        content = content.replace(old1, new1)
        flags.append("✓ CAESolicitar: FeDetResp[0]['FECAEDetResponse'] → isinstance check")

    # ── Parche 2: line ~753 result['FeDetResp'][0]['FECAEADetResponse'] ──────
    old2 = "            fedetresp = result['FeDetResp'][0]['FECAEADetResponse']"
    new2 = (
        "            fedetresp_a_raw = result['FeDetResp']\n"
        "            if isinstance(fedetresp_a_raw, list):\n"
        "                fedetresp = fedetresp_a_raw[0]['FECAEADetResponse']\n"
        "                if isinstance(fedetresp, list):\n"
        "                    fedetresp = fedetresp[0]\n"
        "            elif isinstance(fedetresp_a_raw, dict):\n"
        "                fedetresp = fedetresp_a_raw.get('FECAEADetResponse', fedetresp_a_raw)\n"
        "                if isinstance(fedetresp, list):\n"
        "                    fedetresp = fedetresp[0]\n"
        "            else:\n"
        "                fedetresp = fedetresp_a_raw[0]['FECAEADetResponse']\n"
        "                if isinstance(fedetresp, list):\n"
        "                    fedetresp = fedetresp[0]"
    )
    if old2 in content:
        content = content.replace(old2, new2)
        flags.append("✓ CAEASolicitar: FeDetResp[0]['FECAEADetResponse'] → isinstance check")

    if content != original:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
        for msg in flags:
            print(f"  {msg}")
        print(f"✓ Archivo parcheado exitosamente ({len(flags)} parches)")
        return True
    else:
        print("⚠ No se encontraron patrones conocidos")
        # Debug: find all occurrences of FeDetResp
        idx = 0
        while True:
            idx = content.find('FeDetResp', idx)
            if idx < 0:
                break
            print(f"  FeDetResp at pos {idx}: {repr(content[max(0,idx-20):idx+80])}")
            idx += 1
        return False


if __name__ == '__main__':
    p = find_wsfev1()
    if not p:
        print("ERROR: No se encontró pyafipws/wsfev1.py en site-packages")
        raise SystemExit(1)
    success = patch_wsfev1(p)
    raise SystemExit(0 if success else 1)
