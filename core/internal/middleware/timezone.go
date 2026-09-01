package middleware

import (
	"context"
	"net/http"
	"time"

	"copiloto/core/internal/apierror"
	"copiloto/core/internal/dto"
	"copiloto/core/internal/model"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog/log"
)

// LocationKey es donde vive el huso del negocio durante el request.
const LocationKey = "tz_negocio"

// LectorDeNegocio es la lectura mínima que hace falta acá. Se declara en el
// consumidor y no se importa el repositorio entero: al middleware no le
// interesan las coberturas ni el hash del token del agente.
type LectorDeNegocio interface {
	Negocio(ctx context.Context, negocioID string) (*model.Negocio, error)
}

// TimezoneDelNegocio resuelve `negocio.timezone` UNA vez por request y lo deja
// en el contexto para que los DTOs construyan sus `dto.Hora`.
//
// Antes esto vivía en `motorGastro.locNegocio`, que leía el negocio de la base
// **cada vez que armaba un response**: un listado de compromisos pagaba una
// consulta extra que no aportaba nada, y sólo los compromisos quedaban
// localizados porque era el único lugar que se acordaba de llamarlo.
//
// Va colgado del grupo `tenant`, después de `RequireNegocio()`, que es quien ya
// garantizó que el token trae negocio. Las rutas de plataforma (`/api/admin/*`)
// NO lo tienen y eso es deliberado: listan negocios de husos distintos, no
// tienen una TZ única, y llevan `HusoDePlataforma()` en su lugar.
func TimezoneDelNegocio(repo LectorDeNegocio) gin.HandlerFunc {
	return func(c *gin.Context) {
		negocioID := NegocioID(c)
		if negocioID == "" {
			// No debería pasar detrás de RequireNegocio, pero si el middleware
			// se cuelga en otro lado el request sigue sin huso y cualquier
			// `dto.Hora` que se intente serializar falla. Eso es exactamente lo
			// que queremos: ruidoso, no un UTC silencioso.
			c.Next()
			return
		}

		neg, err := repo.Negocio(c.Request.Context(), negocioID)
		if err != nil || neg == nil {
			log.Error().Err(err).Str("negocio_id", negocioID).
				Msg("no pude leer el negocio para resolver su timezone")
			c.AbortWithStatusJSON(http.StatusInternalServerError, apierror.New("Error interno"))
			return
		}

		loc, err := time.LoadLocation(neg.Timezone)
		if err != nil {
			// Nunca caer a UTC: sería devolver horas corridas con cara de
			// correctas, que es el bug que todo este cambio elimina. El detalle
			// va al log —el cuerpo de la respuesta no filtra internals, ver el
			// doc de apierror— pero nombra el negocio y el valor, que es lo que
			// necesita quien lo tenga que arreglar.
			log.Error().Err(err).
				Str("negocio_id", negocioID).
				Str("timezone", neg.Timezone).
				Msg("negocio.timezone no es una zona IANA válida")
			c.AbortWithStatusJSON(http.StatusInternalServerError, apierror.New("Error interno"))
			return
		}

		// Dos lugares, un solo dato:
		//  · el contexto de gin, para los handlers;
		//  · el context.Context del request, para los services, que arman los
		//    responses y no conocen a gin. Ver dto/hora_ctx.go.
		c.Set(LocationKey, loc)
		c.Request = c.Request.WithContext(dto.ConLocation(c.Request.Context(), loc))
		c.Next()
	}
}

// HusoDePlataforma pone UTC como huso del request, para `/api/admin/*`.
//
// Esas rutas listan negocios de husos distintos y no tienen una TZ única.
// Rendir cada fila en la suya rompería la lectura de la lista: un negocio dado
// de alta después podría mostrar una hora de pared anterior al de arriba. UTC
// es el único huso neutral entre tenants.
//
// Va como middleware y no como `dto.HoraUTC` en cada constructor por dos
// razones. Una: la decisión queda escrita UNA vez, en el router, al lado del
// `RequireRole(RolAdmin)` que define qué es una ruta de plataforma — que es
// donde alguien la va a buscar. Dos: `ConfigFiscalResponse` sale por dos rutas
// distintas, `/api/negocio/fiscal` (el dueño, huso del negocio) y
// `/api/admin/negocios/:id/fiscal` (plataforma, UTC). Con el huso decidido en
// el constructor haría falta duplicarlo; con el huso en el contexto, el mismo
// constructor sirve para las dos y cada ruta trae el suyo.
//
// La garantía no se afloja: esto PONE un huso, no lo inventa cuando falta. Una
// ruta sin ningún middleware de huso sigue sin location y sigue fallando.
func HusoDePlataforma() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Set(LocationKey, time.UTC)
		c.Request = c.Request.WithContext(dto.ConLocation(c.Request.Context(), time.UTC))
		c.Next()
	}
}

// Location devuelve el huso del negocio del request, o nil si no hay.
//
// nil no es un error a tapar: los handlers se lo pasan a `dto.NuevaHora` tal
// cual y, si de verdad faltaba, la serialización falla nombrando el problema.
// Traducirlo acá a UTC "por las dudas" reintroduciría el bug.
func Location(c *gin.Context) *time.Location {
	loc, _ := c.Value(LocationKey).(*time.Location)
	return loc
}
