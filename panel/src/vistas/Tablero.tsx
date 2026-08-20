/**
 * La pantalla principal se bifurca por vertical: gastronomía ve el tablero de
 * cocina (kanban de pedidos), salud ve la agenda de siempre. La rama la decide
 * negocio.vertical; salud es el default (y el fallback si el negocio todavía no
 * cargó). El motor y la agenda no se tocan: esto sólo elige qué mostrar.
 */

import { Esqueleto } from '../componentes/basicos'
import { useSesion } from '../contexto'
import { Agenda } from './Agenda'
import { Pedidos } from './Pedidos'

export function Tablero() {
  const { negocio, claims } = useSesion()

  // El negocio se resuelve del token en un ida y vuelta; hasta que llega no
  // sabemos qué vertical es, y no queremos que gastronomía parpadee la agenda.
  if (!negocio && claims?.rol !== 'admin') {
    return <Esqueleto alto={120} cantidad={3} />
  }

  return negocio?.vertical === 'gastronomia' ? <Pedidos /> : <Agenda />
}
