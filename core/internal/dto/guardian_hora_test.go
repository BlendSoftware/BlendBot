package dto

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"
)

// El guardián contra la regresión número ocho.
//
// Este cambio arregló seis endpoints que salían en UTC. Arreglar seis y
// mudarse no sirve de nada: el defecto no eran los seis, era que localizar
// dependía de que alguien se acordara. Este test es lo que convierte "hay que
// acordarse" en "el CI te avisa".
//
// Por qué reflexión acá y no en producción: en un test la magia se paga una vez
// y protege para siempre; en el camino de un request se paga en cada lectura de
// cada handler por cualquiera que quiera entender el código. Un test que falla
// dice exactamente qué campo y en qué archivo.

// respuestas es la lista de structs que salen por HTTP.
//
// Se enumeran a mano y no se descubren por reflexión del paquete porque Go no
// permite listar los tipos de un paquete en runtime. Es la única parte frágil
// del guardián y por eso tiene su propio control: TestElGuardianCubreTodosLos-
// ResponseDelPaquete compara esta lista contra los archivos fuente.
func respuestas() []any {
	return []any{
		AgendaResponse{},
		AltaNegocioResponse{},
		CierreResponse{},
		ClienteResumen{},
		CobroResponse{},
		ComprobanteResponse{},
		CompromisoResponse{},
		ConfigFiscalResponse{},
		ConsultaResponse{},
		CupoResponse{},
		ExcepcionResponse{},
		HoldResponse{},
		HorarioResponse{},
		HuecosResponse{},
		InsumoResponse{},
		JornadaResponse{},
		JornadaActualResponse{},
		LineaCompromisoResponse{},
		LineaRecetaResponse{},
		ListaEsperaResponse{},
		MovimientoResponse{},
		NegocioDatosResponse{},
		NegocioResponse{},
		RecetaResponse{},
		ReporteResponse{},
		TokenAgenteResponse{},
	}
}

var (
	tipoTime = reflect.TypeOf(time.Time{})
	tipoHora = reflect.TypeOf(Hora{})
)

// TestNingunResponseExponeTimeTime recorre los structs de respuesta y falla si
// alguno serializa un time.Time desnudo.
//
// Un time.Time en un response siempre tiene una respuesta razonable que dar
// —la TZ del proceso— y por eso el olvido es silencioso. dto.Hora no tiene
// ninguna: sin location falla al serializarse.
func TestNingunResponseExponeTimeTime(t *testing.T) {
	for _, r := range respuestas() {
		tipo := reflect.TypeOf(r)
		t.Run(tipo.Name(), func(t *testing.T) {
			revisar(t, tipo, tipo.Name())
		})
	}
}

func revisar(t *testing.T, tipo reflect.Type, camino string) {
	t.Helper()
	for i := 0; i < tipo.NumField(); i++ {
		campo := tipo.Field(i)
		if campo.PkgPath != "" {
			continue // no exportado: encoding/json ni lo mira
		}
		tagJSON := campo.Tag.Get("json")
		if tagJSON == "-" {
			continue // no viaja
		}

		ct := campo.Type
		for ct.Kind() == reflect.Ptr || ct.Kind() == reflect.Slice {
			ct = ct.Elem()
		}

		// Hora es la solución, no el problema: adentro guarda un time.Time y
		// un *time.Location, los dos privados. Recursar acá reportaría cada
		// campo bien migrado como si estuviera mal.
		if ct == tipoHora {
			continue
		}

		if ct == tipoTime {
			t.Errorf(
				"%s.%s (json:%q) expone time.Time.\n"+
					"  Un time.Time en un response sale en la TZ del proceso —UTC en el\n"+
					"  contenedor— y nadie se entera hasta que un dueño lee la hora corrida.\n"+
					"  Usá dto.Hora (o *dto.Hora si es opcional) y construílo con\n"+
					"  dto.HoraDe(ctx, t) / dto.HoraPtrDe(ctx, t).",
				camino, campo.Name, tagJSON)
			continue
		}

		// Structs anidados: una LineaCompromisoResponse adentro de un
		// CompromisoResponse viaja igual y tiene que cumplir lo mismo.
		if ct.Kind() == reflect.Struct && ct.PkgPath() == tipo.PkgPath() {
			revisar(t, ct, camino+"."+campo.Name)
		}
	}
}

// TestLosRequestSiPuedenUsarTimeTime fija el otro lado de la regla, para que
// nadie "arregle" un Input migrándolo por las dudas.
//
// Un request trae un instante que el cliente eligió, con su offset explícito, y
// se parsea como instante. El huso del negocio no tiene nada que ver: acá
// dto.Hora sería ruido y una conversión de más.
func TestLosRequestSiPuedenUsarTimeTime(t *testing.T) {
	entradas := []any{
		CrearCompromisoInput{},
		CrearHoldInput{},
		CrearExcepcionInput{},
	}
	for _, in := range entradas {
		tipo := reflect.TypeOf(in)
		var conTime int
		for i := 0; i < tipo.NumField(); i++ {
			ct := tipo.Field(i).Type
			for ct.Kind() == reflect.Ptr {
				ct = ct.Elem()
			}
			if ct == tipoTime {
				conTime++
			}
		}
		if conTime == 0 {
			t.Errorf("%s ya no tiene ningún time.Time: si se migró a dto.Hora, se migró de más "+
				"(los requests parsean el instante que manda el cliente)", tipo.Name())
		}
	}
}

// TestElGuardianCubreTodosLosResponseDelPaquete evita el agujero obvio del
// guardián: que alguien agregue un `FooResponse` nuevo y se olvide de sumarlo a
// respuestas(), con lo cual el test pasaría sin haber mirado nada.
//
// Compara la lista de arriba contra los tipos declarados en los .go del
// paquete. Si no coinciden, dice cuál falta.
func TestElGuardianCubreTodosLosResponseDelPaquete(t *testing.T) {
	declarados := tiposDeclaradosEnElPaquete(t)

	cubiertos := map[string]bool{}
	for _, r := range respuestas() {
		cubiertos[reflect.TypeOf(r).Name()] = true
	}

	for _, nombre := range declarados {
		if !esNombreDeRespuesta(nombre) {
			continue
		}
		if !cubiertos[nombre] {
			t.Errorf("%s parece un struct de respuesta y no está en respuestas(): "+
				"agregalo, o si no viaja por HTTP explicá por qué acá al lado", nombre)
		}
	}
}

// esNombreDeRespuesta aplica la convención del repo: ...Input/...Request entra,
// ...Response/...Resumen sale.
func esNombreDeRespuesta(nombre string) bool {
	if strings.HasSuffix(nombre, "Input") || strings.HasSuffix(nombre, "Request") {
		return false
	}
	return strings.HasSuffix(nombre, "Response") || strings.HasSuffix(nombre, "Resumen")
}

// tiposDeclaradosEnElPaquete parsea los .go del directorio y devuelve los
// nombres de los structs declarados.
//
// Parsear el fuente es la única forma: Go no permite enumerar los tipos de un
// paquete en runtime. El costo es leer un puñado de archivos una vez por
// corrida; el beneficio es que respuestas() no se puede quedar vieja en
// silencio.
func tiposDeclaradosEnElPaquete(t *testing.T) []string {
	t.Helper()

	fset := token.NewFileSet()
	paquetes, err := parser.ParseDir(fset, ".", func(fi os.FileInfo) bool {
		return !strings.HasSuffix(fi.Name(), "_test.go")
	}, 0)
	if err != nil {
		t.Fatalf("parseando el paquete: %v", err)
	}

	var nombres []string
	for _, p := range paquetes {
		for _, archivo := range p.Files {
			ast.Inspect(archivo, func(n ast.Node) bool {
				ts, ok := n.(*ast.TypeSpec)
				if !ok {
					return true
				}
				if _, esStruct := ts.Type.(*ast.StructType); esStruct {
					nombres = append(nombres, ts.Name.Name)
				}
				return true
			})
		}
	}
	if len(nombres) == 0 {
		t.Fatal("no encontré ningún struct en el paquete: el guardián no está mirando nada")
	}
	return nombres
}
