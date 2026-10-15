package service

import (
	"context"
	"errors"
	"testing"

	"copiloto/core/internal/model"

	"gorm.io/datatypes"
)

// fakeNegociosConfig resuelve siempre el mismo negocio, con la config cruda
// que se le pase (para probar el override de cantidad_maxima_por_linea).
type fakeNegociosConfig struct{ configJSON string }

func (f *fakeNegociosConfig) Negocio(ctx context.Context, negocioID string) (*model.Negocio, error) {
	return &model.Negocio{
		ID:     negocioID,
		Config: datatypes.JSON([]byte(f.configJSON)),
	}, nil
}

// ── Pieza B: tope de cantidad por línea ────────────────────────────────────
//
// Reusa los fakes y helpers (fakeCompromisoRepo, servicioFake,
// inputPedidoWhatsApp) definidos en motor_service_test.go — mismo paquete.

// TestCrearPedidoWhatsAppCantidadDentroDelLimite: una cantidad razonable (bajo
// el default) entra sin problema.
func TestCrearPedidoWhatsAppCantidadDentroDelLimite(t *testing.T) {
	servicioID := "serv-1"
	repo := &fakeCompromisoRepo{servicios: servicioFake(servicioID)}

	motor := NewMotorService(repo, nil)

	_, err := motor.Crear(context.Background(), "neg-1", inputPedidoWhatsApp(servicioID, model.CantidadMaximaPorLineaDefault))
	if err != nil {
		t.Fatalf("cantidad == límite no debería rechazarse: %v", err)
	}
	if len(repo.creados) != 1 {
		t.Fatalf("esperaba 1 compromiso creado, hay %d", len(repo.creados))
	}
}

// TestCrearPedidoWhatsAppCantidadExcesiva: el caso real de producción, un
// pedido de "100 napolitanas". Tiene que rechazarse con el sentinel nuevo.
func TestCrearPedidoWhatsAppCantidadExcesiva(t *testing.T) {
	servicioID := "serv-1"
	repo := &fakeCompromisoRepo{servicios: servicioFake(servicioID)}

	motor := NewMotorService(repo, nil)

	_, err := motor.Crear(context.Background(), "neg-1", inputPedidoWhatsApp(servicioID, 100))
	if !errors.Is(err, ErrCantidadExcesivaPorLinea) {
		t.Fatalf("esperaba ErrCantidadExcesivaPorLinea, obtuve: %v", err)
	}
	if len(repo.creados) != 0 {
		t.Fatalf("no tenía que crearse ningún compromiso, se crearon %d", len(repo.creados))
	}
}

// TestCrearPedidoWhatsAppCantidadExcesivaConLimitePropio: triangulación con un
// segundo ángulo — el negocio cargó su propio tope (más chico que el
// default), y una cantidad que estaría OK contra el default igual se rechaza
// contra el límite configurado.
func TestCrearPedidoWhatsAppCantidadExcesivaConLimitePropio(t *testing.T) {
	servicioID := "serv-1"
	repo := &fakeCompromisoRepo{servicios: servicioFake(servicioID)}
	negocios := &fakeNegociosConfig{configJSON: `{"cantidad_maxima_por_linea": 5}`}

	motor := NewMotorService(repo, nil, ConLimiteDeCantidadPorLinea(negocios))

	// 10 está bajo el default (20) pero supera el límite propio del negocio (5).
	_, err := motor.Crear(context.Background(), "neg-1", inputPedidoWhatsApp(servicioID, 10))
	if !errors.Is(err, ErrCantidadExcesivaPorLinea) {
		t.Fatalf("esperaba ErrCantidadExcesivaPorLinea contra el límite propio, obtuve: %v", err)
	}
	if len(repo.creados) != 0 {
		t.Fatalf("no tenía que crearse ningún compromiso, se crearon %d", len(repo.creados))
	}

	// Y 5 (el límite exacto) sí entra.
	_, err = motor.Crear(context.Background(), "neg-1", inputPedidoWhatsApp(servicioID, 5))
	if err != nil {
		t.Fatalf("cantidad == límite propio no debería rechazarse: %v", err)
	}
	if len(repo.creados) != 1 {
		t.Fatalf("esperaba 1 compromiso creado tras la segunda llamada, hay %d", len(repo.creados))
	}
}

// TestCrearPedidoPanelCantidadExcesivaNoSeBloquea: aislamiento por ORIGEN —
// un pedido cargado por el panel no tiene el tope de WhatsApp: quien lo carga
// ve lo que está tipeando.
func TestCrearPedidoPanelCantidadExcesivaNoSeBloquea(t *testing.T) {
	servicioID := "serv-1"
	repo := &fakeCompromisoRepo{servicios: servicioFake(servicioID)}

	motor := NewMotorService(repo, nil)

	in := inputPedidoWhatsApp(servicioID, 100)
	in.Origen = model.OrigenPanel

	_, err := motor.Crear(context.Background(), "neg-1", in)
	if err != nil {
		t.Fatalf("un pedido de panel no debería bloquearse por cantidad: %v", err)
	}
	if len(repo.creados) != 1 {
		t.Fatalf("esperaba 1 compromiso creado, hay %d", len(repo.creados))
	}
}

// TestCrearReservaWhatsAppCantidadExcesivaNoSeBloquea: aislamiento por TIPO —
// una reserva/turno no tiene líneas de "cuántas unidades de un plato", así que
// el tope no le aplica aunque pida una cantidad grande en una línea.
func TestCrearReservaWhatsAppCantidadExcesivaNoSeBloquea(t *testing.T) {
	servicioID := "serv-1"
	repo := &fakeCompromisoRepo{servicios: servicioFake(servicioID)}

	motor := NewMotorService(repo, nil)

	in := inputPedidoWhatsApp(servicioID, 100)
	in.Tipo = model.CompromisoReserva

	_, err := motor.Crear(context.Background(), "neg-1", in)
	if err != nil {
		t.Fatalf("una reserva no debería bloquearse por cantidad: %v", err)
	}
	if len(repo.creados) != 1 {
		t.Fatalf("esperaba 1 compromiso creado, hay %d", len(repo.creados))
	}
}
