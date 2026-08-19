package middleware

import "github.com/gin-gonic/gin"

// SecurityHeaders adds standard defensive HTTP response headers to every reply.
//
//   - X-Content-Type-Options: nosniff       — prevent MIME-type sniffing attacks
//   - X-Frame-Options: DENY                 — block clickjacking via iframes
//   - X-XSS-Protection: 0                   — disable legacy XSS filter (modern
//     browsers use CSP; the old filter can itself introduce vulnerabilities)
//   - Referrer-Policy                       — limit referrer leakage
//   - Permissions-Policy                    — deny camera/mic/geolocation access
//   - Strict-Transport-Security             — HSTS, only sent over TLS connections
func SecurityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "DENY")
		c.Header("X-XSS-Protection", "0")
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
		c.Header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")

		// HSTS only over TLS so localhost development doesn't get a sticky
		// HSTS entry in the browser.
		if c.Request.TLS != nil {
			c.Header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}

		c.Next()
	}
}
