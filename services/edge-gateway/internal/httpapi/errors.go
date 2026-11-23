package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func writeError(c *gin.Context, httpStatus int, code, message string) {
	c.JSON(httpStatus, gin.H{"error": code, "message": message})
}

func writeUpstreamError(c *gin.Context, err error) {
	httpStatus, payload := upstreamError(err)
	c.JSON(httpStatus, payload)
}

func upstreamError(err error) (int, gin.H) {
	upstream := status.Convert(err)
	switch upstream.Code() {
	case codes.InvalidArgument:
		return http.StatusBadRequest, gin.H{"error": "invalid_argument", "message": upstream.Message()}
	case codes.FailedPrecondition:
		return http.StatusConflict, gin.H{"error": "failed_precondition", "message": upstream.Message()}
	case codes.DeadlineExceeded:
		return http.StatusGatewayTimeout, gin.H{"error": "upstream_timeout", "message": "orchestrator did not answer in time"}
	case codes.Unavailable:
		return http.StatusServiceUnavailable, gin.H{"error": "upstream_unavailable", "message": "orchestrator is unavailable"}
	default:
		return http.StatusBadGateway, gin.H{"error": "upstream_error", "message": "orchestrator failed"}
	}
}
