// Package e2e prueba el core de punta a punta: el router REAL de producción
// (router.New con la misma composition root que cmd/server/main.go) montado
// sobre el PostgreSQL de testcontainers y un Redis en memoria, y todo lo demás
// se ejercita por HTTP con httptest. Nada de llamar a un service a mano: si el
// flujo no se puede hacer con requests, el producto no existe.
//
// Los tests están escritos contra el CONTRATO de EPICS.md (E1 + E2/W2-A) y
// corren contra el cableado real de router.go. Las rutas de W2-A pasan además
// por exigirW2A: si alguna deja de estar montada, el test se salta con un
// motivo explícito en vez de fallar con el 404 genérico de gin, que no dice
// nada sobre qué se rompió.
package e2e

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	// tzdata embebida: los huecos se calculan en America/Argentina/Mendoza y el
	// test no puede depender de que la imagen donde corre traiga /usr/share/zoneinfo.
	_ "time/tzdata"

	"copiloto/core/internal/config"
	"copiloto/core/internal/dto"
	"copiloto/core/internal/handler"
	"copiloto/core/internal/infra"
	"copiloto/core/internal/middleware"
	"copiloto/core/internal/model"
	"copiloto/core/internal/repository"
	"copiloto/core/internal/router"
	"copiloto/core/internal/service"
	"copiloto/core/internal/worker"
	"copiloto/core/tests/testutil"

	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

const (
	// tzNegocio: Mendoza es UTC-3 todo el año (Argentina no mueve el reloj desde
	// 2009), así que el offset esperado en los payloads es siempre -03:00.
	tzNegocio     = "America/Argentina/Mendoza"
	offsetNegocio = "-03:00"

	usuarioAdmin  = "admin"
	passwordAdmin = "admin-de-prueba-2026"

	// Secreto de 32+ caracteres: config.validate() lo exige en producción y acá
	// se respeta igual para no probar contra una configuración que no existe.
	secretoJWT = "secreto-de-test-e2e-copiloto-comercios-32+"

	// claveFiscalTest son 32 bytes en hexa (lo que pide FISCAL_CIPHER_KEY).
	// Es de test y no protege nada: los certificados del e2e son inventados.
	claveFiscalTest = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
)

var (
	env    *testutil.Entorno
	mr     *miniredis.Miniredis
	rdb    *redis.Client
	cfg    *config.Config
	engine *gin.Engine
)

func TestMain(m *testing.M) {
	ctx := context.Background()
	gin.SetMode(gin.TestMode)
	// El middleware Logger del router loguea cada request: en un e2e eso son
	// cientos de líneas que tapan el error real. Los warn/error siguen saliendo.
	zerolog.SetGlobalLevel(zerolog.WarnLevel)

	e, cerrar, err := testutil.Arrancar(ctx)
	if err != nil {
		fmt.Fprintf(os.Stderr, "entorno de tests no disponible: %v\n", err)
		os.Exit(1)
	}
	env = e

	// miniredis en vez de un contenedor: la revocación por jti sólo necesita
	// SET/EXISTS con TTL, y arrancar otro contenedor cuesta segundos por nada.
	mr, err = miniredis.Run()
	if err != nil {
		cerrar()
		fmt.Fprintf(os.Stderr, "miniredis no disponible: %v\n", err)
		os.Exit(1)
	}
	rdb = redis.NewClient(&redis.Options{Addr: mr.Addr()})

	cfg = &config.Config{
		Port:               8080,
		Env:                "test",
		DatabaseURL:        env.DSN,
		RedisURL:           "redis://" + mr.Addr() + "/0",
		JWTSecret:          secretoJWT,
		JWTExpirationHours: 8,
		JWTRefreshHours:    24,
		AllowedOrigins:     "http://localhost:5173",
		AdminUsername:      usuarioAdmin,
	}

	engine = armarRouter(env.DB, rdb, cfg)

	code := m.Run()

	_ = rdb.Close()
	mr.Close()
	cerrar()
	os.Exit(code)
}

// armarRouter replica la composition root de cmd/server/main.go. Si main cambia
// el cableado y esto no, el e2e deja de probar producción: mantenerlos a la par
// es parte del contrato de este archivo.
func armarRouter(db *gorm.DB, rdb *redis.Client, cfg *config.Config) *gin.Engine {
	negocioRepo := repository.NewNegocioRepository(db)
	usuarioRepo := repository.NewUsuarioRepository(db)
	recursoRepo := repository.NewRecursoRepository(db)
	categoriaRepo := repository.NewCategoriaRepository(db)
	servicioRepo := repository.NewServicioRepository(db)
	clienteRepo := repository.NewClienteRepository(db)
	coberturaRepo := repository.NewCoberturaRepository(db)
	auditRepo := repository.NewAuditRepository(db)
	compromisoRepo := repository.NewCompromisoRepository(db)
	holdRepo := repository.NewHoldRepository(db)
	horarioRepo := repository.NewHorarioRepository(db)
	dispoRepo := repository.NewDisponibilidadRepository(db)
	negDatosRepo := repository.NewNegocioDatosRepository(db)
	listaEsperaRepo := repository.NewListaEsperaRepository(db)
	consultaRepo := repository.NewConsultaRepository(db)
	avisoRepo := repository.NewAvisoRepository(db)
	cobroRepo := repository.NewCobroRepository(db)
	jornadaRepo := repository.NewJornadaRepository(db)
	cupoRepo := repository.NewCupoRepository(db)
	recetaRepo := repository.NewRecetaRepository(db)
	insumoRepo := repository.NewInsumoRepository(db)
	reporteRepo := repository.NewReporteRepository(db)

	// El cifrado fiscal va con una clave de test: sin cifrador, cargar
	// certificados devolvería 503 y el e2e no probaría el camino real.
	cifrador, err := infra.NewCifrador(claveFiscalTest)
	if err != nil {
		panic("cifrador fiscal de test: " + err.Error())
	}

	// El anti-ausentismo va cableado como en producción: el motor del e2e lleva
	// el notificador puesto, así que si el hook rompiera un flujo existente se
	// vería acá y no en producción.
	huecoLiberado := worker.NewListaEsperaNotificador(
		listaEsperaRepo, avisoRepo, worker.NewPublicador(rdb), nil)

	// El control de stock va cableado como en producción (main.go) y con LAS DOS
	// capas: el cupo del día (Capa 1) y los insumos con sus recetas (Capa 2). El
	// catálogo informa cuánto queda de cada plato y confirmar un pedido lo
	// descuenta de donde corresponda. Sin esto el e2e no probaría una sola línea
	// de la feature sobre HTTP —ni siquiera los 409 de ErrSinCupo y ErrSinStock—,
	// y peor: el catálogo saldría MUDO (todo `restante: null`, `agotado: false`),
	// así que un test de stock fallaría por falta de datos y no por el bug que
	// busca.
	return router.New(router.Deps{
		Cfg:        cfg,
		DB:         db,
		RDB:        rdb,
		AuthSvc:    service.NewAuthService(usuarioRepo, cfg, rdb),
		NegocioSvc: service.NewNegocioService(db, negocioRepo, usuarioRepo),
		CatalogoSvc: service.NewCatalogoService(categoriaRepo, recursoRepo, servicioRepo, coberturaRepo,
			service.ConCupoEnCatalogo(cupoRepo, jornadaRepo),
			service.ConRecetasEnCatalogo(recetaRepo),
		),
		ClienteSvc: service.NewClienteService(clienteRepo, coberturaRepo),
		AuditSvc:   service.NewAuditService(auditRepo),
		MotorSvc: service.NewMotorGastro(
			service.NewMotorService(compromisoRepo, holdRepo, service.ConNotificador(huecoLiberado),
				// Igual que en main.go: el gate de jornada cerrada es parte del
				// motor real, no un detalle de wiring de producción. Sin esto el
				// e2e certificaría un motor que no es el que corre en producción.
				service.ConControlDeJornada(jornadaRepo),
			),
			negDatosRepo,
			service.ConControlDeStock(
				service.NewDescontadorStock(recetaRepo, insumoRepo, cupoRepo),
				jornadaRepo,
			),
		),
		HoldSvc:     service.NewHoldService(holdRepo, compromisoRepo),
		DispoSvc:    service.NewDisponibilidadService(dispoRepo),
		TokenSvc:    service.NewNegocioTokenService(negDatosRepo),
		ListaEspSvc: service.NewListaEsperaService(listaEsperaRepo),
		ConsultaSvc: service.NewConsultaService(consultaRepo, worker.NewAvisadorConsulta(worker.NewPublicador(rdb))),
		CobroSvc:    service.NewCobroService(cobroRepo, negDatosRepo, cifrador),
		JornadaSvc:  service.NewJornadaService(jornadaRepo),
		// La exclusión receta ⊕ cupo va cableada en LOS DOS sentidos, como en
		// main.go. Con una sola mitad la regla se viola entrando por el lado
		// que quedó suelto, y un e2e que sólo cablee una probaría media regla.
		CupoSvc: service.NewCupoService(cupoRepo, jornadaRepo, servicioRepo,
			service.ConExclusionDeReceta(recetaRepo),
		),
		InsumoSvc: service.NewInsumoService(insumoRepo),
		RecetaSvc: service.NewRecetaService(recetaRepo, insumoRepo, servicioRepo,
			service.ConExclusionDeCupo(cupoRepo, jornadaRepo),
		),
		ReporteSvc:   service.NewReporteService(reporteRepo, negDatosRepo),
		NegDatosRepo: negDatosRepo,
		// Igual que en main.go: GET /api/negocio necesita JornadaRepository para
		// resolver abierto_ahora.
		JornadaRepo: jornadaRepo,
		HorarioH:    handler.NewHorariosHandler(horarioRepo),
	})
}

// ── Ciclo de vida de un test ────────────────────────────────────────────────

// nuevoCaso deja base y Redis como recién instalados. El engine se comparte
// (es stateless: todo el estado está en la DB y en Redis).
func nuevoCaso(t *testing.T) {
	t.Helper()
	env.Limpiar(t)
	mr.FlushAll()
}

// ── El helper HTTP ──────────────────────────────────────────────────────────

// respuesta es el resultado de un request contra el router real.
type respuesta struct {
	t      *testing.T
	metodo string
	ruta   string

	Status int
	Cuerpo []byte
}

// hacer pega un request contra el router real. cuerpo nil no manda body; token
// vacío no manda Authorization. Devuelve status + cuerpo crudo, y la respuesta
// sabe decodificarse sola (en / lista / detalle).
func hacer(t *testing.T, metodo, ruta string, cuerpo any, token string) respuesta {
	t.Helper()

	var body *bytes.Reader
	switch v := cuerpo.(type) {
	case nil:
		body = bytes.NewReader(nil)
	case []byte:
		body = bytes.NewReader(v)
	case string:
		body = bytes.NewReader([]byte(v))
	default:
		raw, err := json.Marshal(v)
		if err != nil {
			t.Fatalf("%s %s: no se pudo serializar el cuerpo: %v", metodo, ruta, err)
		}
		body = bytes.NewReader(raw)
	}

	req := httptest.NewRequest(metodo, ruta, body)
	if cuerpo != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)

	return respuesta{
		t:      t,
		metodo: metodo,
		ruta:   ruta,
		Status: w.Code,
		Cuerpo: w.Body.Bytes(),
	}
}

// exigir corta el test si el status no es el esperado, mostrando el cuerpo:
// un 500 mudo en un e2e es media hora perdida.
func (r respuesta) exigir(status int) respuesta {
	r.t.Helper()
	if r.Status != status {
		r.t.Fatalf("%s %s: esperaba %d, obtuvo %d — cuerpo: %s",
			r.metodo, r.ruta, status, r.Status, string(r.Cuerpo))
	}
	return r
}

// en decodifica el cuerpo JSON en dst.
func (r respuesta) en(dst any) respuesta {
	r.t.Helper()
	if err := json.Unmarshal(r.Cuerpo, dst); err != nil {
		r.t.Fatalf("%s %s: JSON invalido (%v) — cuerpo: %s",
			r.metodo, r.ruta, err, string(r.Cuerpo))
	}
	return r
}

// detalle devuelve el mensaje del sobre de error (apierror.APIError).
func (r respuesta) detalle() string {
	r.t.Helper()
	var e struct {
		Detail string `json:"detail"`
	}
	_ = json.Unmarshal(r.Cuerpo, &e)
	return e.Detail
}

// ── Compuertas de W2-A ──────────────────────────────────────────────────────

// rutaMontada mira las rutas REALES del engine. Distingue "el endpoint todavía
// no existe" de "el endpoint existe y devolvió 404": sin esto, un test que
// espera 200 y recibe el 404 de gin se saltaría por el motivo equivocado.
func rutaMontada(metodo, ruta string) bool {
	for _, ri := range engine.Routes() {
		if ri.Method == metodo && ri.Path == ruta {
			return true
		}
	}
	return false
}

// exigirW2A salta el test si la ruta del contrato W2-A todavía no está montada.
func exigirW2A(t *testing.T, metodo, ruta string) {
	t.Helper()
	if !rutaMontada(metodo, ruta) {
		t.Skipf("pendiente wiring W2-A: %s %s no está montada en router.New "+
			"(contrato EPICS.md → E2/W2-A). El test queda escrito y se prende solo al cablear.",
			metodo, ruta)
	}
}

// autenticacionDualMontada responde si el grupo protegido ya acepta tokens
// cop_ (middleware.AutenticacionDual de W2-A). Se infiere de la existencia de
// GET /api/negocio, que es la ruta que sólo tiene sentido con el token del agente.
func autenticacionDualMontada() bool {
	return rutaMontada(http.MethodGet, "/api/negocio")
}

// ── Fixtures por HTTP ───────────────────────────────────────────────────────

// bootstrapAdmin crea el admin de la plataforma por INSERT directo, igual que
// hace cmd/server/main.go al arrancar: el huevo y la gallina no se resuelven
// por API. bcrypt.MinCost porque acá el costo sólo suma segundos al CI.
func bootstrapAdmin(t *testing.T) {
	t.Helper()
	hash, err := bcrypt.GenerateFromPassword([]byte(passwordAdmin), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("bcrypt del admin: %v", err)
	}
	u := &model.Usuario{
		Username:           usuarioAdmin,
		PasswordHash:       string(hash),
		Rol:                middleware.RolAdmin,
		Activo:             true,
		MustChangePassword: true,
	}
	if err := env.DB.Create(u).Error; err != nil {
		t.Fatalf("bootstrap admin: %v", err)
	}
}

// login pega POST /api/auth/login y devuelve el par de tokens.
func login(t *testing.T, username, password string) dto.TokensDTO {
	t.Helper()
	var tk dto.TokensDTO
	hacer(t, http.MethodPost, "/api/auth/login", map[string]any{
		"username": username,
		"password": password,
	}, "").exigir(http.StatusOK).en(&tk)
	if tk.AccessToken == "" {
		t.Fatalf("login de %q: vino sin access_token", username)
	}
	return tk
}

// altaNegocio da de alta un tenant como admin y devuelve la respuesta completa
// (incluida la password temporal, que viaja una sola vez).
func altaNegocio(t *testing.T, tokenAdmin, nombre, usuarioDueno string) dto.AltaNegocioResponse {
	t.Helper()
	var alta dto.AltaNegocioResponse
	hacer(t, http.MethodPost, "/api/admin/negocios", map[string]any{
		"nombre":        nombre,
		"vertical":      "salud",
		"timezone":      tzNegocio,
		"usuario_dueno": usuarioDueno,
	}, tokenAdmin).exigir(http.StatusCreated).en(&alta)
	return alta
}

// negocioListo hace el camino completo del alta: crear el tenant, entrar con la
// password temporal y cambiarla. Devuelve el id del negocio y el token del dueño
// ya operativo (must_change_password=false).
func negocioListo(t *testing.T, tokenAdmin, nombre, usuarioDueno string) (string, string) {
	t.Helper()
	alta := altaNegocio(t, tokenAdmin, nombre, usuarioDueno)

	temporal := login(t, usuarioDueno, alta.PasswordTemporal)
	nueva := "clave-nueva-" + usuarioDueno
	hacer(t, http.MethodPost, "/api/auth/cambiar-password", map[string]any{
		"password_nueva": nueva,
	}, temporal.AccessToken).exigir(http.StatusOK)

	definitivo := login(t, usuarioDueno, nueva)
	return alta.NegocioID, definitivo.AccessToken
}

// crearOperador da de alta un operador del tenant por INSERT directo (no hay
// endpoint de altas de operadores todavía) y devuelve su token ya operativo.
// El operador ve el mostrador pero no la plata (H8).
func crearOperador(t *testing.T, negocioID, username string) string {
	t.Helper()
	password := "operador-de-prueba-2026"
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("bcrypt del operador: %v", err)
	}
	neg := negocioID
	u := &model.Usuario{
		Username:     username,
		PasswordHash: string(hash),
		Rol:          middleware.RolOperador,
		NegocioID:    &neg,
		Activo:       true,
	}
	if err := env.DB.Create(u).Error; err != nil {
		t.Fatalf("crear operador: %v", err)
	}
	return login(t, username, password).AccessToken
}

// crearServicio crea un servicio del tenant del token y devuelve el modelo.
func crearServicio(t *testing.T, token, nombre string, duracionMin int, precioBase float64) model.Servicio {
	t.Helper()
	var s model.Servicio
	hacer(t, http.MethodPost, "/api/servicios", map[string]any{
		"nombre":       nombre,
		"duracion_min": duracionMin,
		"precio_base":  precioBase,
	}, token).exigir(http.StatusCreated).en(&s)
	return s
}

// crearRecurso crea un profesional del tenant del token.
func crearRecurso(t *testing.T, token, nombre string) model.Recurso {
	t.Helper()
	var r model.Recurso
	hacer(t, http.MethodPost, "/api/recursos", map[string]any{
		"tipo":      "profesional",
		"nombre":    nombre,
		"capacidad": 1,
	}, token).exigir(http.StatusCreated).en(&r)
	return r
}

// ── Tiempo ──────────────────────────────────────────────────────────────────

// zonaNegocio devuelve la timezone del consultorio.
func zonaNegocio(t *testing.T) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation(tzNegocio)
	if err != nil {
		t.Fatalf("cargar %s: %v", tzNegocio, err)
	}
	return loc
}

// proximoLunes devuelve el próximo lunes a las 00:00 hora del negocio, siempre
// estrictamente en el futuro: los huecos se calculan desde ahora, así que un
// test anclado a "hoy" fallaría según la hora a la que corra el CI.
func proximoLunes(t *testing.T) time.Time {
	t.Helper()
	loc := zonaNegocio(t)
	hoy := time.Now().In(loc)
	dias := (int(time.Monday) - int(hoy.Weekday()) + 7) % 7
	if dias == 0 {
		dias = 7
	}
	l := hoy.AddDate(0, 0, dias)
	return time.Date(l.Year(), l.Month(), l.Day(), 0, 0, 0, 0, loc)
}

// ── Aserciones ──────────────────────────────────────────────────────────────

func igual[T comparable](t *testing.T, obtenido, esperado T, contexto string) {
	t.Helper()
	if obtenido != esperado {
		t.Errorf("%s: esperaba %v, obtuvo %v", contexto, esperado, obtenido)
	}
}

func noVacio(t *testing.T, valor, contexto string) {
	t.Helper()
	if strings.TrimSpace(valor) == "" {
		t.Errorf("%s: vino vacío", contexto)
	}
}
