import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorApi, pedir, reiniciarClienteParaTests } from './cliente'
import { guardarSesion, reiniciarSesionParaTests, tokenAcceso } from './sesion'

function json(estado: number, cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'Content-Type': 'application/json' },
  })
}

const TOKENS_NUEVOS = {
  access_token: 'acceso-2',
  refresh_token: 'refresco-2',
  token_type: 'Bearer',
  expires_in: 900,
  usuario: {
    id: 'u1',
    username: 'secretaria',
    rol: 'operador',
    negocio_id: 'n1',
    must_change_password: false,
  },
}

beforeEach(() => {
  window.localStorage.clear()
  reiniciarSesionParaTests()
  reiniciarClienteParaTests()
  vi.restoreAllMocks()
  guardarSesion({ access_token: 'acceso-1', refresh_token: 'refresco-1' })
})

describe('cliente HTTP', () => {
  it('renueva el token una sola vez ante un 401 y repite el pedido', async () => {
    const fetchFalso = vi
      .fn()
      .mockResolvedValueOnce(json(401, { detail: 'Token invalido' }))
      .mockResolvedValueOnce(json(200, TOKENS_NUEVOS))
      .mockResolvedValueOnce(json(200, [{ id: 's1' }]))
    vi.stubGlobal('fetch', fetchFalso)

    const datos = await pedir<{ id: string }[]>('/api/servicios')

    expect(datos).toEqual([{ id: 's1' }])
    expect(fetchFalso).toHaveBeenCalledTimes(3)
    expect(String(fetchFalso.mock.calls[1]?.[0])).toContain('/api/auth/refresh')
    expect(tokenAcceso()).toBe('acceso-2')

    const cabeceras = (fetchFalso.mock.calls[2]?.[1] as RequestInit).headers as Record<string, string>
    expect(cabeceras.Authorization).toBe('Bearer acceso-2')
  })

  it('si la renovación falla cierra la sesión y no reintenta para siempre', async () => {
    const fetchFalso = vi
      .fn()
      .mockResolvedValueOnce(json(401, { detail: 'Token invalido' }))
      .mockResolvedValueOnce(json(401, { detail: 'Refresh invalido' }))
    vi.stubGlobal('fetch', fetchFalso)

    await expect(pedir('/api/servicios')).rejects.toBeInstanceOf(ErrorApi)
    expect(fetchFalso).toHaveBeenCalledTimes(2)
    expect(tokenAcceso()).toBeNull()
  })

  it('renueva una sola vez aunque dos pedidos se caigan juntos', async () => {
    const fetchFalso = vi.fn(async (url: string) => {
      if (String(url).includes('/api/auth/refresh')) return json(200, TOKENS_NUEVOS)
      const cabecera = fetchFalso.mock.calls.length
      return cabecera <= 2 ? json(401, { detail: 'Token invalido' }) : json(200, { ok: true })
    })
    vi.stubGlobal('fetch', fetchFalso)

    await Promise.all([pedir('/api/servicios'), pedir('/api/recursos')])

    const renovaciones = fetchFalso.mock.calls.filter((c) =>
      String(c[0]).includes('/api/auth/refresh'),
    )
    expect(renovaciones).toHaveLength(1)
  })

  it('traduce el 409 de solape a una frase del mostrador', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json(409, { detail: 'el recurso ya esta ocupado en ese horario' })),
    )

    await expect(pedir('/api/compromisos/x/estado', { metodo: 'PATCH' })).rejects.toThrow(
      'Ese horario se acaba de ocupar.',
    )
  })

  it('nunca muestra el texto crudo del core en un conflicto de estado', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json(409, { detail: 'transicion de estado invalida' })),
    )

    await expect(pedir('/api/compromisos/x/estado', { metodo: 'PATCH' })).rejects.toThrow(
      'Alguien lo movió antes que vos. Actualizá la pantalla.',
    )
  })

  it('sin red avisa en criollo', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed to fetch')))

    await expect(pedir('/api/agenda')).rejects.toThrow(/No hay conexión/)
  })

  // Los dos rechazos del cobro llegan con el mismo 409 y significan cosas
  // distintas: "ya está cobrado" y "todavía no se puede cobrar".
  it.each([
    ['el compromiso ya fue cobrado', 'Este turno ya lo cobraron.'],
    ['solo se puede cobrar un compromiso completado', 'Para cobrarlo, primero marcá el turno como terminado.'],
  ])('el 409 %s se lee como una frase del mostrador', async (detalle, frase) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(409, { detail: detalle })))

    await expect(pedir('/api/cobros', { metodo: 'POST' })).rejects.toThrow(frase)
  })

  it('un medio de pago rechazado no muestra el 422', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(422, { detail: 'medio de pago invalido' })))

    await expect(pedir('/api/cobros', { metodo: 'POST' })).rejects.toThrow(
      'Elegí de nuevo con qué te pagaron.',
    )
  })
})
