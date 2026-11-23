package httpapi

import (
	"net/http"
	"sync"
	"testing"
	"time"
)

type testClock struct {
	now time.Time
}

func (c *testClock) read() time.Time {
	return c.now
}

func TestReplaysRepeatTheFirstAnswer(t *testing.T) {
	clock := &testClock{now: time.Unix(1_800_000_000, 0)}
	cache := newReplays(time.Minute, 10, clock.read)
	runs := 0
	run := func() reply {
		runs++
		return reply{status: http.StatusOK, body: []byte(`{"n":1}`)}
	}

	first, outcome := cache.do("user\x00key", []byte("body"), run)
	if outcome != replayFresh || string(first.body) != `{"n":1}` {
		t.Fatalf("first = %v %v", first, outcome)
	}
	second, outcome := cache.do("user\x00key", []byte("body"), run)
	if outcome != replayRepeated || string(second.body) != `{"n":1}` || runs != 1 {
		t.Fatalf("second = %v %v, runs %d", second, outcome, runs)
	}
	if _, outcome := cache.do("user\x00key", []byte("other body"), run); outcome != replayConflict {
		t.Fatalf("reused key with another body = %v", outcome)
	}

	clock.now = clock.now.Add(time.Minute)
	if _, outcome := cache.do("user\x00key", []byte("other body"), run); outcome != replayFresh || runs != 2 {
		t.Fatalf("after expiry = %v, runs %d", outcome, runs)
	}
}

func TestReplaysForgetServerFailures(t *testing.T) {
	cache := newReplays(time.Minute, 10, time.Now)
	runs := 0
	run := func() reply {
		runs++
		return reply{status: http.StatusServiceUnavailable, body: []byte(`{}`)}
	}
	cache.do("k", []byte("b"), run)
	if _, outcome := cache.do("k", []byte("b"), run); outcome != replayFresh || runs != 2 {
		t.Fatalf("a 503 was replayed: %v, runs %d", outcome, runs)
	}
}

func TestReplaysStopStoringWhenFull(t *testing.T) {
	cache := newReplays(time.Minute, 1, time.Now)
	ok := func() reply { return reply{status: http.StatusOK} }
	cache.do("a", nil, ok)
	cache.do("b", nil, ok)
	if len(cache.entries) != 1 {
		t.Fatalf("entries = %d, want 1", len(cache.entries))
	}
	if _, outcome := cache.do("b", nil, ok); outcome != replayFresh {
		t.Fatalf("unstored key replayed: %v", outcome)
	}
}

func TestConcurrentDuplicatesWaitForTheFirst(t *testing.T) {
	cache := newReplays(time.Minute, 10, time.Now)
	release := make(chan struct{})
	started := make(chan struct{})
	runs := 0
	run := func() reply {
		runs++
		close(started)
		<-release
		return reply{status: http.StatusOK, body: []byte(`{"n":1}`)}
	}

	var wait sync.WaitGroup
	wait.Add(1)
	go func() {
		defer wait.Done()
		cache.do("k", []byte("b"), run)
	}()
	<-started

	results := make(chan replayOutcome, 1)
	go func() {
		_, outcome := cache.do("k", []byte("b"), run)
		results <- outcome
	}()
	close(release)
	wait.Wait()

	if outcome := <-results; outcome != replayRepeated || runs != 1 {
		t.Fatalf("duplicate = %v, runs %d", outcome, runs)
	}
}
