package portsuggest

import (
	"context"
	"errors"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/miguel-bm/codeburg/internal/portscan"
)

const (
	sourceOutput = "output"
	sourceScan   = "scan"
)

var (
	ansiEscapeRe   = regexp.MustCompile(`\x1b\[[0-9;?]*[ -/]*[@-~]`)
	urlPortRe      = regexp.MustCompile(`https?://(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1):([0-9]{2,5})`)
	hostPortRe     = regexp.MustCompile(`(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1):([0-9]{2,5})`)
	listeningRe    = regexp.MustCompile(`(?i)\blisten(?:ing)?(?:\s+on)?[^\n]*?(?::|\s)([0-9]{2,5})\b`)
	portEqualsRe   = regexp.MustCompile(`(?i)\bport\s*[:=]\s*([0-9]{2,5})\b`)
	ErrRateLimited = errors.New("scan rate limited")
)

// Scanner is the minimum port scanning interface needed by the manager.
type Scanner interface {
	ListListeningPorts(ctx context.Context) ([]int, error)
}

// Suggestion is a task-scoped tunnel candidate.
type Suggestion struct {
	Port        int       `json:"port"`
	Sources     []string  `json:"sources"`
	FirstSeenAt time.Time `json:"firstSeenAt"`
	LastSeenAt  time.Time `json:"lastSeenAt"`
}

// ScanResult summarizes a scan run.
type ScanResult struct {
	ScannedAt          time.Time `json:"scannedAt"`
	PortsFound         []int     `json:"portsFound"`
	SuggestionsUpdated int       `json:"suggestionsUpdated"`
}

type suggestionState struct {
	Port        int
	Sources     map[string]struct{}
	FirstSeenAt time.Time
	LastSeenAt  time.Time
}

type outputEvent struct {
	taskID    string
	sessionID string
	chunk     []byte
}

// Manager stores and updates tunnel suggestions.
type Manager struct {
	mu sync.Mutex

	scanner Scanner

	byTask      map[string]map[int]*suggestionState
	sessionTail map[string]string
	lastScan    map[string]time.Time

	listenCache   map[int]struct{}
	listenCacheAt time.Time

	outputCh chan outputEvent

	// Tunables
	listenCacheTTL time.Duration
	scanCooldown   time.Duration
	suggestionTTL  time.Duration
	minPort        int
}

// NewManager creates a manager with sane defaults.
func NewManager(scanner Scanner) *Manager {
	if scanner == nil {
		scanner = portscan.NewScanner()
	}

	m := &Manager{
		scanner:        scanner,
		byTask:         make(map[string]map[int]*suggestionState),
		sessionTail:    make(map[string]string),
		lastScan:       make(map[string]time.Time),
		listenCacheTTL: 3 * time.Second,
		scanCooldown:   5 * time.Second,
		suggestionTTL:  30 * time.Minute,
		minPort:        1024,
		outputCh:       make(chan outputEvent, 512),
	}

	go m.outputLoop()
	go m.cleanupLoop()
	return m
}

func (m *Manager) outputLoop() {
	for ev := range m.outputCh {
		m.processOutput(ev)
	}
}

func (m *Manager) cleanupLoop() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		m.cleanupStale()
	}
}

// IngestOutput queues runtime output for parsing.
func (m *Manager) IngestOutput(taskID, sessionID string, chunk []byte) {
	if taskID == "" || sessionID == "" || len(chunk) == 0 {
		return
	}

	cp := make([]byte, len(chunk))
	copy(cp, chunk)

	select {
	case m.outputCh <- outputEvent{taskID: taskID, sessionID: sessionID, chunk: cp}:
	default:
		// Drop if overloaded; suggestions are best-effort.
	}
}

// ForgetSession clears parser state for a finished session.
func (m *Manager) ForgetSession(sessionID string) {
	m.mu.Lock()
	delete(m.sessionTail, sessionID)
	m.mu.Unlock()
}

func (m *Manager) processOutput(ev outputEvent) {
	text := ansiEscapeRe.ReplaceAllString(string(ev.chunk), "")
	if text == "" {
		return
	}

	m.mu.Lock()
	prefix := m.sessionTail[ev.sessionID]
	combined := prefix + text
	lines := strings.Split(combined, "\n")
	tail := lines[len(lines)-1]
	if len(tail) > 1024 {
		tail = tail[len(tail)-1024:]
	}
	m.sessionTail[ev.sessionID] = tail
	m.mu.Unlock()

	if len(lines) <= 1 {
		return
	}

	ports := make(map[int]struct{})
	for _, line := range lines[:len(lines)-1] {
		for _, port := range extractPorts(line) {
			if port >= m.minPort && port <= 65535 {
				ports[port] = struct{}{}
			}
		}
	}
	if len(ports) == 0 {
		return
	}

	listening, err := m.currentListeningSet(context.Background(), false)
	if err != nil {
		return
	}

	for port := range ports {
		if _, ok := listening[port]; !ok {
			continue
		}
		m.upsert(ev.taskID, port, sourceOutput)
	}
}

// ScanTask runs a host scan and stores suggestions for a task.
func (m *Manager) ScanTask(ctx context.Context, taskID string) (*ScanResult, error) {
	now := time.Now()

	m.mu.Lock()
	if last, ok := m.lastScan[taskID]; ok && now.Sub(last) < m.scanCooldown {
		m.mu.Unlock()
		return nil, ErrRateLimited
	}
	m.lastScan[taskID] = now
	m.mu.Unlock()

	ports, err := m.scanner.ListListeningPorts(ctx)
	if err != nil {
		return nil, err
	}
	filtered := normalizePorts(ports, m.minPort)
	set := make(map[int]struct{}, len(filtered))
	for _, p := range filtered {
		set[p] = struct{}{}
	}

	m.mu.Lock()
	m.listenCache = set
	m.listenCacheAt = now
	m.mu.Unlock()

	updated := 0
	for _, p := range filtered {
		if m.upsert(taskID, p, sourceScan) {
			updated++
		}
	}

	return &ScanResult{
		ScannedAt:          now,
		PortsFound:         filtered,
		SuggestionsUpdated: updated,
	}, nil
}

// ListTask returns current suggestions for a task.
func (m *Manager) ListTask(taskID string) []Suggestion {
	now := time.Now()

	m.mu.Lock()
	defer m.mu.Unlock()

	taskSuggestions := m.byTask[taskID]
	if len(taskSuggestions) == 0 {
		return nil
	}

	var out []Suggestion
	for port, state := range taskSuggestions {
		if now.Sub(state.LastSeenAt) > m.suggestionTTL {
			delete(taskSuggestions, port)
			continue
		}
		sources := make([]string, 0, len(state.Sources))
		if _, ok := state.Sources[sourceOutput]; ok {
			sources = append(sources, sourceOutput)
		}
		if _, ok := state.Sources[sourceScan]; ok {
			sources = append(sources, sourceScan)
		}
		out = append(out, Suggestion{
			Port:        state.Port,
			Sources:     sources,
			FirstSeenAt: state.FirstSeenAt,
			LastSeenAt:  state.LastSeenAt,
		})
	}
	if len(taskSuggestions) == 0 {
		delete(m.byTask, taskID)
	}

	sort.Slice(out, func(i, j int) bool { return out[i].Port < out[j].Port })
	return out
}

func (m *Manager) cleanupStale() {
	now := time.Now()

	m.mu.Lock()
	defer m.mu.Unlock()

	for taskID, suggestions := range m.byTask {
		for port, state := range suggestions {
			if now.Sub(state.LastSeenAt) > m.suggestionTTL {
				delete(suggestions, port)
			}
		}
		if len(suggestions) == 0 {
			delete(m.byTask, taskID)
		}
	}
}

func (m *Manager) upsert(taskID string, port int, source string) bool {
	now := time.Now()

	m.mu.Lock()
	defer m.mu.Unlock()

	taskSuggestions := m.byTask[taskID]
	if taskSuggestions == nil {
		taskSuggestions = make(map[int]*suggestionState)
		m.byTask[taskID] = taskSuggestions
	}

	state, ok := taskSuggestions[port]
	if !ok {
		taskSuggestions[port] = &suggestionState{
			Port:        port,
			Sources:     map[string]struct{}{source: {}},
			FirstSeenAt: now,
			LastSeenAt:  now,
		}
		return true
	}

	state.LastSeenAt = now
	if _, exists := state.Sources[source]; exists {
		return false
	}
	state.Sources[source] = struct{}{}
	return true
}

func (m *Manager) currentListeningSet(ctx context.Context, force bool) (map[int]struct{}, error) {
	now := time.Now()

	m.mu.Lock()
	if !force && len(m.listenCache) > 0 && now.Sub(m.listenCacheAt) < m.listenCacheTTL {
		cache := clonePortSet(m.listenCache)
		m.mu.Unlock()
		return cache, nil
	}
	m.mu.Unlock()

	timeoutCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	ports, err := m.scanner.ListListeningPorts(timeoutCtx)
	if err != nil {
		return nil, err
	}
	set := make(map[int]struct{}, len(ports))
	for _, p := range normalizePorts(ports, m.minPort) {
		set[p] = struct{}{}
	}

	m.mu.Lock()
	m.listenCache = set
	m.listenCacheAt = now
	m.mu.Unlock()

	return clonePortSet(set), nil
}

func extractPorts(line string) []int {
	var ports []int
	seen := map[int]struct{}{}
	for _, re := range []*regexp.Regexp{urlPortRe, hostPortRe, listeningRe, portEqualsRe} {
		matches := re.FindAllStringSubmatch(line, -1)
		for _, m := range matches {
			if len(m) < 2 {
				continue
			}
			p, err := strconv.Atoi(m[1])
			if err != nil {
				continue
			}
			if _, ok := seen[p]; ok {
				continue
			}
			seen[p] = struct{}{}
			ports = append(ports, p)
		}
	}
	return ports
}

func normalizePorts(ports []int, minPort int) []int {
	seen := map[int]struct{}{}
	out := make([]int, 0, len(ports))
	for _, p := range ports {
		if p < minPort || p > 65535 {
			continue
		}
		if _, ok := seen[p]; ok {
			continue
		}
		seen[p] = struct{}{}
		out = append(out, p)
	}
	sort.Ints(out)
	return out
}

func clonePortSet(in map[int]struct{}) map[int]struct{} {
	out := make(map[int]struct{}, len(in))
	for p := range in {
		out[p] = struct{}{}
	}
	return out
}
