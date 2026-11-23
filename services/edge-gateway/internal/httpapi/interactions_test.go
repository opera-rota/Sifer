package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	siferv1 "github.com/mentor-sator/Sifer/gen/go/sifer/v1"
	"github.com/mentor-sator/Sifer/services/edge-gateway/internal/auth"
)

const (
	interactionKey  = "0192f0c4-7b1e-7cc0-9d6a-3f2b8e1a4c55"
	interactionBody = `{"schemaMajor":1,"dropContext":{"reader":"DROP_READER_ACCESSIBILITY","scope":"DROP_SCOPE_POINT","appKey":"word","content":"we need to circle back"},"instruction":{"text":"make this more professional"}}`
)

type resolvingOrchestrator struct {
	siferv1.OrchestratorServiceClient
	err   error
	calls int
	seen  *siferv1.ResolveRequest
}

func (o *resolvingOrchestrator) Resolve(_ context.Context, in *siferv1.ResolveRequest, _ ...grpc.CallOption) (*siferv1.ResolveResponse, error) {
	o.calls++
	o.seen = in
	if o.err != nil {
		return nil, o.err
	}
	return &siferv1.ResolveResponse{FixPlan: &siferv1.FixPlan{
		FixKey:       "rewrite",
		Replacement:  "We need to revisit this.",
		ExpectPrefix: "We need to revisit this.",
		Engine:       "claude-haiku",
	}}, nil
}

type tokenIsUser struct{}

func (tokenIsUser) Verify(_ context.Context, raw string) (auth.Principal, error) {
	return auth.Principal{UserID: raw, Email: raw + "@example.com"}, nil
}

func interactAs(router *gin.Engine, user, key, body string) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/interactions", strings.NewReader(body))
	request.Header.Set("Authorization", "Bearer "+user)
	if key != "" {
		request.Header.Set("Idempotency-Key", key)
	}
	router.ServeHTTP(recorder, request)
	return recorder
}

func interact(router *gin.Engine, key, body string) *httptest.ResponseRecorder {
	return interactAs(router, "u1", key, body)
}

func TestInteractionReturnsTheFixPlan(t *testing.T) {
	orchestrator := &resolvingOrchestrator{}
	recorder := interact(NewRouter(orchestrator, tokenIsUser{}), interactionKey, interactionBody)

	if recorder.Code != http.StatusOK || recorder.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("status %d, body %s", recorder.Code, recorder.Body.String())
	}
	var payload struct {
		FixPlan struct {
			Replacement string `json:"replacement"`
			Engine      string `json:"engine"`
		} `json:"fixPlan"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.FixPlan.Replacement != "We need to revisit this." || payload.FixPlan.Engine != "claude-haiku" {
		t.Fatalf("body = %s", recorder.Body.String())
	}
	if orchestrator.seen.GetInstruction().GetText() != "make this more professional" ||
		orchestrator.seen.GetDropContext().GetReader() != siferv1.DropReader_DROP_READER_ACCESSIBILITY {
		t.Fatalf("orchestrator saw %v", orchestrator.seen)
	}
}

func TestInteractionRequiresAToken(t *testing.T) {
	orchestrator := &resolvingOrchestrator{}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/interactions", strings.NewReader(interactionBody))
	request.Header.Set("Idempotency-Key", interactionKey)
	NewRouter(orchestrator, tokenIsUser{}).ServeHTTP(recorder, request)
	if recorder.Code != http.StatusUnauthorized || orchestrator.calls != 0 {
		t.Fatalf("status %d, calls %d", recorder.Code, orchestrator.calls)
	}
}

func TestInteractionRejectsBadRequests(t *testing.T) {
	cases := []struct {
		name, key, body, wantError string
		wantStatus                 int
	}{
		{"no key", "", interactionBody, "invalid_idempotency_key", http.StatusBadRequest},
		{"short key", "abc", interactionBody, "invalid_idempotency_key", http.StatusBadRequest},
		{"bad key", strings.Repeat("a", 15) + " ", interactionBody, "invalid_idempotency_key", http.StatusBadRequest},
		{"not json", interactionKey, "content=hello", "invalid_request", http.StatusBadRequest},
		{"unknown field", interactionKey, `{"schemaMajor":1,"surprise":true}`, "invalid_request", http.StatusBadRequest},
		{"other major", interactionKey, `{"schemaMajor":2}`, "schema_major_mismatch", http.StatusConflict},
		{"no major", interactionKey, `{}`, "schema_major_mismatch", http.StatusConflict},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			orchestrator := &resolvingOrchestrator{}
			recorder := interact(NewRouter(orchestrator, tokenIsUser{}), tc.key, tc.body)
			if recorder.Code != tc.wantStatus || errorCode(t, recorder) != tc.wantError {
				t.Fatalf("status %d, body %s", recorder.Code, recorder.Body.String())
			}
			if orchestrator.calls != 0 {
				t.Fatal("a rejected request reached the orchestrator")
			}
		})
	}
}

func TestInteractionRetryIsAnsweredOnce(t *testing.T) {
	orchestrator := &resolvingOrchestrator{}
	router := NewRouter(orchestrator, tokenIsUser{})

	first := interact(router, interactionKey, interactionBody)
	second := interact(router, interactionKey, interactionBody)

	if orchestrator.calls != 1 {
		t.Fatalf("orchestrator calls = %d, want 1", orchestrator.calls)
	}
	if second.Code != http.StatusOK || second.Body.String() != first.Body.String() || second.Header().Get("Idempotent-Replayed") != "true" {
		t.Fatalf("retry = %d %s", second.Code, second.Body.String())
	}
	if first.Header().Get("Idempotent-Replayed") != "" {
		t.Fatal("first answer marked as replayed")
	}
}

func TestInteractionKeyCannotBeReusedForAnotherBody(t *testing.T) {
	orchestrator := &resolvingOrchestrator{}
	router := NewRouter(orchestrator, tokenIsUser{})
	interact(router, interactionKey, interactionBody)

	other := strings.Replace(interactionBody, "circle back", "sync up", 1)
	recorder := interact(router, interactionKey, other)
	if recorder.Code != http.StatusUnprocessableEntity || errorCode(t, recorder) != "idempotency_key_reused" || orchestrator.calls != 1 {
		t.Fatalf("status %d, calls %d", recorder.Code, orchestrator.calls)
	}
}

func TestInteractionKeysBelongToOneUser(t *testing.T) {
	orchestrator := &resolvingOrchestrator{}
	router := NewRouter(orchestrator, tokenIsUser{})
	interactAs(router, "u1", interactionKey, interactionBody)
	second := interactAs(router, "u2", interactionKey, interactionBody)
	if orchestrator.calls != 2 || second.Header().Get("Idempotent-Replayed") != "" {
		t.Fatalf("calls = %d, another user's answer was replayed", orchestrator.calls)
	}
}

func TestInteractionFailuresAreNotReplayed(t *testing.T) {
	orchestrator := &resolvingOrchestrator{err: status.Error(codes.Unavailable, "every text engine failed")}
	router := NewRouter(orchestrator, tokenIsUser{})

	first := interact(router, interactionKey, interactionBody)
	if first.Code != http.StatusServiceUnavailable || errorCode(t, first) != "upstream_unavailable" {
		t.Fatalf("status %d, body %s", first.Code, first.Body.String())
	}
	orchestrator.err = nil
	second := interact(router, interactionKey, interactionBody)
	if second.Code != http.StatusOK || orchestrator.calls != 2 {
		t.Fatalf("retry after failure = %d, calls %d", second.Code, orchestrator.calls)
	}
}

func TestInteractionMapsUpstreamFailures(t *testing.T) {
	cases := []struct {
		code       codes.Code
		wantStatus int
		wantError  string
	}{
		{codes.InvalidArgument, http.StatusBadRequest, "invalid_argument"},
		{codes.FailedPrecondition, http.StatusConflict, "failed_precondition"},
		{codes.DeadlineExceeded, http.StatusGatewayTimeout, "upstream_timeout"},
		{codes.Internal, http.StatusBadGateway, "upstream_error"},
	}
	for _, tc := range cases {
		t.Run(tc.code.String(), func(t *testing.T) {
			orchestrator := &resolvingOrchestrator{err: status.Error(tc.code, "no")}
			recorder := interact(NewRouter(orchestrator, tokenIsUser{}), interactionKey, interactionBody)
			if recorder.Code != tc.wantStatus || errorCode(t, recorder) != tc.wantError {
				t.Fatalf("status %d, body %s", recorder.Code, recorder.Body.String())
			}
		})
	}
}
