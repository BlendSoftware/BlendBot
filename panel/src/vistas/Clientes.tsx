/**
 * Buscar a alguien y ver su ficha. El core busca por teléfono exacto (es el
 * identificador de WhatsApp); por nombre se filtra sobre la gente del día, que
 * es lo que se pregunta en el mostrador: "¿a qué hora venía la señora Paz?".
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  actualizarCliente,
  clientePorTelefono,
  listarCompromisos,
  traerAgenda,
} from '../api/endpoints'
import type { Cliente, Compromiso, TurnoAgenda } from '../api/tipos'
import { Aviso, Esqueleto, Vacio } from '../componentes/basicos'
import { useSesion } from '../contexto'
import { etiquetaEstado } from '../dominio/estados'
import { fechaCorta, horaDe, hoyISO, nombreVisible, plata, sumarDias, telefonoVisible } from '../dominio/formato'

const DIAS_DE_HISTORIAL = 180

export function Clientes() {
  const { negocio, vePlata } = useSesion()
  const [busqueda, setBusqueda] = useState('')
  const [delDia, setDelDia] = useState<TurnoAgenda[]>([])
  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [historial, setHistorial] = useState<Compromiso[] | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [problema, setProblema] = useState('')

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

      <div className="clientes__cuerpo">
        <section className="clientes__hoy">
          <h2>Los de hoy</h2>
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
          {!cliente && !buscando && (
            <p className="ficha__nadie">Elegí a alguien de la lista o buscá por teléfono.</p>
          )}
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
                alGuardar={setCliente}
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
                        {/* Lo que gastó cada paciente es plata del negocio: la
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
        <span>Obra social</span>
        <select
          className="entrada"
          value={cobertura}
          onChange={(e) => setCobertura(e.target.value)}
        >
          <option value="">Particular</option>
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
