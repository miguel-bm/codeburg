package ptyruntime

import (
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"
	"time"

	"github.com/creack/pty"
)

var (
	ErrSessionNotFound = errors.New("runtime session not found")
	ErrSessionExists   = errors.New("runtime session already exists")
)

// StartOptions configures a runtime PTY process.
type StartOptions struct {
	WorkDir string
	Command string
	Args    []string
	Env     []string
	Cols    uint16
	Rows    uint16
	OnExit  func(ExitResult)
}

// ExitResult describes process termination.
type ExitResult struct {
	SessionID string
	ExitCode  int
	Err       error
}

// OutputEvent is a streamed chunk from the process PTY.
type OutputEvent struct {
	Seq  uint64
	Data []byte
}

// Manager owns runtime sessions.
type Manager struct {
	mu       sync.RWMutex
	sessions map[string]*runtimeSession
}

// NewManager creates a runtime manager.
func NewManager() *Manager {
	return &Manager{
		sessions: make(map[string]*runtimeSession),
	}
}

type runtimeSession struct {
	id     string
	cmd    *exec.Cmd
	ptmx   *os.File
	onExit func(ExitResult)

	mu         sync.Mutex
	closed     bool
	seq        uint64
	ring       []OutputEvent
	ringBytes  int
	subs       map[uint64]chan OutputEvent
	nextSubID  uint64
	lastOutput time.Time
}

const (
	defaultCols   = 120
	defaultRows   = 40
	maxRingBytes  = 2 * 1024 * 1024
	subBufferSize = 256
)

// Start creates and starts a runtime session process.
func (m *Manager) Start(sessionID string, opt StartOptions) error {
	if sessionID == "" {
		return fmt.Errorf("session id is required")
	}
	if opt.Command == "" {
		return fmt.Errorf("command is required")
	}

	m.mu.Lock()
	if _, exists := m.sessions[sessionID]; exists {
		m.mu.Unlock()
		return ErrSessionExists
	}

	cmd := exec.Command(opt.Command, opt.Args...)
	if opt.WorkDir != "" {
		cmd.Dir = opt.WorkDir
	}
	if len(opt.Env) > 0 {
		cmd.Env = append(os.Environ(), opt.Env...)
	}

	cols := opt.Cols
	rows := opt.Rows
	if cols == 0 {
		cols = defaultCols
	}
	if rows == 0 {
		rows = defaultRows
	}

	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: cols, Rows: rows})
	if err != nil {
		m.mu.Unlock()
		return fmt.Errorf("start pty: %w", err)
	}

	rs := &runtimeSession{
		id:     sessionID,
		cmd:    cmd,
		ptmx:   ptmx,
		onExit: opt.OnExit,
		subs:   make(map[uint64]chan OutputEvent),
	}
	m.sessions[sessionID] = rs
	m.mu.Unlock()

	go m.readLoop(rs)
	go m.waitLoop(rs)
	return nil
}

func (m *Manager) readLoop(rs *runtimeSession) {
	buf := make([]byte, 8192)
	for {
		n, err := rs.ptmx.Read(buf)
		if n > 0 {
			rs.appendOutput(buf[:n])
		}
		if err != nil {
			if err != io.EOF {
				// Process wait loop handles lifecycle; read errors are expected on shutdown.
			}
			return
		}
	}
}

func exitCodeFromErr(err error) int {
	if err == nil {
		return 0
	}
	var ee *exec.ExitError
	if errors.As(err, &ee) {
		return ee.ExitCode()
	}
	return -1
}

func (m *Manager) waitLoop(rs *runtimeSession) {
	err := rs.cmd.Wait()
	code := exitCodeFromErr(err)

	rs.mu.Lock()
	if rs.closed {
		rs.mu.Unlock()
		return
	}
	rs.closed = true
	if rs.ptmx != nil {
		_ = rs.ptmx.Close()
	}
	for id, ch := range rs.subs {
		close(ch)
		delete(rs.subs, id)
	}
	rs.mu.Unlock()

	m.mu.Lock()
	delete(m.sessions, rs.id)
	m.mu.Unlock()

	if rs.onExit != nil {
		rs.onExit(ExitResult{SessionID: rs.id, ExitCode: code, Err: err})
	}
}

func (rs *runtimeSession) appendOutput(data []byte) {
	if len(data) == 0 {
		return
	}

	// Copy to avoid retaining the shared read buffer.
	chunk := make([]byte, len(data))
	copy(chunk, data)

	rs.mu.Lock()
	if rs.closed {
		rs.mu.Unlock()
		return
	}
	rs.seq++
	ev := OutputEvent{Seq: rs.seq, Data: chunk}
	rs.ring = append(rs.ring, ev)
	rs.ringBytes += len(chunk)
	rs.lastOutput = time.Now()

	for rs.ringBytes > maxRingBytes && len(rs.ring) > 0 {
		rs.ringBytes -= len(rs.ring[0].Data)
		rs.ring = rs.ring[1:]
	}

	for subID, ch := range rs.subs {
		select {
		case ch <- ev:
		default:
			// Slow consumer: disconnect to protect runtime fanout.
			close(ch)
			delete(rs.subs, subID)
		}
	}
	rs.mu.Unlock()
}

// Attach subscribes to runtime output and returns recent replay chunks.
func (m *Manager) Attach(sessionID string) ([]OutputEvent, <-chan OutputEvent, func(), error) {
	rs, err := m.get(sessionID)
	if err != nil {
		return nil, nil, nil, err
	}

	rs.mu.Lock()
	if rs.closed {
		rs.mu.Unlock()
		return nil, nil, nil, ErrSessionNotFound
	}

	snapshot := make([]OutputEvent, 0, len(rs.ring))
	for _, ev := range rs.ring {
		cp := make([]byte, len(ev.Data))
		copy(cp, ev.Data)
		snapshot = append(snapshot, OutputEvent{Seq: ev.Seq, Data: cp})
	}

	subID := rs.nextSubID
	rs.nextSubID++
	ch := make(chan OutputEvent, subBufferSize)
	rs.subs[subID] = ch
	rs.mu.Unlock()

	cancel := func() {
		rs.mu.Lock()
		if existing, ok := rs.subs[subID]; ok {
			close(existing)
			delete(rs.subs, subID)
		}
		rs.mu.Unlock()
	}

	return snapshot, ch, cancel, nil
}

// Write sends raw bytes into a session PTY.
func (m *Manager) Write(sessionID string, data []byte) error {
	rs, err := m.get(sessionID)
	if err != nil {
		return err
	}
	rs.mu.Lock()
	closed := rs.closed
	ptmx := rs.ptmx
	rs.mu.Unlock()
	if closed || ptmx == nil {
		return ErrSessionNotFound
	}
	_, err = ptmx.Write(data)
	return err
}

// Resize changes the PTY size for a session.
func (m *Manager) Resize(sessionID string, cols, rows uint16) error {
	rs, err := m.get(sessionID)
	if err != nil {
		return err
	}
	rs.mu.Lock()
	closed := rs.closed
	ptmx := rs.ptmx
	rs.mu.Unlock()
	if closed || ptmx == nil {
		return ErrSessionNotFound
	}
	if cols == 0 || rows == 0 {
		return nil
	}
	return pty.Setsize(ptmx, &pty.Winsize{Cols: cols, Rows: rows})
}

// Stop terminates a runtime session.
func (m *Manager) Stop(sessionID string) error {
	rs, err := m.get(sessionID)
	if err != nil {
		return err
	}
	rs.mu.Lock()
	if rs.closed {
		rs.mu.Unlock()
		return nil
	}
	proc := rs.cmd.Process
	rs.mu.Unlock()
	if proc == nil {
		return nil
	}
	return proc.Kill()
}

// Exists reports whether a session runtime is currently alive.
func (m *Manager) Exists(sessionID string) bool {
	m.mu.RLock()
	_, ok := m.sessions[sessionID]
	m.mu.RUnlock()
	return ok
}

func (m *Manager) get(sessionID string) (*runtimeSession, error) {
	m.mu.RLock()
	rs, ok := m.sessions[sessionID]
	m.mu.RUnlock()
	if !ok {
		return nil, ErrSessionNotFound
	}
	return rs, nil
}
