"""
patch_wsfev1_final.py — Consolidated patch for pyafipws/wsfev1.py
Fixes all Python 2→3 compatibility issues + AFIP RG 5616 compliance.

Changes applied:
  1. sort_dict KeyError:0 (helpers.py) — handled in patch_helpers.py
  2. FeDetResp isinstance check (was [0] on dict)
  3. FECAEDetResponse list unwrap
  4. Errors/Observaciones concatenation fix (list vs dict)
  5. wsfev1_debug logger
  6. CondicionIVAReceptorId in FECAEDetRequest
  7. None-filtering of FECAEDetRequest dict (fixes AFIP errors 10071, 10024)
  8. error.get('Obs')['Code'] TypeError fix
"""
import re, sys

WSFEV1 = '/usr/local/lib/python3.11/site-packages/pyafipws/wsfev1.py'

with open(WSFEV1, 'r') as f:
    src = f.read()

# ── Patch: Replace entire CAESolicitar method (lines 208-322) ──────────────────
# Find the method start and the next @inicializar_y_capturar_excepciones
OLD = '''    @inicializar_y_capturar_excepciones
    def CAESolicitar(self):
        f = self.factura'''

# Verify the old marker exists
if OLD not in src:
    print("ERROR: Patch anchor not found. The file may already be patched or has changed.")
    sys.exit(1)

# The new complete CAESolicitar implementation
NEW = '''    @inicializar_y_capturar_excepciones
    def CAESolicitar(self):
        f = self.factura
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
                {'Tipo': cbte_asoc['tipo'],
                 'PtoVta': cbte_asoc['pto_vta'],
                 'Nro': cbte_asoc['nro']}
                for cbte_asoc in f['cbtes_asoc']] or None,
            'Tributos': f['tributos'] and [
                {'Tributo': {
                    'Id': tributo['tributo_id'],
                    'Desc': tributo['desc'],
                    'BaseImp': tributo['base_imp'],
                    'Alic': tributo['alic'],
                    'Importe': tributo['importe']}}
                for tributo in f['tributos']] or None,
            'Iva': f['iva'] and [
                {'AlicIva': {
                    'Id': iva['iva_id'],
                    'BaseImp': iva['base_imp'],
                    'Importe': iva['importe']}}
                for iva in f['iva']] or None,
            'Opcionales': f['opcionales'] and [
                {'Id': opcional['opcional_id'],
                 'Valor': opcional['valor']}
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

        result = ret['FECAESolicitarResult']
        import logging as _logging
        _logging.getLogger('wsfev1_debug').warning('AFIP FECAESolicitarResult: %s', dict(result) if hasattr(result, 'items') else result)
        if 'FeCabResp' in result:
            fecabresp = result['FeCabResp']
            fedetresp_raw = result['FeDetResp']
            if isinstance(fedetresp_raw, list):
                fedetresp = fedetresp_raw[0]['FECAEDetResponse']
            elif isinstance(fedetresp_raw, dict):
                fedetresp = fedetresp_raw.get('FECAEDetResponse', fedetresp_raw)
            else:
                fedetresp = fedetresp_raw[0]['FECAEDetResponse']
            # Python 3: FECAEDetResponse may itself be a list - unwrap
            if isinstance(fedetresp, list):
                fedetresp = fedetresp[0]

            # Reprocesar en caso de error (recuperar CAE emitido anteriormente)
            if self.Reprocesar and ('Errors' in result or 'Observaciones' in fedetresp):
                _errors_list = result.get('Errors',[])
                if isinstance(_errors_list, dict): _errors_list = [_errors_list]
                _obs_list = fedetresp.get('Observaciones',[])
                if isinstance(_obs_list, dict): _obs_list = [_obs_list]
                for error in _errors_list + _obs_list:
                    _err_val = error.get('Err', error.get('Obs'))
                    if isinstance(_err_val, list): _err_val = _err_val[0]
                    err_code = str(_err_val['Code']) if _err_val and isinstance(_err_val, dict) else '0'
                    if fedetresp['Resultado']=='R' and err_code=='10016':
                        # guardo los mensajes xml originales
                        xml_request = self.client.xml_request
                        xml_response = self.client.xml_response
                        cae = self.CompConsultar(f['tipo_cbte'], f['punto_vta'], f['cbt_desde'], reproceso=True)
                        if cae and self.EmisionTipo=='CAE':
                            self.Reproceso = 'S'
                            return cae
                        self.Reproceso = 'N'
                        # reestablesco los mensajes xml originales
                        self.client.xml_request = xml_request
                        self.client.xml_response = xml_response

            self.Resultado = fecabresp['Resultado']
            # Obs:
            _obs_raw = fedetresp.get('Observaciones', [])
            if isinstance(_obs_raw, dict): _obs_raw = [_obs_raw]
            for obs in _obs_raw:
                _obs_item = obs.get('Obs', obs)
                if isinstance(_obs_item, list): _obs_item = _obs_item[0]
                if isinstance(_obs_item, dict):
                    self.Observaciones.append("%(Code)s: %(Msg)s" % _obs_item)
            self.Obs = '\\n'.join(self.Observaciones)
            self.CAE = fedetresp['CAE'] and str(fedetresp['CAE']) or ""
            self.EmisionTipo = 'CAE'
            self.Vencimiento = fedetresp['CAEFchVto']
            self.FechaCbte = fedetresp.get('CbteFch', "") #.strftime("%Y/%m/%d")
            self.CbteNro = fedetresp.get('CbteHasta', 0) # 1L
            self.PuntoVenta = fecabresp.get('PtoVta', 0) # 4000
            self.CbtDesde =fedetresp.get('CbteDesde', 0)
            self.CbtHasta = fedetresp.get('CbteHasta', 0)'''

# Find the end of the old CAESolicitar method (up to the next decorator or method)
# We replace from OLD up to and including "        return self.CAE\n"
END_MARKER = '        return self.CAE\n\n    @inicializar_y_capturar_excepciones\n    def CompTotXRequest'
NEW_END = '        self.__analizar_errores(result)\n        return self.CAE\n\n    @inicializar_y_capturar_excepciones\n    def CompTotXRequest'

# Find old block start
old_start_idx = src.index(OLD)
# Find end of old CAESolicitar
end_search = '        return self.CAE'
old_end_idx = src.index(end_search, old_start_idx) + len(end_search)

old_block = src[old_start_idx:old_end_idx]
new_block = NEW + '\n        self.__analizar_errores(result)\n        return self.CAE'

result = src[:old_start_idx] + new_block + src[old_end_idx:]

with open(WSFEV1, 'w') as f:
    f.write(result)

print("OK: patch_wsfev1_final.py applied successfully")
print(f"  Replaced CAESolicitar method ({old_end_idx - old_start_idx} chars -> {len(new_block)} chars)")
