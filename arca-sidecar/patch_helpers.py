#!/usr/bin/env python3
"""
Parcha específicamente el archivo helpers.py de pysimplesoap.

Parche 1 — write mode:
  Corrige el problema de write() que espera str pero recibe bytes en Python 3.
  Cambia open(..., "w") → open(..., "wb") para escritura de caché WSDL.

Parche 2 — Struct pickle safety:
  Struct hereda de dict. Al hacer pickle.load(), Python restaura primero los
  pares key-value del dict (llamando __setitem__) y DESPUÉS restaura __dict__
  del objeto. Esto significa que cuando __setitem__ se ejecuta durante el
  unpickling, self._Struct__keys todavía no existe → AttributeError.
  Se agrega un guard en __setitem__ e insert_setitem que inicializa __keys
  si aún no está presente, haciendo el unpickling seguro.
"""
import os
import re
import sys
import site

def find_helpers_py():
    """Encuentra el archivo helpers.py instalado en site-packages."""
    for path in site.getsitepackages() + [site.getusersitepackages()]:
        if not path:
            continue
        helpers_path = os.path.join(path, 'pysimplesoap', 'helpers.py')
        if os.path.exists(helpers_path):
            return helpers_path
    return None

def patch_helpers(path):
    """Aplica parches al archivo helpers.py."""
    print(f"Parcheando {path}...")

    with open(path, 'r', encoding='utf-8', errors='replace') as f:
        content = f.read()

    original = content
    modified_flags = []

    # ── Parche 1: write mode "w" → "wb" ──────────────────────────────────────
    for old, new in [(',"w")', ',"wb")'), (", 'w')", ", 'wb')")]:
        if old in content:
            content = content.replace(old, new)
            modified_flags.append(f"✓ Cambiado '{old}' -> '{new}' (write mode)")

    for old, new in [('"w"', '"wb"'), ("'w'", "'wb'")]:
        # Solo en contextos de open(...) con asignación (evitar falsos positivos)
        pattern = r'(open\([^)]+)' + re.escape(old) + r'(\))'
        replaced = re.sub(pattern, r'\g<1>' + new + r'\2', content)
        if replaced != content:
            content = replaced
            modified_flags.append(f"✓ Cambiado open(..., {old}) -> open(..., {new})")

    # ── Parche 2: Struct pickle safety ───────────────────────────────────────
    # Reemplaza __setitem__ para que sea seguro durante unpickling
    old_setitem = (
        "    def __setitem__(self, key, value):\n"
        "        if key not in self.__keys:\n"
        "            self.__keys.append(key)\n"
        "        dict.__setitem__(self, key, value)"
    )
    new_setitem = (
        "    def __setitem__(self, key, value):\n"
        "        # Guard para pickle safety: durante unpickling de subclases de dict,\n"
        "        # __setitem__ se invoca antes de que __dict__ sea restaurado.\n"
        "        if '_Struct__keys' not in self.__dict__:\n"
        "            self.__dict__['_Struct__keys'] = []\n"
        "        if key not in self.__keys:\n"
        "            self.__keys.append(key)\n"
        "        dict.__setitem__(self, key, value)"
    )
    if old_setitem in content:
        content = content.replace(old_setitem, new_setitem)
        modified_flags.append("✓ Struct.__setitem__: agregado guard para pickle safety")

    # También parchear insert_setitem si existe
    old_insert = (
        "        if key not in self.__keys:\n"
        "            self.__keys.insert(index, key)\n"
        "        dict.__setitem__(self, key, value)"
    )
    new_insert = (
        "        if '_Struct__keys' not in self.__dict__:\n"
        "            self.__dict__['_Struct__keys'] = []\n"
        "        if key not in self.__keys:\n"
        "            self.__keys.insert(index, key)\n"
        "        dict.__setitem__(self, key, value)"
    )
    if old_insert in content and new_insert not in content:
        content = content.replace(old_insert, new_insert)
        modified_flags.append("✓ Struct.insert_setitem: agregado guard para pickle safety")

    # ── Parche 3: sort_dict KeyError: 0 (Python 2→3 compat) ─────────────────
    # od[k][0] asume que od[k] es una lista; en Python 3 puede ser un dict
    # cuando el esquema WSDL define elementos de lista como dicts anidados.
    old_sort = "                    v = [sort_dict(od[k][0], v1) for v1 in v]"
    new_sort = "                    v = [sort_dict(od[k][0] if isinstance(od[k], list) else od[k], v1) for v1 in v]"
    if old_sort in content:
        content = content.replace(old_sort, new_sort)
        modified_flags.append("✓ sort_dict: od[k][0] → isinstance check para Python 3 compat (KeyError: 0)")

    if content != original:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
        for msg in modified_flags:
            print(f"  {msg}")
        print(f"✓ Archivo parcheado exitosamente ({len(modified_flags)} parches)")
        return True
    else:
        print("⚠ No se encontraron cambios necesarios")
        return False

if __name__ == '__main__':
    helpers_path = find_helpers_py()
    if not helpers_path:
        print("ERROR: No se encontró pysimplesoap/helpers.py en site-packages")
        sys.exit(1)

    success = patch_helpers(helpers_path)
    sys.exit(0 if success else 1)
