package httpapi

import (
	"crypto/sha256"
	"net/http"
	"sync"
	"time"
)

const (
	replayTTL   = 10 * time.Minute
	replayLimit = 10_000
)

type replayOutcome int

const (
	replayFresh replayOutcome = iota
	replayRepeated
	replayConflict
)

type reply struct {
	status int
	body   []byte
}

func (r reply) keep() bool {
	return r.status == http.StatusOK || r.status == http.StatusBadRequest
}

type replayEntry struct {
	fingerprint [sha256.Size]byte
	expires     time.Time
	done        chan struct{}
	result      reply
}

type replays struct {
	mu      sync.Mutex
	entries map[string]*replayEntry
	ttl     time.Duration
	limit   int
	now     func() time.Time
}

func newReplays(ttl time.Duration, limit int, now func() time.Time) *replays {
	return &replays{entries: make(map[string]*replayEntry), ttl: ttl, limit: limit, now: now}
}

func (r *replays) do(key string, body []byte, run func() reply) (reply, replayOutcome) {
	fingerprint := sha256.Sum256(body)

	r.mu.Lock()
	now := r.now()
	if entry, found := r.entries[key]; found && now.Before(entry.expires) {
		r.mu.Unlock()
		if entry.fingerprint != fingerprint {
			return reply{}, replayConflict
		}
		<-entry.done
		return entry.result, replayRepeated
	}
	r.prune(now)
	entry := &replayEntry{fingerprint: fingerprint, expires: now.Add(r.ttl), done: make(chan struct{})}
	stored := len(r.entries) < r.limit
	if stored {
		r.entries[key] = entry
	}
	r.mu.Unlock()

	entry.result = run()
	close(entry.done)

	if stored && !entry.result.keep() {
		r.mu.Lock()
		if r.entries[key] == entry {
			delete(r.entries, key)
		}
		r.mu.Unlock()
	}
	return entry.result, replayFresh
}

func (r *replays) prune(now time.Time) {
	if len(r.entries) < r.limit {
		return
	}
	for key, entry := range r.entries {
		select {
		case <-entry.done:
			if !now.Before(entry.expires) {
				delete(r.entries, key)
			}
		default:
		}
	}
}
