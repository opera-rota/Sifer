package httpapi

import (
	"errors"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/mentor-sator/Sifer/services/edge-gateway/internal/contract"
)

const maxBodyBytes = 1 << 20

func readBody(c *gin.Context) ([]byte, bool) {
	body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, maxBodyBytes))
	if err == nil {
		return body, true
	}
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		writeError(c, http.StatusRequestEntityTooLarge, "body_too_large", "request body exceeds 1 MiB")
		return nil, false
	}
	writeError(c, http.StatusBadRequest, "unreadable_body", "request body could not be read")
	return nil, false
}

func schemaMatches(c *gin.Context, received uint32) bool {
	if received == contract.SchemaMajor {
		return true
	}
	c.JSON(http.StatusConflict, gin.H{
		"error":    "schema_major_mismatch",
		"message":  "Sifer needs updating",
		"expected": contract.SchemaMajor,
		"received": received,
	})
	return false
}
