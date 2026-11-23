package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"google.golang.org/protobuf/encoding/protojson"

	siferv1 "github.com/mentor-sator/Sifer/gen/go/sifer/v1"
)

const upstreamTimeout = 5 * time.Second

func (a *api) echo(c *gin.Context) {
	body, ok := readBody(c)
	if !ok {
		return
	}

	envelope := &siferv1.Envelope{}
	if err := protojson.Unmarshal(body, envelope); err != nil {
		writeError(c, http.StatusBadRequest, "invalid_envelope", "body is not a valid Envelope")
		return
	}
	if !schemaMatches(c, envelope.GetSchemaMajor()) {
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), upstreamTimeout)
	defer cancel()

	echoed, err := a.orchestrator.Echo(ctx, &siferv1.EchoRequest{Envelope: envelope})
	if err != nil {
		writeUpstreamError(c, err)
		return
	}

	payload, err := protojson.Marshal(echoed.GetEnvelope())
	if err != nil {
		writeError(c, http.StatusInternalServerError, "encode_failed", "response could not be encoded")
		return
	}
	c.Data(http.StatusOK, "application/json", payload)
}
