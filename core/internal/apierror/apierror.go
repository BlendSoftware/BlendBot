// Package apierror provides standardized error response structures for the API.
// All errors returned to clients go through this package to ensure consistency
// and to prevent leaking internal details (stack traces, DB errors, etc.).
package apierror

// APIError is the canonical error envelope for all 4xx/5xx HTTP responses.
type APIError struct {
	Detail string `json:"detail"`
}

func New(msg string) *APIError {
	return &APIError{Detail: msg}
}

// ValidationError wraps multiple field errors.
type ValidationError struct {
	Detail string            `json:"detail"`
	Fields map[string]string `json:"fields"`
}

func NewValidation(fields map[string]string) *ValidationError {
	return &ValidationError{Detail: "Error de validacion", Fields: fields}
}
