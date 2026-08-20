package infra

import (
	"encoding/base64"
	"errors"
	"strings"
	"testing"
)

const claveOK = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

func TestCifradoIdaYVuelta(t *testing.T) {
	c, err := NewCifrador(claveOK)
	if err != nil {
		t.Fatalf("cifrador: %v", err)
	}

	pem := "-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----\n"
	cifrado, err := c.Cifrar(pem)
	if err != nil {
		t.Fatalf("cifrar: %v", err)
	}
	if strings.Contains(cifrado, "BEGIN CERTIFICATE") {
		t.Fatal("el ciphertext contiene el texto plano")
	}

	plano, err := c.Descifrar(cifrado)
	if err != nil {
		t.Fatalf("descifrar: %v", err)
	}
	if plano != pem {
		t.Fatalf("no volvió igual: %q", plano)
	}
}

// El nonce nuevo por operación es lo que hace que dos certificados iguales no
// se vean iguales en la base. Sin esto, GCM se rompe del todo.
func TestCifradoNoEsDeterminista(t *testing.T) {
	c, _ := NewCifrador(claveOK)
	a, _ := c.Cifrar("mismo secreto")
	b, _ := c.Cifrar("mismo secreto")
	if a == b {
		t.Fatal("dos cifrados del mismo texto dieron igual: el nonce no está rotando")
	}
}

func TestDescifrarDetectaAlteracion(t *testing.T) {
	c, _ := NewCifrador(claveOK)
	cifrado, _ := c.Cifrar("clave privada")

	// Se altera un byte REAL del ciphertext, no un carácter del base64: cerca
	// del padding los bits bajos de base64 no siempre son significativos, y
	// tocarlos ahí podía dejar los bytes decodificados idénticos (test flaky).
	// Decodificar, voltear un byte del medio y re-codificar garantiza que GCM
	// vea una alteración real y falle siempre.
	crudo, err := base64.StdEncoding.DecodeString(cifrado)
	if err != nil {
		t.Fatalf("decodificar: %v", err)
	}
	crudo[len(crudo)/2] ^= 0xFF
	alterado := base64.StdEncoding.EncodeToString(crudo)

	if _, err := c.Descifrar(alterado); err == nil {
		t.Fatal("un ciphertext alterado se descifró sin error")
	}
}

func TestDescifrarConOtraClaveFalla(t *testing.T) {
	a, _ := NewCifrador(claveOK)
	b, _ := NewCifrador("fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210")

	cifrado, _ := a.Cifrar("certificado")
	if _, err := b.Descifrar(cifrado); err == nil {
		t.Fatal("se descifró con otra clave")
	}
}

func TestClaveInvalida(t *testing.T) {
	casos := map[string]string{
		"vacia":     "",
		"corta":     "0123456789abcdef",
		"no hexa":   strings.Repeat("z", 64),
		"muy larga": strings.Repeat("ab", 64),
	}
	for nombre, clave := range casos {
		if _, err := NewCifrador(clave); err == nil {
			t.Errorf("%s: se aceptó una clave inválida", nombre)
		}
	}
	// La clave vacía tiene su propio sentinel: main la distingue de una clave
	// rota para apagar el módulo fiscal en vez de morirse al arrancar.
	if _, err := NewCifrador(""); !errors.Is(err, ErrCifradoNoConfigurado) {
		t.Fatalf("clave vacía: esperaba ErrCifradoNoConfigurado, obtuvo %v", err)
	}
}
