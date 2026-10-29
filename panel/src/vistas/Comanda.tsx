/**
 * La comanda: el modo para la tablet colgada en la cocina. Sin precios ni datos
 * del cliente (docs/PANEL.md → Roles): sólo qué hay que cocinar, con los
 * modificadores de cada ítem. Se ven los pedidos que ya están en cocina
 * (confirmados y en curso), en tickets grandes, y desde acá se los marca listos.
 *
 * TODO(rol cocina): el panel todavía no tiene el rol "cocina" (Rol = admin |
 * dueno | operador | agente). Mientras tanto la comanda queda accesible a
 * cualquiera con sesión del negocio; cuando exista el rol, restringir la ruta y
 * mostrarle SOLO esta vista.
 */

import { Link } from 'react-router-dom'
import { TarjetaPedido } from '../componentes/TarjetaPedido'
import { Aviso, Esqueleto, Vacio } from '../componentes/basicos'
import { usarPedidos } from '../componentes/usarPedidos'
import { useSesion } from '../contexto'
import { agruparPorColumna } from '../dominio/pedidos'

export function Comanda() {
  const { demorasSugeridas } = useSesion()
  const { pedidos, cargando, problema, limpiarProblema, mover } = usarPedidos()

  const enCocina = agruparPorColumna(pedidos).cocina

  return (
    <section className="comanda">
      {/* El mismo encabezado que Carta, Clientes y el resto: la barra fija del
          tablero es sólo de Pedidos, que scrollea largo y necesita el resumen
          siempre a la vista. */}
      <header className="encabezado">
        <div>
          <h1>Comanda</h1>
          <p className="encabezado__bajada">
            {enCocina.length === 1 ? '1 pedido en cocina' : `${enCocina.length} pedidos en cocina`}
          </p>
        </div>
        <div className="encabezado__acciones">
          <Link className="boton boton--fantasma" to="/">
            Volver al tablero
          </Link>
        </div>
      </header>

      <Aviso texto={problema} alCerrar={limpiarProblema} />

      {cargando && enCocina.length === 0 && <Esqueleto alto={140} cantidad={3} />}

      {!cargando && enCocina.length === 0 && (
        <Vacio
          titulo="No hay nada en cocina ahora."
          detalle="Cuando el mostrador confirme un pedido, va a caer acá con lo que hay que preparar."
        />
      )}

      {enCocina.length > 0 && (
        <div className="comanda__grilla">
          {enCocina.map((p) => (
            <TarjetaPedido
              key={p.id}
              pedido={p}
              demorasSugeridas={demorasSugeridas}
              soloCocina
              alTransicionar={(estado, extra) => mover(p.id, estado, extra)}
            />
          ))}
        </div>
      )}
    </section>
  )
}
