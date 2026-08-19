package infra

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
)

// ClaveFiscalBytes es el largo de la clave de FISCAL_CIPHER_KEY una vez
// decodificada: AES-256 y nada más chico.
const ClaveFiscalBytes = 32

// ErrCifradoNoConfigurado: no hay FISCAL_CIPHER_KEY. Guardar un certificado en
// claro no es una alternativa aceptable, así que la operación falla y lo dice.
var ErrCifradoNoConfigurado = errors.New("falta FISCAL_CIPHER_KEY: no se pueden guardar certificados fiscales")

// Cifrador protege en reposo los secretos fiscales: el certificado y la clave
// privada con los que se factura a nombre del negocio. La clave del cifrado
// vive FUERA de la base (variable de entorno), así que un dump de PostgreSQL
// no alcanza para emitir facturas a nombre de nadie.
//
// Nada de lo que pasa por acá se loguea ni se devuelve en un response: el
// texto plano sólo existe entre el descifrado y el POST al sidecar.
type Cifrador interface {
	// Cifrar devuelve nonce+ciphertext en base64 estándar.
	Cifrar(plano string) (string, error)
	// Descifrar deshace lo anterior. Falla si el dato fue alterado: GCM
	// autentica, no sólo cifra.
	Descifrar(cifrado string) (string, error)
}

type cifradorGCM struct{ aead cipher.AEAD }

// NewCifrador arma el cifrador con la clave hexadecimal de FISCAL_CIPHER_KEY
// (64 caracteres hex = 32 bytes). Una clave vacía devuelve
// ErrCifradoNoConfigurado: es la señal de que el módulo fiscal está apagado, no
// un motivo para arrancar sin cifrado.
//
// Generar con: openssl rand -hex 32
func NewCifrador(claveHex string) (Cifrador, error) {
	if claveHex == "" {
		return nil, ErrCifradoNoConfigurado
	}
	clave, err := hex.DecodeString(claveHex)
	if err != nil {
		return nil, fmt.Errorf("FISCAL_CIPHER_KEY no es hexadecimal valido: %w", err)
	}
	if len(clave) != ClaveFiscalBytes {
		return nil, fmt.Errorf("FISCAL_CIPHER_KEY tiene %d bytes, se esperaban %d (64 caracteres hex)",
			len(clave), ClaveFiscalBytes)
	}
	bloque, err := aes.NewCipher(clave)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(bloque)
	if err != nil {
		return nil, err
	}
	return &cifradorGCM{aead: aead}, nil
}

func (c *cifradorGCM) Cifrar(plano string) (string, error) {
	// Nonce nuevo por operación: reusar uno con la misma clave rompe GCM del
	// todo, no un poquito.
	nonce := make([]byte, c.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	sellado := c.aead.Seal(nonce, nonce, []byte(plano), nil)
	return base64.StdEncoding.EncodeToString(sellado), nil
}

func (c *cifradorGCM) Descifrar(cifrado string) (string, error) {
	crudo, err := base64.StdEncoding.DecodeString(cifrado)
	if err != nil {
		return "", fmt.Errorf("dato cifrado invalido: %w", err)
	}
	n := c.aead.NonceSize()
	if len(crudo) < n {
		return "", errors.New("dato cifrado invalido: mas corto que el nonce")
	}
	// El mensaje de error nunca incluye el dato: un log con el ciphertext es
	// media filtración.
	plano, err := c.aead.Open(nil, crudo[:n], crudo[n:], nil)
	if err != nil {
		return "", errors.New("no se pudo descifrar: clave incorrecta o dato alterado")
	}
	return string(plano), nil
}
