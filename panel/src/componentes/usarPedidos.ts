/**
 * La carga del tablero de cocina, compartida por Pedidos y Comanda: los pedidos
 * vivos del negocio y la carta para ponerles nombre a los ítems. Se refresca
 * sola, como la agenda: nadie tiene que apretar nada.
 *
 * El estado de un pedido se pinta optimista (cambia de columna ya) y el core
 * confirma después; si rechaza, la tarjeta vuelve a donde estaba.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listarCompromisos, listarServicios, transicionar } from '../api/endpoints'
import type { Compromiso, Estado, Servicio } from '../api/tipos'
import { hoyISO } from '../dominio/formato'
import { aVista, type PedidoVista } from '../dominio/pedidos'

const REFRESCO_MS = 15000
/** Los que están en juego: van sin filtro de fecha porque un pedido de anoche
 *  sin confirmar tiene que seguir a la vista. */
const ESTADOS_TABLERO: Estado[] = ['pendiente', 'confirmado', 'en_curso', 'listo']

export interface Tablero {
  pedidos: PedidoVista[]
  cargando: boolean
  problema: string
  limpiarProblema: () => void
  mover: (id: string, estado: Estado, extra?: { demora_min?: number }) => Promise<void>
}

export function usarPedidos(ahora: () => Date = () => new Date()): Tablero {
  const [compromisos, setCompromisos] = useState<Compromiso[] | null>(null)
  const [servicios, setServicios] = useState<Servicio[]>([])
  const [cargando, setCargando] = useState(true)
  const [problema, setProblema] = useState('')
  const montado = useRef(true)

  useEffect(() => {
    montado.current = true
    return () => {
      montado.current = false
    }
  }, [])

  const cargar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCargando(true)
    try {
      // Los entregados van en una consulta aparte y acotados a hoy: son la
      // columna "Para cobrar", y sin el corte por fecha arrastrarían todo el
      // histórico del negocio al tablero.
      const [lista, entregados, carta] = await Promise.all([
        listarCompromisos({ estados: ESTADOS_TABLERO }),
        listarCompromisos({ estados: ['completado'], desde: hoyISO() }),
        listarServicios({ incluirInactivos: true }),
      ])
      if (!montado.current) return
      setCompromisos([...lista, ...entregados].filter((c) => c.tipo === 'pedido'))
      setServicios(carta)
      setProblema('')
    } catch (e) {
      if (!montado.current) return
      if (!silencioso) setProblema(e instanceof Error ? e.message : 'No se pudieron traer los pedidos.')
    } finally {
      if (montado.current) setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  useEffect(() => {
    const id = window.setInterval(() => {
      if (!document.hidden) void cargar(true)
    }, REFRESCO_MS)
    return () => window.clearInterval(id)
  }, [cargar])

  const nombreDeServicio = useMemo(() => {
    const mapa = new Map(servicios.map((s) => [s.id, s.nombre]))
    return (id: string) => mapa.get(id) ?? 'Ítem'
  }, [servicios])

  const pedidos = useMemo(
    () => (compromisos ?? []).map((c) => aVista(c, nombreDeServicio)),
    [compromisos, nombreDeServicio],
  )

  async function mover(id: string, estado: Estado, extra?: { demora_min?: number }) {
    const previo = compromisos
    setCompromisos((lista) =>
      lista
        ? lista.map((c) =>
            c.id === id
              ? {
                  ...c,
                  estado,
                  // Al confirmar con demora, arrancá el contador ya: el core
                  // sella confirmado_en, pero la tarjeta no espera a saberlo.
                  ...(extra?.demora_min != null
                    ? { demora_min: extra.demora_min, confirmado_en: c.confirmado_en ?? ahora().toISOString() }
                    : {}),
                }
              : c,
          )
        : lista,
    )
    try {
      await transicionar(id, { estado, ...extra })
      void cargar(true)
    } catch (e) {
      if (montado.current) setCompromisos(previo)
      throw e
    }
  }

  return { pedidos, cargando, problema, limpiarProblema: () => setProblema(''), mover }
}
