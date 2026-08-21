/**
 * La vista de Clientes se bifurca por vertical. En gastronomía es la libreta de
 * todos los que pidieron alguna vez: el dueño quiere ver de un vistazo a su
 * gente, con cuántos pedidos hizo cada uno y cuánto gastó. En salud es la ficha
 * del paciente: se busca por teléfono exacto (el identificador de WhatsApp) o
 * por nombre entre los del día, que es lo que se pregunta en el mostrador.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  actualizarCliente,
  clientePorTelefono,
  listarClientes,
  listarCompromisos,
  traerAgenda,
} from '../api/endpoints'
import type { Cliente, ClienteResumen, Compromiso, TurnoAgenda } from '../api/tipos'
import { Aviso, Esqueleto, Vacio, useAvisoBien } from '../componentes/basicos'
import { useSesion } from '../contexto'
import { etiquetaEstado } from '../dominio/estados'
import {
  fechaCorta,
  horaDe,
  hoyISO,
  nombreVisible,
  plata,
  sumarDias,
  telefonoVisible,
} from '../dominio/formato'

const DIAS_DE_HISTORIAL = 180

export function Clientes() {
  const { negocio } = useSesion()
  // Hasta que llega el negocio no sabemos qué vertical es; no queremos mostrar
  // la libreta de gastronomía y que después salte a la ficha de salud (ni al
  // revés). Es un ida y vuelta corto contra el token.
  if (!negocio) return <Esqueleto alto={80} cantidad={4} />
  return negocio.vertical === 'gastronomia' ? <ClientesGastro /> : <ClientesSalud />
}

// ── Gastronomía: la libreta de todos los que pidieron ──────────────────────────

function ClientesGastro() {
  const { vePlata } = useSesion()
  const [lista, setLista] = useState<ClienteResumen[] | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [problema, setProblema] = useState('')

  useEffect(() => {
    let vivo = true
    listarClientes()
      .then((cs) => {
        if (vivo) setLista(cs)
      })
      .catch((e) => {
        if (vivo) setProblema(e instanceof Error ? e.message : 'No se pudo traer la lista.')
      })
    return () => {
      vivo = false
    }
  }, [])

  const filtrados = useMemo(() => {
    if (!lista) return []
    const texto = busqueda.trim().toLowerCase()
    if (!texto) return lista
    const soloNumeros = texto.replace(/\D/g, '')
    return lista.filter(
      (c) =>
        (c.nombre ?? '').toLowerCase().includes(texto) ||
        (soloNumeros.length > 0 && c.telefono.includes(soloNumeros)),
    )
  }, [lista, busqueda])

  return (
    <section className="clientes">
      <header className="encabezado">
        <div>
          <h1>Clientes</h1>
          <p className="encabezado__bajada">Todos los que pidieron alguna vez, el último primero.</p>
        </div>
      </header>

      <form className="clientes__buscador" onSubmit={(e) => e.preventDefault()}>
        <label className="campo clientes__campo">
          <span>Buscar por nombre o teléfono</span>
          <input
            className="entrada"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Lucía o 2615551234"
          />
        </label>
      </form>

      <Aviso texto={problema} alCerrar={() => setProblema('')} />

      {!lista && <Esqueleto alto={56} cantidad={5} />}

      {lista && lista.length === 0 && (
        <Vacio
          titulo="Todavía no pidió nadie."
          detalle="Cuando entre el primer pedido, el cliente aparece acá."
        />
      )}

      {lista && lista.length > 0 && (
        <>
          <div className="grupo__cabeza">
            <span className="grupo__cuenta">
              {filtrados.length === 1 ? '1 cliente' : `${filtrados.length} clientes`}
            </span>
          </div>
          {filtrados.length === 0 ? (
            <Vacio titulo="Nadie coincide con esa búsqueda." detalle="Probá con otro nombre o teléfono." />
          ) : (
            <ul className="clientes__tabla">
              {filtrados.map((c) => (
                <li key={c.id} className="clientes__fila">
                  <div className="clientes__fila-quien">
                    <span className="clientes__fila-nombre">{nombreVisible(c.nombre, c.telefono)}</span>
                    <span className="clientes__fila-tel tabular">{telefonoVisible(c.telefono)}</span>
                  </div>
                  <div className="clientes__fila-datos">
                    <span className="clientes__fila-pedidos">
                      {c.cantidad_pedidos === 1 ? '1 pedido' : `${c.cantidad_pedidos} pedidos`}
                    </span>
                    {/* Lo que gastó cada cliente es plata del negocio: la ve el dueño. */}
                    {vePlata && c.cantidad_pedidos > 0 && (
                      <span className="plata">{plata(c.total_acumulado)}</span>
                    )}
                    {c.ultimo_pedido && (
                      <span className="clientes__fila-ultimo tabular">
                        {fechaCorta(c.ultimo_pedido.slice(0, 10))}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

// ── Salud: buscar a alguien y ver su ficha ─────────────────────────────────────

function ClientesSalud() {
  const { negocio, vePlata } = useSesion()
  const [busqueda, setBusqueda] = useState('')
  const [delDia, setDelDia] = useState<TurnoAgenda[]>([])
  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [historial, setHistorial] = useState<Compromiso[] | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [problema, setProblema] = useState('')
  const [bien, mostrarBien] = useAvisoBien()

  useEffect(() => {
    let vivo = true
    traerAgenda(hoyISO())
      .then((a) => {
        if (!vivo) return
        setDelDia([...a.recursos.flatMap((r) => r.turnos), ...a.sin_recurso])
      })
      .catch(() => {
        /* la lista del día es una ayuda, no el corazón de esta vista */
      })
    return () => {
      vivo = false
    }
  }, [])

  const sugeridos = useMemo(() => {
    const texto = busqueda.trim().toLowerCase()
    const unicos = new Map<string, TurnoAgenda>()
    for (const t of delDia) if (!unicos.has(t.cliente_telefono)) unicos.set(t.cliente_telefono, t)
    const lista = [...unicos.values()]
    if (!texto) return lista
    return lista.filter(
      (t) =>
        (t.cliente_nombre ?? '').toLowerCase().includes(texto) ||
        t.cliente_telefono.includes(texto.replace(/\D/g, '')),
    )
  }, [delDia, busqueda])

  const traerFicha = useCallback(async (telefono: string) => {
    setBuscando(true)
    setProblema('')
    setHistorial(null)
    try {
      const c = await clientePorTelefono(telefono)
      setCliente(c)
      const desde = sumarDias(hoyISO(), -DIAS_DE_HISTORIAL)
      const todos = await listarCompromisos({ desde })
      setHistorial(todos.filter((x) => x.cliente_id === c.id))
    } catch (e) {
      setCliente(null)
      setProblema(
        e instanceof Error && e.message === 'Eso ya no está.'
          ? 'Con ese teléfono no hay nadie cargado.'
          : e instanceof Error
            ? e.message
            : 'No se pudo buscar.',
      )
    } finally {
      setBuscando(false)
    }
  }, [])

  return (
    <section className="clientes">
      <header className="encabezado">
        <div>
          <h1>Clientes</h1>
          <p className="encabezado__bajada">Buscá por teléfono, o por nombre entre los de hoy.</p>
        </div>
      </header>

      <form
        className="clientes__buscador"
        onSubmit={(e) => {
          e.preventDefault()
          const soloNumeros = busqueda.replace(/\D/g, '')
          if (soloNumeros.length >= 6) void traerFicha(soloNumeros)
        }}
      >
        <label className="campo clientes__campo">
          <span>Teléfono o nombre</span>
          <input
            className="entrada"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="2615551234 o Lucía"
          />
        </label>
        <button
          type="submit"
          className="boton boton--primario"
          disabled={busqueda.replace(/\D/g, '').length < 6 || buscando}
        >
          {buscando ? 'Buscando' : 'Buscar'}
        </button>
      </form>

      <Aviso texto={problema} alCerrar={() => setProblema('')} />
      <Aviso texto={bien} tono="bien" />

      <div className="clientes__cuerpo">
        <section className="clientes__hoy">
          <div className="grupo__cabeza">
            <h2>Los de hoy</h2>
            <span className="grupo__cuenta">
              {sugeridos.length === 1 ? '1 persona' : `${sugeridos.length} personas`}
            </span>
          </div>
          {sugeridos.length === 0 && (
            <Vacio
              titulo="Hoy no vino nadie todavía."
              detalle="Buscá por teléfono a cualquier persona ya cargada."
            />
          )}
          <ul className="clientes__lista">
            {sugeridos.map((t) => (
              <li key={t.cliente_telefono}>
                <button
                  type="button"
                  className="clientes__item"
                  onClick={() => void traerFicha(t.cliente_telefono)}
                >
                  <span className="clientes__item-nombre">
                    {nombreVisible(t.cliente_nombre, t.cliente_telefono)}
                  </span>
                  <span className="clientes__item-hora hora">{horaDe(t.inicio)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="ficha">
          {!cliente && !buscando && <p className="ficha__nadie">Todavía no elegiste a nadie.</p>}
          {buscando && <Esqueleto alto={64} cantidad={3} />}
          {cliente && (
            <>
              <h2 className="ficha__nombre">
                {nombreVisible(cliente.nombre, cliente.telefono)}
              </h2>
              <p className="ficha__telefono tabular">{telefonoVisible(cliente.telefono)}</p>

              <FichaEditable
                cliente={cliente}
                coberturas={negocio?.coberturas ?? []}
                alGuardar={(c) => {
                  setCliente(c)
                  mostrarBien('Ficha guardada.')
                }}
                alFallar={setProblema}
              />

              <h3 className="ficha__subtitulo">Historial</h3>
              {!historial && <Esqueleto alto={44} cantidad={2} />}
              {historial && historial.length === 0 && (
                <p className="ficha__nadie">Es la primera vez que viene.</p>
              )}
              {historial && historial.length > 0 && (
                <ul className="historial">
                  {historial
                    .slice()
                    .sort((a, b) => (a.inicio ?? a.creado_en) < (b.inicio ?? b.creado_en) ? 1 : -1)
                    .map((c) => (
                      <li key={c.id} className="historial__item">
                        <span className="tabular">
                          {fechaCorta((c.inicio ?? c.creado_en).slice(0, 10))}
                          {c.inicio ? ` · ${horaDe(c.inicio)}` : ''}
                        </span>
                        <span className="historial__estado">{etiquetaEstado(c.estado, c.tipo)}</span>
                        {/* Lo que gastó cada cliente es plata del negocio: la
                            ve el dueño (docs/PANEL.md → Roles). */}
                        {vePlata && <span className="plata">{plata(c.total)}</span>}
                      </li>
                    ))}
                </ul>
              )}
            </>
          )}
        </section>
      </div>
    </section>
  )
}

function FichaEditable({
  cliente,
  coberturas,
  alGuardar,
  alFallar,
}: {
  cliente: Cliente
  coberturas: { id: string; nombre: string }[]
  alGuardar: (c: Cliente) => void
  alFallar: (m: string) => void
}) {
  const [nombre, setNombre] = useState(cliente.nombre ?? '')
  const [cobertura, setCobertura] = useState(cliente.cobertura_id ?? '')
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    setNombre(cliente.nombre ?? '')
    setCobertura(cliente.cobertura_id ?? '')
  }, [cliente])

  const cambio = nombre !== (cliente.nombre ?? '') || cobertura !== (cliente.cobertura_id ?? '')

  return (
    <form
      className="ficha__forma"
      onSubmit={async (e) => {
        e.preventDefault()
        setGuardando(true)
        try {
          const guardado = await actualizarCliente(cliente.id, {
            nombre: nombre.trim() || null,
            cobertura_id: cobertura || null,
          })
          alGuardar(guardado)
        } catch (err) {
          alFallar(err instanceof Error ? err.message : 'No se pudo guardar.')
        } finally {
          setGuardando(false)
        }
      }}
    >
      <label className="campo">
        <span>Nombre</span>
        <input className="entrada" value={nombre} onChange={(e) => setNombre(e.target.value)} />
      </label>

      <label className="campo">
        <span>Club</span>
        <select
          className="entrada"
          value={cobertura}
          onChange={(e) => setCobertura(e.target.value)}
        >
          <option value="">Sin club</option>
          {coberturas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
      </label>

      <button type="submit" className="boton boton--primario" disabled={!cambio || guardando}>
        {guardando ? 'Guardando' : 'Guardar'}
      </button>
    </form>
  )
}
