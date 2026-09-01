package middleware

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"copiloto/core/internal/model"

	"github.com/gin-gonic/gin"

	_ "time/tzdata"
)

// espia cuenta las lecturas: la razón de existir del middleware es que la
// timezone se resuelva UNA vez por request y no una por response.
type espia struct {
	neg      *model.Negocio
	err      error
	lecturas int
}

func (e *espia) Negocio(_ context.Context, _ string) (*model.Negocio, error) {
	e.lecturas++
	return e.neg, e.err
}

func init() { gin.SetMode(gin.TestMode) }

// correr arma un router con el middleware puesto y claims ya inyectados,
// para no depender de firmar un JWT en cada test.
func correr(t *testing.T, negocioID string, repo LectorDeNegocio, handler gin.HandlerFunc) *httptest.ResponseRecorder {
	t.Helper()
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set(ClaimsKey, &JWTClaims{NegocioID: negocioID, Rol: RolDueno})
		c.Next()
	})
	r.Use(TimezoneDelNegocio(repo))
	r.GET("/x", handler)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/x", nil))
	return w
}

func TestPoneLaTimezoneDelNegocio(t *testing.T) {
	e := &espia{neg: &model.Negocio{ID: "n1", Timezone: "America/Argentina/Buenos_Aires"}}

	var visto *time.Location
	w := correr(t, "n1", e, func(c *gin.Context) {
		visto = Location(c)
		c.Status(http.StatusOK)
	})

	if w.Code != http.StatusOK {
		t.Fatalf("status %d", w.Code)
	}
	if visto == nil {
		t.Fatal("el handler no vio la location")
	}
	if visto.String() != "America/Argentina/Buenos_Aires" {
		t.Errorf("location %q", visto)
	}
}

// El test de la tarea 3.5: el punto del middleware es sacar la consulta por
// response que hacía locNegocio. Si esto vuelve a subir, el middleware perdió
// la mitad de su razón de ser.
func TestUnaSolaLecturaPorRequest(t *testing.T) {
	e := &espia{neg: &model.Negocio{ID: "n1", Timezone: "America/Argentina/Buenos_Aires"}}

	// El handler pide la location muchas veces, como haría al armar un listado
	// de 50 compromisos.
	correr(t, "n1", e, func(c *gin.Context) {
		for i := 0; i < 50; i++ {
			_ = Location(c)
		}
		c.Status(http.StatusOK)
	})

	if e.lecturas != 1 {
		t.Errorf("leyó el negocio %d veces; tenía que ser 1", e.lecturas)
	}
}

// Decisión §4: sin negocio en el contexto no se pone huso y el request sigue.
// No hay fallback a UTC — si un response intentara serializar una dto.Hora,
// falla, que es lo buscado.
func TestSinNegocioNoPoneNadaYSigue(t *testing.T) {
	e := &espia{neg: &model.Negocio{Timezone: "America/Argentina/Buenos_Aires"}}

	var visto *time.Location
	w := correr(t, "", e, func(c *gin.Context) {
		visto = Location(c)
		c.Status(http.StatusOK)
	})

	if w.Code != http.StatusOK {
		t.Fatalf("tenía que dejar pasar el request, status %d", w.Code)
	}
	if visto != nil {
		t.Errorf("no tenía que poner location, puso %v", visto)
	}
	if e.lecturas != 0 {
		t.Errorf("no tenía que leer el negocio, leyó %d veces", e.lecturas)
	}
}

func TestTimezoneInvalidaFallaYNoCaeAUTC(t *testing.T) {
	e := &espia{neg: &model.Negocio{ID: "n1", Timezone: "America/Nunca_Jamas"}}

	llego := false
	w := correr(t, "n1", e, func(c *gin.Context) {
		llego = true
		c.Status(http.StatusOK)
	})

	if w.Code != http.StatusInternalServerError {
		t.Errorf("status %d; una timezone inválida tiene que cortar el request", w.Code)
	}
	if llego {
		t.Error("el handler se ejecutó igual: habría respondido con horas en un huso equivocado")
	}
}

func TestErrorLeyendoElNegocioCortaElRequest(t *testing.T) {
	e := &espia{err: errors.New("la base se cayó")}

	llego := false
	w := correr(t, "n1", e, func(c *gin.Context) {
		llego = true
		c.Status(http.StatusOK)
	})

	if w.Code != http.StatusInternalServerError {
		t.Errorf("status %d", w.Code)
	}
	if llego {
		t.Error("el handler se ejecutó sin huso resuelto")
	}
}

// El cuerpo no filtra internals (ver el doc del paquete apierror): el detalle
// va al log, no al cliente.
func TestElCuerpoNoFiltraLaTimezoneRota(t *testing.T) {
	e := &espia{neg: &model.Negocio{ID: "n1", Timezone: "America/Nunca_Jamas"}}
	w := correr(t, "n1", e, func(c *gin.Context) { c.Status(http.StatusOK) })

	if cuerpo := w.Body.String(); strings.Contains(cuerpo, "Nunca_Jamas") || strings.Contains(cuerpo, "n1") {
		t.Errorf("el cuerpo filtra detalles internos: %s", cuerpo)
	}
}
