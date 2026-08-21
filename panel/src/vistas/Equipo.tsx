/**
 * Quién atiende y cuándo. El interruptor de acá es el hermano del catálogo:
 * un profesional apagado deja de tener huecos y el asistente no lo ofrece.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  actualizarRecurso,
  borrarExcepcion,
  borrarHorario,
  crearExcepcion,
  crearHorario,
  crearRecurso,
  listarExcepciones,
  listarHorarios,
  listarRecursos,
} from '../api/endpoints'
import type { Excepcion, Horario, Recurso } from '../api/tipos'
import { Switch } from '../componentes/Switch'
import { Aviso, BotonConfirmar, Esqueleto, Vacio, useAvisoBien } from '../componentes/basicos'
import { DIAS_CORTOS } from '../dominio/formato'
import { useSesion } from '../contexto'
import { ElLocal } from './ElLocal'

const DIAS_LARGOS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

export function Equipo() {
  const { negocio } = useSesion()
  // En gastronomía esta pestaña no es "quién atiende" sino la ficha del local:
  // un solo negocio, sin profesionales con agenda. En salud sigue igual.
  if (negocio?.vertical === 'gastronomia') return <ElLocal />
  return <EquipoSalud />
}

function EquipoSalud() {
  const [recursos, setRecursos] = useState<Recurso[]>([])
  const [elegido, setElegido] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [problema, setProblema] = useState('')
  const [nuevo, setNuevo] = useState('')
  const [bien, mostrarBien] = useAvisoBien()

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const lista = await listarRecursos()
      setRecursos(lista)
      setElegido((actual) => actual ?? lista[0]?.id ?? null)
      setProblema('')
    } catch (e) {
      setProblema(e instanceof Error ? e.message : 'No se pudo traer el equipo.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  async function agregar(e: React.FormEvent) {
    e.preventDefault()
    const nombre = nuevo.trim()
    if (!nombre) return
    try {
      const r = await crearRecurso({ tipo: 'profesional', nombre, capacidad: 1 })
      setRecursos((l) => [...l, r])
      setElegido(r.id)
      setNuevo('')
    } catch (err) {
      setProblema(err instanceof Error ? err.message : 'No se pudo agregar.')
    }
  }

  const actual = recursos.find((r) => r.id === elegido) ?? null

  return (
    <section className="equipo">
      <header className="encabezado">
        <div>
          <h1>Equipo</h1>
          <p className="encabezado__bajada">Quién atiende, en qué horarios y qué días no viene.</p>
        </div>
      </header>

      <Aviso texto={problema} alCerrar={() => setProblema('')} />
      <Aviso texto={bien} tono="bien" />

      {cargando && <Esqueleto alto={64} cantidad={3} />}

      {!cargando && recursos.length === 0 && (
        <Vacio
          titulo="Todavía no hay nadie cargado."
          detalle="Con el primer nombre y sus horarios, la agenda ya tiene columnas y el asistente empieza a dar turnos."
        />
      )}

      {!cargando && (
        <div className="equipo__cuerpo">
          <div className="equipo__panel">
            <span className="grupo__cuenta">
              {recursos.length === 1 ? '1 persona' : `${recursos.length} personas`}
            </span>

            <ul className="equipo__lista">
              {recursos.map((r) => (
                <li key={r.id} className={`persona ${elegido === r.id ? 'persona--elegida' : ''}`}>
                  <button type="button" className="persona__nombre" onClick={() => setElegido(r.id)}>
                    {r.nombre}
                  </button>
                  <Switch
                    activo={r.activo}
                    etiquetaSi="atiende"
                    etiquetaNo="no viene"
                    describe={r.nombre}
                    alCambiar={async (v) => {
                      const guardado = await actualizarRecurso(r.id, { activo: v })
                      setRecursos((l) => l.map((x) => (x.id === r.id ? guardado : x)))
                    }}
                    alFallar={setProblema}
                  />
                </li>
              ))}
            </ul>

            <form onSubmit={agregar} className="equipo__forma">
              <input
                className="entrada"
                placeholder="Sumar a alguien"
                value={nuevo}
                onChange={(e) => setNuevo(e.target.value)}
                aria-label="Nombre de la persona nueva"
              />
              <button type="submit" className="boton" disabled={!nuevo.trim()}>
                Sumar
              </button>
            </form>
          </div>

          {actual && <Semana recurso={actual} alFallar={setProblema} alExito={mostrarBien} />}
        </div>
      )}
    </section>
  )
}

function Semana({
  recurso,
  alFallar,
  alExito,
}: {
  recurso: Recurso
  alFallar: (m: string) => void
  alExito: (m: string) => void
}) {
  const [horarios, setHorarios] = useState<Horario[] | null>(null)
  const [excepciones, setExcepciones] = useState<Excepcion[] | null>(null)

  useEffect(() => {
    let vivo = true
    setHorarios(null)
    setExcepciones(null)
    Promise.all([listarHorarios(recurso.id), listarExcepciones(recurso.id)])
      .then(([h, e]) => {
        if (!vivo) return
        setHorarios(h)
        setExcepciones(e)
      })
      .catch((e: unknown) => {
        if (vivo) alFallar(e instanceof Error ? e.message : 'No se pudieron traer los horarios.')
      })
    return () => {
      vivo = false
    }
  }, [recurso.id, alFallar])

  return (
    <div className="semana">
      <h2 className="semana__titulo">{recurso.nombre}</h2>

      {!horarios && <Esqueleto alto={56} cantidad={7} />}

      {horarios && (
        <ul className="semana__dias">
          {DIAS_LARGOS.map((nombre, dia) => {
            const franjas = horarios.filter((h) => h.dia_semana === dia)
            return (
              <li key={dia} className="dia">
                <span className="dia__nombre">
                  <span className="dia__largo">{nombre}</span>
                  <span className="dia__corto">{DIAS_CORTOS[dia]}</span>
                </span>

                <div className="dia__franjas">
                  {franjas.length === 0 && <span className="dia__cerrado">no atiende</span>}
                  {franjas.map((f) => (
                    <span key={f.id} className="franja tabular">
                      {f.desde.slice(0, 5)} a {f.hasta.slice(0, 5)}
                      <BotonConfirmar
                        etiqueta="✕"
                        etiquetaConfirmar="Sí"
                        className="franja__sacar"
                        ariaLabel={`Sacar ${f.desde.slice(0, 5)} a ${f.hasta.slice(0, 5)} de ${nombre}`}
                        onConfirmar={async () => {
                          try {
                            await borrarHorario(recurso.id, f.id)
                            setHorarios((l) => (l ?? []).filter((x) => x.id !== f.id))
                          } catch (e) {
                            alFallar(e instanceof Error ? e.message : 'No se pudo sacar.')
                          }
                        }}
                      />
                    </span>
                  ))}
                </div>

                <AltaFranja
                  dia={dia}
                  alCrear={async (desde, hasta) => {
                    const h = await crearHorario(recurso.id, { dia_semana: dia, desde, hasta })
                    setHorarios((l) => [...(l ?? []), h])
                    alExito(`Horario agregado el ${nombre.toLowerCase()}.`)
                  }}
                  alFallar={alFallar}
                />
              </li>
            )
          })}
        </ul>
      )}

      <section className="excepciones">
        <h3>Días que no viene</h3>
        {!excepciones && <Esqueleto alto={44} cantidad={2} />}
        {excepciones && excepciones.length === 0 && (
          <p className="excepciones__vacio">Sin ausencias cargadas. Vacaciones y congresos van acá.</p>
        )}
        {excepciones && excepciones.length > 0 && (
          <ul className="excepciones__lista">
            {excepciones.map((e) => (
              <li key={e.id} className="excepciones__item">
                <span className="tabular">
                  {e.desde.slice(0, 10)} a {e.hasta.slice(0, 10)}
                </span>
                <span className="excepciones__motivo">{e.motivo ?? 'sin motivo'}</span>
                <BotonConfirmar
                  etiqueta="Sacar"
                  etiquetaConfirmar="Sí, sacar"
                  className="boton boton--fantasma"
                  onConfirmar={async () => {
                    try {
                      await borrarExcepcion(recurso.id, e.id)
                      setExcepciones((l) => (l ?? []).filter((x) => x.id !== e.id))
                    } catch (err) {
                      alFallar(err instanceof Error ? err.message : 'No se pudo sacar.')
                    }
                  }}
                />
              </li>
            ))}
          </ul>
        )}

        <AltaExcepcion
          alCrear={async (desde, hasta, motivo) => {
            const e = await crearExcepcion(recurso.id, { desde, hasta, motivo })
            setExcepciones((l) => [...(l ?? []), e])
          }}
          alFallar={alFallar}
        />
      </section>
    </div>
  )
}

function AltaFranja({
  dia,
  alCrear,
  alFallar,
}: {
  dia: number
  alCrear: (desde: string, hasta: string) => Promise<void>
  alFallar: (m: string) => void
}) {
  const [abierta, setAbierta] = useState(false)
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')

  if (!abierta) {
    return (
      <button
        type="button"
        className="boton boton--fantasma dia__disparador"
        onClick={() => setAbierta(true)}
        aria-label={`Agregar horario, ${DIAS_LARGOS[dia]}`}
      >
        + horario
      </button>
    )
  }

  return (
    <form
      className="dia__alta"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!desde || !hasta) return
        try {
          await alCrear(desde, hasta)
          setDesde('')
          setHasta('')
        } catch (err) {
          alFallar(err instanceof Error ? err.message : 'No se pudo agregar la franja.')
        }
      }}
    >
      <input
        type="time"
        className="entrada tabular"
        value={desde}
        onChange={(e) => setDesde(e.target.value)}
        aria-label={`Desde, ${DIAS_LARGOS[dia]}`}
        autoFocus
      />
      <input
        type="time"
        className="entrada tabular"
        value={hasta}
        onChange={(e) => setHasta(e.target.value)}
        aria-label={`Hasta, ${DIAS_LARGOS[dia]}`}
      />
      <button type="submit" className="boton boton--primario" disabled={!desde || !hasta}>
        Agregar
      </button>
      <button type="button" className="boton boton--fantasma" onClick={() => setAbierta(false)}>
        Cancelar
      </button>
    </form>
  )
}

function AltaExcepcion({
  alCrear,
  alFallar,
}: {
  alCrear: (desde: string, hasta: string, motivo: string | null) => Promise<void>
  alFallar: (m: string) => void
}) {
  const [abierta, setAbierta] = useState(false)
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [motivo, setMotivo] = useState('')

  if (!abierta) {
    return (
      <button type="button" className="boton boton--fantasma disparador" onClick={() => setAbierta(true)}>
        + Cargar ausencia
      </button>
    )
  }

  return (
    <form
      className="excepciones__alta"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!desde || !hasta) return
        try {
          await alCrear(
            new Date(`${desde}T00:00:00`).toISOString(),
            new Date(`${hasta}T23:59:00`).toISOString(),
            motivo.trim() || null,
          )
          setDesde('')
          setHasta('')
          setMotivo('')
        } catch (err) {
          alFallar(err instanceof Error ? err.message : 'No se pudo cargar la ausencia.')
        }
      }}
    >
      <label className="campo">
        <span>Desde</span>
        <input
          type="date"
          className="entrada tabular"
          value={desde}
          onChange={(e) => setDesde(e.target.value)}
          autoFocus
        />
      </label>
      <label className="campo">
        <span>Hasta</span>
        <input
          type="date"
          className="entrada tabular"
          value={hasta}
          onChange={(e) => setHasta(e.target.value)}
        />
      </label>
      <label className="campo excepciones__motivo-campo">
        <span>Motivo</span>
        <input
          className="entrada"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="congreso, vacaciones"
        />
      </label>
      <button type="submit" className="boton boton--primario" disabled={!desde || !hasta}>
        Cargar
      </button>
      <button type="button" className="boton boton--fantasma" onClick={() => setAbierta(false)}>
        Cancelar
      </button>
    </form>
  )
}
