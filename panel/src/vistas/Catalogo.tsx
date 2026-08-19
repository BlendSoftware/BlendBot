/**
 * La pantalla más aburrida y la más importante: acá se apaga lo que no hay y
 * el agente deja de ofrecerlo en el mismo segundo. Lista de filas, no grilla
 * de cards, y todo se edita en el lugar: ningún modal.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  actualizarServicio,
  crearCategoria,
  crearServicio,
  fijarPrecio,
  listarCategorias,
  listarCoberturas,
  listarPrecios,
  listarServicios,
  setDisponible,
} from '../api/endpoints'
import type { Categoria, Cobertura, PrecioCobertura, Servicio } from '../api/tipos'
import { FilaServicio } from '../componentes/FilaServicio'
import { Aviso, Esqueleto, Vacio } from '../componentes/basicos'

const SIN_CATEGORIA = 'sin-categoria'

export function Catalogo() {
  const [servicios, setServicios] = useState<Servicio[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [coberturas, setCoberturas] = useState<Cobertura[]>([])
  const [cargando, setCargando] = useState(true)
  const [problema, setProblema] = useState('')
  const [abierta, setAbierta] = useState<string | null>(null)
  const [nuevaCategoria, setNuevaCategoria] = useState('')

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const [s, c, ob] = await Promise.all([
        listarServicios({ incluirInactivos: false }),
        listarCategorias(),
        listarCoberturas(),
      ])
      setServicios(s)
      setCategorias(c)
      setCoberturas(ob)
      setProblema('')
    } catch (e) {
      setProblema(e instanceof Error ? e.message : 'No se pudo traer el catálogo.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const grupos = useMemo(() => {
    const ordenadas = [...categorias].sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre))
    const lista = ordenadas.map((c) => ({
      id: c.id,
      nombre: c.nombre,
      servicios: servicios.filter((s) => s.categoria_id === c.id),
    }))
    const sueltos = servicios.filter((s) => !s.categoria_id || !categorias.some((c) => c.id === s.categoria_id))
    if (sueltos.length > 0) {
      lista.push({ id: SIN_CATEGORIA, nombre: 'Sin categoría', servicios: sueltos })
    }
    return lista
  }, [categorias, servicios])

  function reemplazar(s: Servicio) {
    setServicios((lista) => lista.map((x) => (x.id === s.id ? s : x)))
  }

  async function prender(id: string, valor: boolean) {
    await setDisponible(id, valor)
    setServicios((lista) => lista.map((s) => (s.id === id ? { ...s, disponible: valor } : s)))
  }

  async function agregarCategoria() {
    const nombre = nuevaCategoria.trim()
    if (!nombre) return
    try {
      const c = await crearCategoria(nombre, categorias.length)
      setCategorias((l) => [...l, c])
      setNuevaCategoria('')
    } catch (e) {
      setProblema(e instanceof Error ? e.message : 'No se pudo crear la categoría.')
    }
  }

  return (
    <section className="catalogo">
      <header className="encabezado">
        <div>
          <h1>Catálogo</h1>
          <p className="encabezado__bajada">
            Lo que está apagado, el asistente no lo ofrece. Ese es todo el truco.
          </p>
        </div>
      </header>

      <Aviso texto={problema} alCerrar={() => setProblema('')} />

      {cargando && <Esqueleto alto={72} cantidad={5} />}

      {!cargando && servicios.length === 0 && categorias.length === 0 && (
        <Vacio
          titulo="El catálogo está vacío todavía."
          detalle="Empezá por una categoría (Consultas, Estudios, Prácticas) y después cargá lo que se hace en cada una."
        />
      )}

      {!cargando &&
        grupos.map((g) => (
          <section key={g.id} className="grupo">
            <h2 className="grupo__titulo">{g.nombre}</h2>

            <ul className="grupo__lista">
              {g.servicios.map((s) => (
                <FilaServicio
                  key={s.id}
                  servicio={s}
                  alCambiarDisponible={(v) => prender(s.id, v)}
                  alGuardar={async (cambios) => {
                    const actualizado = await actualizarServicio(s.id, cambios)
                    reemplazar(actualizado)
                  }}
                  alFallar={setProblema}
                  expandida={abierta === s.id}
                  alExpandir={() => setAbierta(abierta === s.id ? null : s.id)}
                >
                  <PreciosPorCobertura
                    servicioID={s.id}
                    coberturas={coberturas}
                    alFallar={setProblema}
                  />
                </FilaServicio>
              ))}

              <li className="grupo__alta">
                <AltaServicio
                  categoriaID={g.id === SIN_CATEGORIA ? null : g.id}
                  alCrear={(s) => setServicios((l) => [...l, s])}
                  alFallar={setProblema}
                />
              </li>
            </ul>
          </section>
        ))}

      {!cargando && (
        <form
          className="catalogo__nueva-categoria"
          onSubmit={(e) => {
            e.preventDefault()
            void agregarCategoria()
          }}
        >
          <label className="campo">
            <span>Categoría nueva</span>
            <input
              className="entrada"
              value={nuevaCategoria}
              onChange={(e) => setNuevaCategoria(e.target.value)}
              placeholder="Estudios"
            />
          </label>
          <button type="submit" className="boton" disabled={!nuevaCategoria.trim()}>
            Agregar categoría
          </button>
        </form>
      )}
    </section>
  )
}

function AltaServicio({
  categoriaID,
  alCrear,
  alFallar,
}: {
  categoriaID: string | null
  alCrear: (s: Servicio) => void
  alFallar: (m: string) => void
}) {
  const [nombre, setNombre] = useState('')
  const [precio, setPrecio] = useState('')
  const [duracion, setDuracion] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function crear(e: React.FormEvent) {
    e.preventDefault()
    if (!nombre.trim()) return
    setGuardando(true)
    try {
      const s = await crearServicio({
        nombre: nombre.trim(),
        categoria_id: categoriaID,
        precio_base: precio || '0',
        duracion_min: duracion ? Number(duracion) : null,
      })
      alCrear(s)
      setNombre('')
      setPrecio('')
      setDuracion('')
    } catch (err) {
      alFallar(err instanceof Error ? err.message : 'No se pudo agregar.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form className="alta-servicio" onSubmit={crear}>
      <input
        className="entrada"
        placeholder="Agregar algo nuevo"
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        aria-label="Nombre del servicio nuevo"
      />
      <input
        className="entrada tabular alta-servicio__precio"
        placeholder="precio"
        inputMode="decimal"
        value={precio}
        onChange={(e) => setPrecio(e.target.value.replace(/[^\d.,]/g, '').replace(',', '.'))}
        aria-label="Precio"
      />
      <input
        className="entrada tabular alta-servicio__duracion"
        placeholder="min"
        inputMode="numeric"
        value={duracion}
        onChange={(e) => setDuracion(e.target.value.replace(/\D/g, ''))}
        aria-label="Duración en minutos"
      />
      <button type="submit" className="boton" disabled={!nombre.trim() || guardando}>
        {guardando ? 'Agregando' : 'Agregar'}
      </button>
    </form>
  )
}

function PreciosPorCobertura({
  servicioID,
  coberturas,
  alFallar,
}: {
  servicioID: string
  coberturas: Cobertura[]
  alFallar: (m: string) => void
}) {
  const [precios, setPrecios] = useState<PrecioCobertura[] | null>(null)

  useEffect(() => {
    let vivo = true
    listarPrecios(servicioID)
      .then((p) => {
        if (vivo) setPrecios(p)
      })
      .catch((e: unknown) => {
        if (vivo) alFallar(e instanceof Error ? e.message : 'No se pudieron traer los precios.')
      })
    return () => {
      vivo = false
    }
  }, [servicioID, alFallar])

  if (coberturas.length === 0) {
    return (
      <p className="precios__vacio">
        Todavía no hay obras sociales cargadas. Mientras tanto vale el precio de lista.
      </p>
    )
  }

  if (!precios) return <Esqueleto alto={44} cantidad={2} />

  return (
    <ul className="precios">
      {coberturas.map((c) => {
        const actual = precios.find((p) => p.cobertura_id === c.id)
        return (
          <PrecioFila
            key={c.id}
            cobertura={c}
            valor={actual?.precio ?? ''}
            alGuardar={async (precio) => {
              const guardado = await fijarPrecio(servicioID, { cobertura_id: c.id, precio })
              setPrecios((l) => [
                ...(l ?? []).filter((p) => p.cobertura_id !== c.id),
                guardado,
              ])
            }}
            alFallar={alFallar}
          />
        )
      })}
    </ul>
  )
}

function PrecioFila({
  cobertura,
  valor,
  alGuardar,
  alFallar,
}: {
  cobertura: Cobertura
  valor: string
  alGuardar: (precio: string) => Promise<void>
  alFallar: (m: string) => void
}) {
  const [texto, setTexto] = useState(valor)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => setTexto(valor), [valor])

  return (
    <li className="precios__fila">
      <span className="precios__nombre">{cobertura.nombre}</span>
      <input
        className="entrada tabular precios__entrada"
        inputMode="decimal"
        value={texto}
        onChange={(e) => setTexto(e.target.value.replace(/[^\d.,]/g, '').replace(',', '.'))}
        aria-label={`Precio para ${cobertura.nombre}`}
      />
      <button
        type="button"
        className="boton"
        disabled={guardando || texto === valor || texto === ''}
        onClick={async () => {
          setGuardando(true)
          try {
            await alGuardar(texto)
          } catch (e) {
            alFallar(e instanceof Error ? e.message : 'No se pudo guardar el precio.')
          } finally {
            setGuardando(false)
          }
        }}
      >
        Guardar
      </button>
    </li>
  )
}
