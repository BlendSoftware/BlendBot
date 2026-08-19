#!/usr/bin/env python3
"""
Patch 7 for wsfev1.py: Rewrite CAESolicitar request building to:
1. Remove duplicate FchServDesde/FchServHasta/FchVtoPago keys
2. Remove duplicate CondicionIVAReceptorId
3. Filter out None values from FECAEDetRequest dict (fixes errors 10071, 10024)
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
    lines = f.readlines()

# Find the lines we need to replace
# We look for: line with "def CAESolicitar" and then "ret = self.client.FECAESolicitar"
# We'll replace from the "ret = self.client.FECAESolicitar" line through the closing "))\n"

start_line = None  # line number of "        ret = self.client.FECAESolicitar("
end_line = None    # line number of "            })\n"

for i, line in enumerate(lines):
    if "        ret = self.client.FECAESolicitar(" in line and start_line is None:
        # Make sure we're in CAESolicitar, not CAESolicitarX
        # Check previous lines for "def CAESolicitar"
        context = ''.join(lines[max(0,i-15):i])
        if "def CAESolicitar(self):" in context and "def CAESolicitarX" not in context:
            start_line = i
    if start_line is not None and i > start_line and "            })\n" == line:
        end_line = i
        break

if start_line is None or end_line is None:
    print(f"ERROR: Could not find range. start={start_line}, end={end_line}")
    raise SystemExit(1)

print(f"  Replacing lines {start_line+1}-{end_line+1}")

# The new content to replace those lines with
new_request_lines = """\
        # Construir FECAEDetRequest filtrando None (pysimplesoap envía None como XML vacío)
        _fedet = {k: v for k, v in {
            'Concepto': f['concepto'],
            'DocTipo': f['tipo_doc'],
            'DocNro': f['nro_doc'],
            'CbteDesde': f['cbt_desde'],
            'CbteHasta': f['cbt_hasta'],
            'CbteFch': f['fecha_cbte'],
            'ImpTotal': f['imp_total'],
            'ImpTotConc': f['imp_tot_conc'],
            'ImpNeto': f['imp_neto'],
            'ImpOpEx': f['imp_op_ex'],
            'ImpTrib': f['imp_trib'],
            'ImpIVA': f['imp_iva'],
            # Fechas solo se informan si Concepto in (2,3)
            'FchServDesde': f.get('fecha_serv_desde'),
            'FchServHasta': f.get('fecha_serv_hasta'),
            'FchVtoPago': f.get('fecha_venc_pago'),
            'MonId': f['moneda_id'],
            'MonCotiz': f['moneda_ctz'],
            # RG 5616: CondicionIVAReceptorId (5=ConsumidorFinal, etc.)
            'CondicionIVAReceptorId': f.get('condicion_iva_receptor_id'),
            'CbtesAsoc': f['cbtes_asoc'] and [
                {'CbteAsoc': {'Tipo': cbte_asoc['tipo'],
                              'PtoVta': cbte_asoc['pto_vta'],
                              'Nro': cbte_asoc['nro']}}
                for cbte_asoc in f['cbtes_asoc']] or None,
            'Tributos': f['tributos'] and [
                {'Tributo': {'Id': tributo['tributo_id'],
                             'Desc': tributo['desc'],
                             'BaseImp': tributo['base_imp'],
                             'Alic': tributo['alic'],
                             'Importe': tributo['importe']}}
                for tributo in f['tributos']] or None,
            'Iva': f['iva'] and [
                {'AlicIva': {'Id': iva['iva_id'],
                             'BaseImp': iva['base_imp'],
                             'Importe': iva['importe']}}
                for iva in f['iva']] or None,
            'Opcionales': f['opcionales'] and [
                {'Opcional': {'Id': opcional['opcional_id'],
                              'Valor': opcional['valor']}}
                for opcional in f['opcionales']] or None,
        }.items() if v is not None}
        ret = self.client.FECAESolicitar(
            Auth={'Token': self.Token, 'Sign': self.Sign, 'Cuit': self.Cuit},
            FeCAEReq={
                'FeCabReq': {'CantReg': 1,
                    'PtoVta': f['punto_vta'],
                    'CbteTipo': f['tipo_cbte']},
                'FeDetReq': [{'FECAEDetRequest': _fedet}]
            })
"""

# Rebuild the lines list
new_lines = lines[:start_line] + [new_request_lines] + lines[end_line+1:]

with open(path, 'w', encoding='utf-8') as f:
    f.writelines(new_lines)
print("  OK: Replaced FECAESolicitar call with clean None-filtered version")
print("File patched OK")
