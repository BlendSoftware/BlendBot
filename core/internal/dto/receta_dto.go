package dto

// LineaRecetaInput es una línea de "de qué está hecho este plato".
//
// No lleva unidad: la unidad es del insumo y la receta la hereda. Ofrecer
// elegirla acá reintroduciría el error de conversión que todo el módulo está
// diseñado para hacer imposible.
type LineaRecetaInput struct {
	InsumoID string `json:"insumo_id" binding:"required,uuid"`
	Cantidad int    `json:"cantidad" binding:"required,min=1"`
}

// GuardarRecetaInput reemplaza la receta ENTERA de un plato.
//
// Es reemplazo y no alta/baja por línea porque el dueño edita la receta como
// una unidad ("la hamburguesa lleva esto"). Mandar la lista completa deja al
// servidor con una sola verdad; un diff del lado del panel es una segunda
// implementación de la misma regla, y el día que difiera la receta queda a
// medias.
//
// Una lista vacía deja el plato SIN receta: vuelve a ser ilimitado. NO lo deja
// agotado — apagar un plato porque alguien le vació la receta es el peor
// default posible.
type GuardarRecetaInput struct {
	Items []LineaRecetaInput `json:"items"`
}

// LineaRecetaResponse es una línea de la receta ya resuelta para mostrar: con
// el nombre del insumo y su unidad, para que el editor pueda escribir
// "300 g de carne picada" sin pedir nada más.
type LineaRecetaResponse struct {
	InsumoID     string `json:"insumo_id"`
	InsumoNombre string `json:"insumo_nombre"`
	Unidad       string `json:"unidad"`
	Cantidad     int    `json:"cantidad"`
	// Stock es cuánto hay de ese insumo ahora. Va en la línea para que el
	// editor pueda mostrar de dónde sale el número de porciones sin hacer la
	// cuenta al revés.
	Stock int `json:"stock"`
}

// RecetaResponse es la receta de un plato más lo que se deriva de ella.
//
// Porciones e InsumoLimitante viajan juntos y son la mitigación del riesgo
// principal del cambio: un plato que se apaga solo y no dice por qué es
// indistinguible de un bug, y el dueño lo resuelve apagando la feature entera.
//
// Con la receta vacía, TieneReceta es false y Porciones es nil: el plato es
// ilimitado, no está agotado.
type RecetaResponse struct {
	ServicioID  string                `json:"servicio_id"`
	TieneReceta bool                  `json:"tiene_receta"`
	Items       []LineaRecetaResponse `json:"items"`
	// Porciones es nil cuando el plato no tiene receta. nil NO es cero, igual
	// que en el catálogo: nil es "no lleva cuenta" y 0 es "lleva cuenta y no
	// queda".
	Porciones *int `json:"porciones"`
	// InsumoLimitante y sus números son el nombre y apellido del que apagó el
	// plato. Vacío cuando no hay receta.
	InsumoLimitante string `json:"insumo_limitante"`
	// UnidadLimitante va pegada a los números por el mismo motivo que en
	// model.InsumoLimitante: "quedan 2" no dice nada sin saber si son dos
	// gramos o dos panes. Sin ella el panel tendría que cruzar el nombre
	// contra el listado de insumos —cruce que se rompe con homónimos o con un
	// rename entre lecturas— y sería la misma fragilidad que ya cerramos en el
	// catálogo, sólo que entrando por este endpoint.
	UnidadLimitante string `json:"unidad_limitante"`
	StockLimitante  int    `json:"stock_limitante"`
	PideLaReceta    int    `json:"pide_la_receta"`
}
