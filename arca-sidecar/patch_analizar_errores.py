"""
Monkey patch para pyafipws.wsfev1.__analizar_errores
Fix para TypeError cuando AFIP devuelve errores en formato inesperado

Bug original (pyafipws/wsfev1.py:108):
    error['Err']['Code']  # Falla si error es string en lugar de dict
    
Ocurre cuando AFIP devuelve:
    'Errors': {'Err': [{'Code': 10069, 'Msg': '...'}]}
    
En lugar de:
    'Errors': {'Err': {'Code': 10069, 'Msg': '...'}}
"""

import logging
from pyafipws.wsfev1 import WSFEv1

logger = logging.getLogger("patch_analizar_errores")

# Guardar método original
_original_analizar_errores = WSFEv1._WSFEv1__analizar_errores


def __analizar_errores_patched(self, ret):
    """
    Versión mejorada que maneja tanto dict como list en Errors.Err
    """
    try:
        # Intentar método original primero
        return _original_analizar_errores(self, ret)
    except (TypeError, KeyError, AttributeError) as e:
        # Si falla, manejar manualmente
        logger.warning(f"Método original falló ({e}), usando fallback")
        
        # Extraer errores manualmente
        if not isinstance(ret, dict):
            return
        
        # Revisar estructura Errors
        errors = ret.get('Errors')
        if not errors:
            return
        
        err_data = errors.get('Err')
        if not err_data:
            return
        
        # Manejar tanto lista como dict
        if isinstance(err_data, list):
            # Lista de errores
            for error in err_data:
                if isinstance(error, dict):
                    code = error.get('Code', 0)
                    msg = error.get('Msg', 'Sin descripción')
                    self.errores.append({'codigo': code, 'mensaje': msg})
                    logger.error(f"Error AFIP {code}: {msg}")
        elif isinstance(err_data, dict):
            # Un solo error
            code = err_data.get('Code', 0)
            msg = err_data.get('Msg', 'Sin descripción')
            self.errores.append({'codigo': code, 'mensaje': msg})
            logger.error(f"Error AFIP {code}: {msg}")


# Aplicar monkey patch
WSFEv1._WSFEv1__analizar_errores = __analizar_errores_patched

logger.info("✓ Monkey patch aplicado: wsfev1.__analizar_errores (manejo robusto de errores)")
