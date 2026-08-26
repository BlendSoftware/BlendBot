/**
 * Claro u oscuro. DESIGN.md fija el claro para la escena que manda —la tablet
 * en el mostrador a las 9:30 con la luz de la ventana de frente— y anticipa
 * que "la vista de gastronomía nocturna llega en v2 y se resolverá con un modo
 * propio": esto es ese modo.
 *
 * El claro sigue siendo el default: no se adivina desde el sistema operativo,
 * porque la escena de DESIGN.md pesa más que la preferencia del aparato. Lo
 * que el usuario elige a mano manda y sobrevive un F5.
 */

export type Tema = 'claro' | 'oscuro'

const CLAVE = 'copiloto.tema'

function almacen(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function temaGuardado(): Tema {
  try {
    return almacen()?.getItem(CLAVE) === 'oscuro' ? 'oscuro' : 'claro'
  } catch {
    return 'claro'
  }
}

/**
 * Pinta el tema y lo recuerda. El atributo va en el <html>: las variables de
 * tokens.css cuelgan de ahí, así que todo lo que ya usa var(--fondo) y
 * compañía se adapta solo, sin que ningún componente sepa de temas.
 */
export function aplicarTema(tema: Tema): void {
  document.documentElement.dataset.tema = tema
  try {
    almacen()?.setItem(CLAVE, tema)
  } catch {
    /* Sin localStorage el tema vale para esta pestaña y nada más. */
  }
}

/** Sólo para tests: saca la preferencia guardada. */
export function olvidarTemaParaTests(): void {
  try {
    almacen()?.removeItem(CLAVE)
  } catch {
    /* nada que limpiar */
  }
  delete document.documentElement.dataset.tema
}
