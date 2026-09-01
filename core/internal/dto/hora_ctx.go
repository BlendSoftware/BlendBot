package dto

import (
	"context"
	"time"
)

// El huso del negocio viaja en el context.Context del request.
//
// Por qué acá y no como parámetro de cada método de service: los services ya
// reciben `ctx context.Context` como primer argumento, así que esto no cambia
// una sola firma. La alternativa —agregarle `loc *time.Location` a las ~20
// funciones que arman un response— toca todas las interfaces de service y todos
// sus mocks, para transportar un dato que es exactamente lo que un contexto es:
// *request-scoped*. Es el caso de uso que la documentación de `context` nombra
// textualmente.
//
// Lo que NO cambia es la garantía: si nadie puso la location, `LocationDe`
// devuelve nil, `NuevaHora` construye una Hora sin huso, y la serialización
// falla. El contexto es por dónde viaja el dato, no una segunda forma de
// olvidarse de él.

type claveLocation struct{}

// ConLocation deja el huso del negocio en el contexto. Lo llama el middleware
// una vez por request; nadie más debería necesitarlo, salvo los tests.
func ConLocation(ctx context.Context, loc *time.Location) context.Context {
	return context.WithValue(ctx, claveLocation{}, loc)
}

// LocationDe devuelve el huso del request, o nil si no hay.
//
// nil NO se traduce a UTC "por las dudas": eso reintroduciría el bug que todo
// esto elimina. Se propaga tal cual y la Hora que se construya con él va a
// fallar al serializarse, diciendo qué pasó.
func LocationDe(ctx context.Context) *time.Location {
	loc, _ := ctx.Value(claveLocation{}).(*time.Location)
	return loc
}

// HoraDe es el atajo que usan los constructores de response: toma el huso del
// contexto y arma la Hora.
func HoraDe(ctx context.Context, t time.Time) Hora {
	return NuevaHora(t, LocationDe(ctx))
}

// HoraPtrDe es HoraDe para los campos opcionales. nil entra, nil sale.
func HoraPtrDe(ctx context.Context, t *time.Time) *Hora {
	return NuevaHoraPtr(t, LocationDe(ctx))
}
