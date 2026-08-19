/**
 * Quién está esperando un hueco. La otra mitad del anti-ausentismo: cuando se
 * cancela un turno el core avisa solo al primero de la cola, y esta pantalla es
 * donde alguien la mira, anota a quien llamó por teléfono y saca al que ya no
 * necesita.
 *
 * Lista de filas, no grilla de cards (DESIGN.md). El orden es el de la cola: el
 * de más arriba es el que recibe la próxima oferta.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  anotarEnListaEspera,
  clientePorTelefono,
  crearCliente,
  listarListaEspera,
  listarServicios,
  quitarDeListaEspera,
} from '../api/endpoints'
import { ErrorApi } from '../api/cliente'
import type { AnotadoEnEspera, Servicio } from '../api/tipos'
import { Aviso, Esqueleto, Vacio } from '../componentes/basicos'
import { fechaCorta, nombreVisible, telefonoVisible } from '../dominio/formato'

/** "hoy" / "hace 3 días": cuánto hace que espera, que es lo que decide a quién llamar. */
function desdeCuando(iso: string): string {
  const dias = Math.floor((Date.now() - Date.parse(iso)) / 86400000)
  if (!Number.isFinite(dias) || dias < 0) return fechaCorta(iso.slice(0, 10))
  if (dias === 0) return 'anotado hoy'
  if (dias === 1) return 'anotado ayer'
  if (dias < 30) return `esperando hace ${dias} días`
  return `anotado el ${fechaCorta(iso.slice(0, 10))}`
}

export function ListaEspera() {
  const [cola, setCola] = useState<AnotadoEnEspera[]>([])
  const [servicios, setServicios] = useState<Servicio[]>([])
  const [cargando, setCargando] = useState(true)
  const [problema, setProblema] = useState('')

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const [gente, catalogo] = await Promise.all([listarListaEspera(), listarServicios()])
      setCola(gente)
      setServicios(catalogo)
      setProblema('')
    } catch (e) {
      setProblema(e instanceof Error ? e.message : 'No se pudo traer la lista de espera.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  async function quitar(id: string) {
    const previa = cola
    setCola((c) => c.filter((x) => x.id !== id))
    try {
      await quitarDeListaEspera(id)
    } catch (e) {
      setCola(previa)
      setProblema(e instanceof Error ? e.message : 'No se pudo sacar de la lista.')
    }
  }

  const pendientes = cola.filter((a) => !a.notificado_en).length

  return (
    <section className="espera">
      <header className="encabezado">
        <div>
          <h1>Lista de espera</h1>
          <p className="encabezado__bajada">
            {cola.length === 0
              ? 'Cuando se libere un hueco, acá está a quién llamar.'
              : `${pendientes} esperando que se libere un hueco. Si se cancela un turno, el primero de la lista recibe el aviso solo.`}
          </p>
        </div>
      </header>

      <Aviso texto={problema} alCerrar={() => setProblema('')} />

      <AltaEnEspera
        servicios={servicios}
        alAnotar={(nuevo) => setCola((c) => [...c, nuevo])}
        alFallar={setProblema}
      />

      {cargando && cola.length === 0 && <Esqueleto alto={56} cantidad={3} />}

      {!cargando && cola.length === 0 && (
        <Vacio
          titulo="No hay nadie esperando."
          detalle="Cuando alguien pida un turno y no haya lugar, anotalo acá y el sistema le avisa cuando se libere."
        />
      )}

      {cola.length > 0 && (
        <ul className="espera__lista">
          {cola.map((a) => (
            <li key={a.id} className="espera__fila">
              <div className="espera__quien">
                <span className="espera__nombre">
                  {nombreVisible(a.cliente_nombre, a.cliente_telefono)}
                </span>
                <span className="espera__telefono tabular">
                  {telefonoVisible(a.cliente_telefono)}
                </span>
              </div>

              <div className="espera__que">
                <span className="espera__servicio">{a.servicio_nombre}</span>
                <span className="espera__cuando">
                  {a.notificado_en ? 'ya le ofrecimos un horario' : desdeCuando(a.creado_en)}
                </span>
                {a.nota && <span className="espera__nota">{a.nota}</span>}
              </div>

              <button
                type="button"
                className="boton boton--fantasma espera__quitar"
                onClick={() => void quitar(a.id)}
              >
                Sacar
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * Alta a mano: la señora llamó por teléfono y quiere que la avisen. Con el
 * teléfono alcanza; si no está cargada, se la crea con el nombre que dejó.
 */
function AltaEnEspera({
  servicios,
  alAnotar,
  alFallar,
}: {
  servicios: Servicio[]
  alAnotar: (a: AnotadoEnEspera) => void
  alFallar: (mensaje: string) => void
}) {
  const [telefono, setTelefono] = useState('')
  const [nombre, setNombre] = useState('')
  const [servicioID, setServicioID] = useState('')
  const [nota, setNota] = useState('')
  const [guardando, setGuardando] = useState(false)

  const soloNumeros = telefono.replace(/\D/g, '')
  const listo = soloNumeros.length >= 6 && servicioID !== ''

  async function anotar() {
    setGuardando(true)
    try {
      // Si ya vino alguna vez, es el mismo cliente; si no, se crea con lo que
      // dejó. El teléfono es el identificador: es su WhatsApp.
      let clienteID: string
      try {
        const cliente = await clientePorTelefono(soloNumeros)
        clienteID = cliente.id
      } catch (e) {
        if (!(e instanceof ErrorApi) || e.estado !== 404) throw e
        const creado = await crearCliente({
          telefono: soloNumeros,
          nombre: nombre.trim() || null,
        })
        clienteID = creado.id
      }

      const anotado = await anotarEnListaEspera({
        cliente_id: clienteID,
        servicio_id: servicioID,
        nota: nota.trim() || null,
      })
      alAnotar(anotado)
      setTelefono('')
      setNombre('')
      setNota('')
    } catch (e) {
      alFallar(e instanceof Error ? e.message : 'No se pudo anotar.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form
      className="espera__alta"
      onSubmit={(e) => {
        e.preventDefault()
        if (listo && !guardando) void anotar()
      }}
    >
      <label className="campo espera__campo-tel">
        <span>Teléfono</span>
        <input
          className="entrada"
          value={telefono}
          onChange={(e) => setTelefono(e.target.value)}
          placeholder="2615551234"
        />
      </label>

      <label className="campo espera__campo-nombre">
        <span>Nombre</span>
        <input
          className="entrada"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Si es la primera vez"
        />
      </label>

      <label className="campo espera__campo-servicio">
        <span>Para qué</span>
        <select
          className="entrada"
          value={servicioID}
          onChange={(e) => setServicioID(e.target.value)}
        >
          <option value="">Elegí el servicio</option>
          {servicios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nombre}
            </option>
          ))}
        </select>
      </label>

      <label className="campo espera__campo-nota">
        <span>Nota</span>
        <input
          className="entrada"
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          placeholder="Cualquier horario de mañana"
        />
      </label>

      <button type="submit" className="boton boton--primario" disabled={!listo || guardando}>
        {guardando ? 'Anotando' : 'Anotar'}
      </button>
    </form>
  )
}
