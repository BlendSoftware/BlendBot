-- Bajar la 000008 NO es reversible en el sentido que importa: se pierde
-- movimiento_insumo, o sea toda la historia de por qué el saldo de cada insumo
-- es el que es. Eso no se backfillea después — lo que no se registró el martes
-- no existe el jueves.
--
-- Un rollback del CORE no necesita correr esto: revertir el binario deja las
-- tres tablas huérfanas y sin efecto (el catálogo vuelve a mirar sólo
-- cupo_jornada, que es lo que hacía antes). Correr este down sólo si se
-- abandona la feature de verdad.

DROP INDEX IF EXISTS idx_movimiento_insumo;
DROP TABLE IF EXISTS movimiento_insumo;

DROP INDEX IF EXISTS idx_receta_insumo;
DROP INDEX IF EXISTS idx_receta_servicio_insumo;
DROP TABLE IF EXISTS receta_item;

DROP INDEX IF EXISTS idx_insumo_negocio;
DROP TABLE IF EXISTS insumo;
