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
import { Aviso, Esqueleto, Vacio, useAvisoBien } from '../componentes/basicos'
import { useSesion } from '../contexto'

const SIN_CATEGORIA = 'sin-categoria'

export function Catalogo() {
  const { negocio } = useSesion()
  const gastro = negocio?.vertical === 'gastronomia'
  const [servicios, setServicios] = useState<Servicio[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [coberturas, setCoberturas] = useState<Cobertura[]>([])
  const [cargando, setCargando] = useState(true)
  const [problema, setProblema] = useState('')
  const [abierta, setAbierta] = useState<string | null>(null)
  const [nuevaCategoria, setNuevaCategoria] = useState('')
  const [bien, mostrarBien] = useAvisoBien()

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
      lista.push({ id: SIN_CATEGORIA, nombre: gastro ? 'Sin sección' : 'Sin categoría', servicios: sueltos })
    }
    return lista
  }, [categorias, servicios, gastro])

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
      mostrarBien(`${c.nombre} agregada.`)
    } catch (e) {
      setProblema(e instanceof Error ? e.message : 'No se pudo crear la categoría.')
    }
  }

  return (
    <section className="catalogo">
      <header className="encabezado">
        <div>
          <h1>{gastro ? 'Carta' : 'Catálogo'}</h1>
          <p className="encabezado__bajada">
            Lo que está apagado, el asistente no lo ofrece. Ese es todo el truco.
          </p>
        </div>
      </header>

      <Aviso texto={problema} alCerrar={() => setProblema('')} />
      <Aviso texto={bien} tono="bien" />

      {cargando && <Esqueleto alto={72} cantidad={5} />}

      {!cargando && servicios.length === 0 && categorias.length === 0 && (
        <Vacio
          titulo={gastro ? 'La carta está vacía todavía.' : 'El catálogo está vacío todavía.'}
          detalle={
            gastro
              ? 'Empezá por una sección (Entradas, Principales, Postres) y después cargá los platos de cada una.'
              : 'Empezá por una categoría (Consultas, Estudios, Prácticas) y después cargá lo que se hace en cada una.'
          }
        />
      )}

      {!cargando &&
        grupos.map((g) => (
          <section key={g.id} className="grupo">
            <div className="grupo__cabeza">
              <h2 className="grupo__titulo">{g.nombre}</h2>
              <span className="grupo__cuenta">
                {gastro
                  ? g.servicios.length === 1
                    ? '1 plato'
                    : `${g.servicios.length} platos`
                  : g.servicios.length === 1
                    ? '1 servicio'
                    : `${g.servicios.length} servicios`}
              </span>
            </div>

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
                    alExito={mostrarBien}
                  />
                </FilaServicio>
              ))}
            </ul>

            <AltaServicio
              gastro={gastro}
              categoriaID={g.id === SIN_CATEGORIA ? null : g.id}
              alCrear={(s) => {
                setServicios((l) => [...l, s])
                mostrarBien(`${s.nombre} agregado.`)
              }}
              alFallar={setProblema}
            />
          </section>
        ))}

      {!cargando && (
        <NuevaCategoria
          gastro={gastro}
          valor={nuevaCategoria}
          alCambiar={setNuevaCategoria}
          alAgregar={agregarCategoria}
        />
      )}
    </section>
  )
}

function NuevaCategoria({
  gastro,
  valor,
  alCambiar,
  alAgregar,
}: {
  gastro: boolean
  valor: string
  alCambiar: (v: string) => void
  alAgregar: () => void
}) {
  const [abierta, setAbierta] = useState(false)

  if (!abierta) {
    return (
      <button type="button" className="boton disparador" onClick={() => setAbierta(true)}>
        {gastro ? '+ Nueva sección' : '+ Nueva categoría'}
      </button>
    )
  }

  return (
    <form
      className="catalogo__nueva-categoria"
      onSubmit={(e) => {
        e.preventDefault()
        alAgregar()
        setAbierta(false)
      }}
    >
      <label className="campo">
        <span>{gastro ? 'Sección nueva' : 'Categoría nueva'}</span>
        <input
          className="entrada"
          value={valor}
          onChange={(e) => alCambiar(e.target.value)}
          placeholder={gastro ? 'Entradas' : 'Estudios'}
          autoFocus
        />
      </label>
      <button type="submit" className="boton boton--primario" disabled={!valor.trim()}>
        {gastro ? 'Agregar sección' : 'Agregar categoría'}
      </button>
      <button type="button" className="boton boton--fantasma" onClick={() => setAbierta(false)}>
        Cancelar
      </button>
    </form>
  )
}

function AltaServicio({
  gastro,
  categoriaID,
  alCrear,
  alFallar,
}: {
  gastro: boolean
  categoriaID: string | null
  alCrear: (s: Servicio) => void
  alFallar: (m: string) => void
}) {
  const [abierta, setAbierta] = useState(false)
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

  if (!abierta) {
    return (
      <button type="button" className="boton boton--fantasma disparador" onClick={() => setAbierta(true)}>
        {gastro ? '+ Agregar plato' : '+ Agregar servicio'}
      </button>
    )
  }

  return (
    <form className="alta-servicio" onSubmit={crear}>
      <input
        className="entrada"
        placeholder={gastro ? 'Nombre del plato' : 'Nombre del servicio'}
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        aria-label={gastro ? 'Nombre del plato nuevo' : 'Nombre del servicio nuevo'}
        autoFocus
      />
      <input
        className="entrada tabular alta-servicio__precio"
        placeholder="precio"
        inputMode="decimal"
        value={precio}
        onChange={(e) => setPrecio(e.target.value.replace(/[^\d.,]/g, '').replace(',', '.'))}
        aria-label="Precio"
      />
      {/* La duración es de un turno; un plato no la tiene. */}
      {!gastro && (
        <input
          className="entrada tabular alta-servicio__duracion"
          placeholder="min"
          inputMode="numeric"
          value={duracion}
          onChange={(e) => setDuracion(e.target.value.replace(/\D/g, ''))}
          aria-label="Duración en minutos"
        />
      )}
      <button type="submit" className="boton boton--primario" disabled={!nombre.trim() || guardando}>
        {guardando ? 'Agregando' : 'Agregar'}
      </button>
      <button type="button" className="boton boton--fantasma" onClick={() => setAbierta(false)}>
        Cancelar
      </button>
    </form>
  )
}

function PreciosPorCobertura({
  servicioID,
  coberturas,
  alFallar,
  alExito,
}: {
  servicioID: string
  coberturas: Cobertura[]
  alFallar: (m: string) => void
  alExito: (m: string) => void
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
              alExito(`Precio de ${c.nombre} actualizado.`)
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
