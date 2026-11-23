package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"regexp"
	"time"

	"github.com/gin-gonic/gin"
	"google.golang.org/protobuf/encoding/protojson"

	siferv1 "github.com/mentor-sator/Sifer/gen/go/sifer/v1"
	"github.com/mentor-sator/Sifer/services/edge-gateway/internal/auth"
)

const resolveTimeout = 28 * time.Second

var idempotencyKeyPattern = regexp.MustCompile(`^[A-Za-z0-9._:-]{16,128}$`)

func (a *api) createInteraction(c *gin.Context) {
	principal := c.MustGet(principalKey).(auth.Principal)
	key := c.GetHeader("Idempotency-Key")
	if !idempotencyKeyPattern.MatchString(key) {
		writeError(c, http.StatusBadRequest, "invalid_idempotency_key", "Idempotency-Key must be 16 to 128 letters, digits, '.', '_', ':' or '-'")
		return
	}

	body, ok := readBody(c)
	if !ok {
		return
	}
	request := &siferv1.ResolveRequest{}
	if err := protojson.Unmarshal(body, request); err != nil {
		writeError(c, http.StatusBadRequest, "invalid_request", "body is not a valid ResolveRequest")
		return
	}
	if !schemaMatches(c, request.GetSchemaMajor()) {
		return
	}

	result, outcome := a.replays.do(principal.UserID+"\x00"+key, body, func() reply {
		return a.resolve(c.Request.Context(), request)
	})
	if outcome == replayConflict {
		writeError(c, http.StatusUnprocessableEntity, "idempotency_key_reused", "this Idempotency-Key was already used with a different body")
		return
	}
	c.Header("Cache-Control", "no-store")
	if outcome == replayRepeated {
		c.Header("Idempotent-Replayed", "true")
	}
	c.Data(result.status, "application/json", result.body)
}

func (a *api) resolve(ctx context.Context, request *siferv1.ResolveRequest) reply {
	ctx, cancel := context.WithTimeout(ctx, resolveTimeout)
	defer cancel()

	response, err := a.orchestrator.Resolve(ctx, request)
	if err != nil {
		return jsonReply(upstreamError(err))
	}
	payload, err := protojson.Marshal(response)
	if err != nil {
		return jsonReply(http.StatusInternalServerError, gin.H{"error": "encode_failed", "message": "response could not be encoded"})
	}
	return reply{status: http.StatusOK, body: payload}
}

func jsonReply(httpStatus int, payload gin.H) reply {
	body, err := json.Marshal(payload)
	if err != nil {
		return reply{status: http.StatusInternalServerError, body: []byte(`{"error":"encode_failed"}`)}
	}
	return reply{status: httpStatus, body: body}
}
