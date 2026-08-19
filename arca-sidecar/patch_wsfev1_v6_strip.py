#!/usr/bin/env python3
"""
Patch 6 for wsfev1.py:
Fix Iva/Tributos/Opcionales in FECAEDetRequest to not include 
these elements at all when they're empty (None).

AFIP error 10071: Para comprobantes tipo C el objeto IVA no debe informarse.
AFIP error 10024: Si ImpTrib es igual a 0 el objeto Tributos no debe informarse.

pysimplesoap serializes None as empty XML elements, which AFIP rejects.
The fix builds the request dict and removes None-value keys before sending.
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

# The FECAEDetRequest has 'Iva', 'Tributos', 'Opcionales' that set to None when empty.
# We need to strip None values from the dict before passing to SOAP.
# The approach: after building the FECAEDetRequest dict, filter None values.
#
# Current closing line of FECAEDetRequest is:
#   }}
#   }]  (after 'Opcionales')
# We add dict comprehension to strip None values.
#
# The real fix: replace the "ret = self.client.FECAESolicitar" call to strip Nones.

old_soap_call = "        ret = self.client.FECAESolicitar(\n            Auth={'Token': self.Token, 'Sign': self.Sign, 'Cuit': self.Cuit},"
new_soap_call = (
    "        def _strip_none(d):\n"
    "            \"\"\"Remove None-value keys from a dict recursively (pysimplesoap sends None as empty XML)\"\"\"\n"
    "            if isinstance(d, dict):\n"
    "                return {k: _strip_none(v) for k, v in d.items() if v is not None}\n"
    "            elif isinstance(d, list):\n"
    "                return [_strip_none(i) for i in d]\n"
    "            return d\n"
    "        _fedetreq_raw = {\n"
    "                    'Concepto': f['concepto'],\n"
    "                    'DocTipo': f['tipo_doc'],\n"
    "                    'DocNro': f['nro_doc'],\n"
    "                    'CbteDesde': f['cbt_desde'],\n"
    "                    'CbteHasta': f['cbt_hasta'],\n"
    "                    'CbteFch': f['fecha_cbte'],\n"
    "                    'ImpTotal': f['imp_total'],\n"
    "                    'ImpTotConc': f['imp_tot_conc'],\n"
    "                    'ImpNeto': f['imp_neto'],\n"
    "                    'ImpOpEx': f['imp_op_ex'],\n"
    "                    'ImpTrib': f['imp_trib'],\n"
    "                    'ImpIVA': f['imp_iva'],\n"
    "                    'FchServDesde': f.get('fecha_serv_desde'),\n"
    "                    'FchServHasta': f.get('fecha_serv_hasta'),\n"
    "                    'FchVtoPago': f.get('fecha_venc_pago'),\n"
    "                    'MonId': f['moneda_id'],\n"
    "                    'MonCotiz': f['moneda_ctz'],\n"
    "                    # RG 5616: CondicionIVAReceptorId (5=ConsumidorFinal)\n"
    "                    'CondicionIVAReceptorId': f.get('condicion_iva_receptor_id'),\n"
    "                    'CbtesAsoc': f['cbtes_asoc'] and [\n"
    "                        {'CbteAsoc': {\n"
    "                            'Tipo': cbte_asoc['tipo'],\n"
    "                            'PtoVta': cbte_asoc['pto_vta'],\n"
    "                            'Nro': cbte_asoc['nro']}}\n"
    "                        for cbte_asoc in f['cbtes_asoc']] or None,\n"
    "                    'Tributos': f['tributos'] and [\n"
    "                        {'Tributo': {\n"
    "                            'Id': tributo['tributo_id'], \n"
    "                            'Desc': tributo['desc'],\n"
    "                            'BaseImp': tributo['base_imp'],\n"
    "                            'Alic': tributo['alic'],\n"
    "                            'Importe': tributo['importe'],\n"
    "                            }}\n"
    "                        for tributo in f['tributos']] or None,\n"
    "                    'Iva': f['iva'] and [ \n"
    "                        {'AlicIva': {\n"
    "                            'Id': iva['iva_id'],\n"
    "                            'BaseImp': iva['base_imp'],\n"
    "                            'Importe': iva['importe'],\n"
    "                            }}\n"
    "                        for iva in f['iva']] or None,\n"
    "                    'Opcionales': [ \n"
    "                        {'Opcional': {\n"
    "                            'Id': opcional['opcional_id'],\n"
    "                            'Valor': opcional['valor'],\n"
    "                            }} for opcional in f['opcionales']] or None,\n"
    "                    }\n"
    "        _fedetreq = _strip_none(_fedetreq_raw)\n"
    "        ret = self.client.FECAESolicitar(\n            Auth={'Token': self.Token, 'Sign': self.Sign, 'Cuit': self.Cuit},"
)

if old_soap_call in content:
    content = content.replace(old_soap_call, new_soap_call)
    print("  OK: Added _strip_none helper and _fedetreq builder")
else:
    print("  ERR: Pattern not found")
    idx = content.find("self.client.FECAESolicitar")
    print(repr(content[max(0,idx-10):idx+100]))
    raise SystemExit(1)

# Now replace the FeDetReq part inside the SOAP call to use _fedetreq
# Current:
# 'FeDetReq': [{'FECAEDetRequest': {
#     ... (the whole dict)
# }}]
# New:
# 'FeDetReq': [{'FECAEDetRequest': _fedetreq}]
old_fedetreq_body = (
    "                'FeDetReq': [{'FECAEDetRequest': {\n"
    "                    'Concepto': f['concepto'],\n"
    "                    'DocTipo': f['tipo_doc'],\n"
    "                    'DocNro': f['nro_doc'],\n"
    "                    'CbteDesde': f['cbt_desde'],\n"
    "                    'CbteHasta': f['cbt_hasta'],\n"
    "                    'CbteFch': f['fecha_cbte'],\n"
    "                    'ImpTotal': f['imp_total'],\n"
    "                    'ImpTotConc': f['imp_tot_conc'],\n"
    "                    'ImpNeto': f['imp_neto'],\n"
    "                    'ImpOpEx': f['imp_op_ex'],\n"
    "                    'ImpTrib': f['imp_trib'],\n"
    "                    'ImpIVA': f['imp_iva'],\n"
    "                    # Fechas solo se informan si Concepto in (2,3)\n"
    "                    'FchServDesde': f.get('fecha_serv_desde'),\n"
    "                    'FchServHasta': f.get('fecha_serv_hasta'),\n"
    "                    'FchVtoPago': f.get('fecha_venc_pago'),\n"
    "                    'FchServDesde': f.get('fecha_serv_desde'),\n"
    "                    'FchServHasta': f.get('fecha_serv_hasta'),\n"
    "                    'FchVtoPago': f['fecha_venc_pago'],\n"
    "                    'MonId': f['moneda_id'],\n"
    "                    'MonCotiz': f['moneda_ctz'],                \n"
    "                    # RG 5616: CondicionIVAReceptorId (5=ConsumidorFinal)\n"
    "                    'CondicionIVAReceptorId': f.get('condicion_iva_receptor_id'),\n"
    "                    'CbtesAsoc': f['cbtes_asoc'] and [\n"
    "                        {'CbteAsoc': {\n"
    "                            'Tipo': cbte_asoc['tipo'],\n"
    "                            'PtoVta': cbte_asoc['pto_vta'], \n"
    "                            'Nro': cbte_asoc['nro']}}\n"
    "                        for cbte_asoc in f['cbtes_asoc']] or None,\n"
    "                    'Tributos': f['tributos'] and [\n"
    "                        {'Tributo': {\n"
    "                            'Id': tributo['tributo_id'], \n"
    "                            'Desc': tributo['desc'],\n"
    "                            'BaseImp': tributo['base_imp'],\n"
    "                            'Alic': tributo['alic'],\n"
    "                            'Importe': tributo['importe'],\n"
    "                            }}\n"
    "                        for tributo in f['tributos']] or None,\n"
    "                    'Iva': f['iva'] and [ \n"
    "                        {'AlicIva': {\n"
    "                            'Id': iva['iva_id'],\n"
    "                            'BaseImp': iva['base_imp'],\n"
    "                            'Importe': iva['importe'],\n"
    "                            }}\n"
    "                        for iva in f['iva']] or None,\n"
    "                    'Opcionales': [ \n"
    "                        {'Opcional': {\n"
    "                            'Id': opcional['opcional_id'],\n"
    "                            'Valor': opcional['valor'],\n"
    "                            }} for opcional in f['opcionales']] or None,\n"
    "                    }\n"
    "                }]"
)
new_fedetreq_body = "                'FeDetReq': [{'FECAEDetRequest': _fedetreq}]"

if old_fedetreq_body in content:
    content = content.replace(old_fedetreq_body, new_fedetreq_body)
    print("  OK: Replaced FeDetReq body to use _fedetreq")
else:
    print("  ERR: FeDetReq body pattern not found - checking for fragments")
    idx = content.find("'FeDetReq': [{'FECAEDetRequest':")
    print(repr(content[max(0,idx-10):idx+200]))
    # Not fatal - the helper was added, body replacement didn't work
    # Try to find and show what the current FeDetReq content looks like
    raise SystemExit(1)

if content != original:
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("File patched OK")
else:
    print("No change")
    raise SystemExit(1)
