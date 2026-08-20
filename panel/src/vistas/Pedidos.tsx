/**
 * El tablero de cocina: la pantalla del local gastronómico. Tres columnas por
 * estado (Pendientes → En cocina → Listos), cada pedido pintado del color de su
 * estado y con el contador contra la demora prometida. Es la versión
 * gastronomía de la Vista 1 (docs/PANEL.md); salud sigue viendo la agenda.
 *
 * Se refresca sola cada 15 s (hook usarPedidos). Se opera con el pulgar: OK/✕ y
 * el selector de demora al confirmar, botones de 48px.
 */

import { Link } from 'react-router-dom'
import { salir } from '../api/endpoints'
import { TarjetaPedido } from '../componentes/TarjetaPedido'
import { Aviso, Esqueleto, Vacio } from '../componentes/basicos'
import { usarPedidos } from '../componentes/usarPedidos'
import { useSesion } from '../contexto'
import { COLUMNAS, TITULO_COLUMNA, agruparPorColumna, type Columna } from '../dominio/pedidos'

const VACIO_COLUMNA: Record<Columna, string> = {
  pendientes: 'Nada sin confirmar. El WhatsApp está al día.',
  cocina: 'La cocina está libre.',
  listos: 'Nada esperando para salir.',
}

export function Pedidos() {
  const { negocio, demorasSugeridas, vePlata } = useSesion()
  const { pedidos, cargando, problema, limpiarProblema, mover } = usarPedidos()

  const grupos = agruparPorColumna(pedidos)
  const sinConfirmar = grupos.pendientes.length
  const hayPedidos = pedidos.length > 0

  return (
    <section className="tablero">
      <header className="tablero__barra">
        <div className="tablero__marca">
          <h1 className="tablero__negocio">{negocio?.nombre ?? 'Pedidos'}</h1>
          <p className="tablero__resumen">
            {hayPedidos
              ? sinConfirmar > 0
                ? `${sinConfirmar} sin confirmar`
                : 'todo confirmado'
              : 'sin pedidos abiertos'}
          </p>
        </div>
        <div className="tablero__acciones">
          <Link className="boton" to="/comanda">
            Comanda de cocina
          </Link>
          <button
            type="button"
            className="boton boton--fantasma"
            onClick={() => {
              void salir()
            }}
          >
            Salir
          </button>
        </div>
      </header>

      <Aviso texto={problema} alCerrar={limpiarProblema} />

      {cargando && !hayPedidos && <Esqueleto alto={120} cantidad={3} />}

      {!cargando && !hayPedidos && (
        <Vacio
          titulo="Todavía no entró ningún pedido."
          detalle="Cuando alguien pida por WhatsApp, va a aparecer acá para que lo confirmes y le pongas la demora."
        />
      )}

      {hayPedidos && (
        <div className="tablero__columnas">
          {COLUMNAS.map((col) => (
            <section key={col} className={`columna columna--${col}`} aria-label={TITULO_COLUMNA[col]}>
              <header className="columna__cabeza">
                <h2 className="columna__titulo">{TITULO_COLUMNA[col]}</h2>
                <span className="columna__cuenta tabular">{grupos[col].length}</span>
              </header>
              <div className="columna__lista">
                {grupos[col].length === 0 ? (
                  <p className="columna__vacia">{VACIO_COLUMNA[col]}</p>
                ) : (
                  grupos[col].map((p) => (
                    <TarjetaPedido
                      key={p.id}
                      pedido={p}
                      demorasSugeridas={demorasSugeridas}
                      mostrarTotal={vePlata}
                      alTransicionar={(estado, extra) => mover(p.id, estado, extra)}
                    />
                  ))
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  )
}
