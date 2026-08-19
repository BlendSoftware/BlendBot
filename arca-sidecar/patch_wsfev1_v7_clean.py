#!/usr/bin/env python3
"""
Patch 7 for wsfev1.py: Complete rewrite of CAESolicitar FECAEDetRequest.
- Remove duplicate CondicionIVAReceptorId keys
- Build FECAEDetRequest dict without None values (fixes errors 10071, 10024, etc.)
- This replaces the existing FECAEDetRequest inline dict with a clean version.
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

# Find and replace the FECAEDetRequest section inside the client.FECAESolicitar call.
# We look for the unique start marker and replace up to the closing }]
# The current structure starts with: 'FeDetReq': [{'FECAEDetRequest': {
# and ends with: }}] (which is at line 271 in the original file)

# Old FeDetReq (with duplicates and possible issues):
old_fedetreq = """                'FeDetReq': [{'FECAEDetRequest': {
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
                    'FchServDesde': f.get('fecha_serv_desde'),
                    'FchServHasta': f.get('fecha_serv_hasta'),
                    'FchVtoPago': f['fecha_venc_pago'],
                    'MonId': f['moneda_id'],
                    'MonCotiz': f['moneda_ctz'],
                    # RG 5616: CondicionIVAReceptorId (5=ConsumidorFinal)
                    'CondicionIVAReceptorId': f.get('condicion_iva_receptor_id'),
                    # RG 5616: CondicionIVAReceptorId (5=ConsumidorFinal)
                    'CondicionIVAReceptorId': f.get('condicion_iva_receptor_id'),
                    'CbtesAsoc': f['cbtes_asoc'] and [
                        {'CbteAsoc': {
                            'Tipo': cbte_asoc['tipo'],
                            'PtoVta': cbte_asoc['pto_vta'],
                            'Nro': cbte_asoc['nro']}}
                        for cbte_asoc in f['cbtes_asoc']] or None,
                    'Tributos': f['tributos'] and [
                        {'Tributo': {
                            'Id': tributo['tributo_id'],
                            'Desc': tributo['desc'],
                            'BaseImp': tributo['base_imp'],
                            'Alic': tributo['alic'],
                            'Importe': tributo['importe'],
                            }}
                        for tributo in f['tributos']] or None,
                    'Iva': f['iva'] and [
                        {'AlicIva': {
                            'Id': iva['iva_id'],
                            'BaseImp': iva['base_imp'],
                            'Importe': iva['importe'],
                            }}
                        for iva in f['iva']] or None,
                    'Opcionales': [
                        {'Opcional': {
                            'Id': opcional['opcional_id'],
                            'Valor': opcional['valor'],
                            }} for opcional in f['opcionales']] or None,
                    }
                }]"""

# New FeDetReq: build dict cleanly, only include non-None/non-empty optional fields
new_fedetreq = """                'FeDetReq': [{'FECAEDetRequest': {k: v for k, v in {
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
                    # RG 5616: CondicionIVAReceptorId (5=ConsumidorFinal)
                    'CondicionIVAReceptorId': f.get('condicion_iva_receptor_id'),
                    'CbtesAsoc': f['cbtes_asoc'] and [
                        {'CbteAsoc': {
                            'Tipo': cbte_asoc['tipo'],
                            'PtoVta': cbte_asoc['pto_vta'],
                            'Nro': cbte_asoc['nro']}}
                        for cbte_asoc in f['cbtes_asoc']] or None,
                    'Tributos': f['tributos'] and [
                        {'Tributo': {
                            'Id': tributo['tributo_id'],
                            'Desc': tributo['desc'],
                            'BaseImp': tributo['base_imp'],
                            'Alic': tributo['alic'],
                            'Importe': tributo['importe'],
                            }}
                        for tributo in f['tributos']] or None,
                    'Iva': f['iva'] and [
                        {'AlicIva': {
                            'Id': iva['iva_id'],
                            'BaseImp': iva['base_imp'],
                            'Importe': iva['importe'],
                            }}
                        for iva in f['iva']] or None,
                    'Opcionales': f['opcionales'] and [
                        {'Opcional': {
                            'Id': opcional['opcional_id'],
                            'Valor': opcional['valor'],
                            }} for opcional in f['opcionales']] or None,
                    }.items() if v is not None}
                }]"""

if old_fedetreq in content:
    content = content.replace(old_fedetreq, new_fedetreq)
    print("  OK: Rewrote FECAEDetRequest to filter None values")
else:
    print("  ERR: Pattern not found")
    idx = content.find("'FeDetReq': [{'FECAEDetRequest':")
    print(repr(content[max(0,idx-5):idx+500]))
    raise SystemExit(1)

if content != original:
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("File patched OK")
else:
    print("No change")
    raise SystemExit(1)
