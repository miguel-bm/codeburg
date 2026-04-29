package tunnel

import (
	"bufio"
	"context"
	"fmt"
	"os/exec"
	"regexp"
	"sync"
	"time"
)

const startupTimeout = 20 * time.Second

type Status string

const (
	StatusStarting Status = "starting"
	StatusActive   Status = "active"
	StatusStopping Status = "stopping"
	StatusFailed   Status = "failed"
)

// Tunnel represents an active cloudflared tunnel
type Tunnel struct {
	ID          string
	WorkspaceID string
	ProjectID   string
	Port        int
	URL         string
	Status      Status
	CreatedAt   time.Time
	Cmd         *exec.Cmd
	Cancel      context.CancelFunc
	mu          sync.Mutex
	stopped     bool
}

// Manager manages cloudflared tunnels
type Manager struct {
	tunnels map[string]*Tunnel
	ports   map[int]string // port -> tunnel ID
	mu      sync.RWMutex
}

// NewManager creates a new tunnel manager
func NewManager() *Manager {
	return &Manager{
		tunnels: make(map[string]*Tunnel),
		ports:   make(map[int]string),
	}
}

// PortConflictError indicates the requested port is already tunneled.
type PortConflictError struct {
	Port     int
	Existing TunnelInfo
}

func (e *PortConflictError) Error() string {
	return fmt.Sprintf("port %d already tunneled", e.Port)
}

// Available checks if cloudflared is installed
func (m *Manager) Available() bool {
	cmd := exec.Command("cloudflared", "--version")
	return cmd.Run() == nil
}

// Create starts a new cloudflared tunnel for a workspace.
func (m *Manager) Create(id, workspaceID, projectID string, port int) (*Tunnel, error) {
	m.mu.Lock()

	if existing, ok := m.tunnels[id]; ok {
		m.mu.Unlock()
		return existing, nil
	}
	if existingID, ok := m.ports[port]; ok {
		if existingTunnel, exists := m.tunnels[existingID]; exists {
			m.mu.Unlock()
			return nil, &PortConflictError{
				Port:     port,
				Existing: existingTunnel.Info(),
			}
		}
		delete(m.ports, port)
	}

	ctx, cancel := context.WithCancel(context.Background())
	tunnel := &Tunnel{
		ID:          id,
		WorkspaceID: workspaceID,
		ProjectID:   projectID,
		Port:        port,
		Status:      StatusStarting,
		CreatedAt:   time.Now().UTC(),
		Cancel:      cancel,
	}
	m.tunnels[id] = tunnel
	m.ports[port] = id
	m.mu.Unlock()

	// Get stderr to capture the URL
	cmd := exec.CommandContext(ctx, "cloudflared", "tunnel", "--url", fmt.Sprintf("http://localhost:%d", port))
	stderr, err := cmd.StderrPipe()
	if err != nil {
		cancel()
		m.remove(id)
		return nil, fmt.Errorf("create stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		cancel()
		m.remove(id)
		return nil, fmt.Errorf("start cloudflared: %w", err)
	}

	tunnel.mu.Lock()
	tunnel.Cmd = cmd
	tunnel.mu.Unlock()

	// Parse URL from cloudflared output
	// URL appears in format: "INF | https://something.trycloudflare.com"
	urlChan := make(chan string, 1)
	errChan := make(chan error, 1)

	go func() {
		scanner := bufio.NewScanner(stderr)
		urlRegex := regexp.MustCompile(`https://[a-zA-Z0-9-]+\.trycloudflare\.com`)

		for scanner.Scan() {
			line := scanner.Text()
			if match := urlRegex.FindString(line); match != "" {
				urlChan <- match
				return
			}
		}
		if err := scanner.Err(); err != nil {
			errChan <- err
			return
		}
		errChan <- fmt.Errorf("cloudflared exited before announcing tunnel URL")
	}()

	timer := time.NewTimer(startupTimeout)
	defer timer.Stop()

	select {
	case url := <-urlChan:
		tunnel.mu.Lock()
		tunnel.URL = url
		tunnel.Status = StatusActive
		tunnel.mu.Unlock()
	case err := <-errChan:
		_ = cmd.Process.Kill()
		cancel()
		m.remove(id)
		return nil, fmt.Errorf("read cloudflared output: %w", err)
	case <-ctx.Done():
		_ = cmd.Process.Kill()
		cancel()
		m.remove(id)
		return nil, fmt.Errorf("context cancelled")
	case <-timer.C:
		_ = cmd.Process.Kill()
		cancel()
		m.remove(id)
		return nil, fmt.Errorf("timed out waiting for cloudflared URL")
	}

	// Monitor tunnel and clean up on exit
	go func() {
		_ = cmd.Wait()
		m.mu.Lock()
		if current, ok := m.tunnels[id]; ok && current == tunnel {
			delete(m.ports, port)
			delete(m.tunnels, id)
		}
		m.mu.Unlock()
	}()

	return tunnel, nil
}

func (m *Manager) remove(id string) {
	m.mu.Lock()
	tunnel, ok := m.tunnels[id]
	if ok {
		delete(m.ports, tunnel.Port)
		delete(m.tunnels, id)
	}
	m.mu.Unlock()
}

// Get returns a tunnel by ID
func (m *Manager) Get(id string) *Tunnel {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.tunnels[id]
}

// List returns all active tunnels
func (m *Manager) List() []*Tunnel {
	m.mu.RLock()
	defer m.mu.RUnlock()

	tunnels := make([]*Tunnel, 0, len(m.tunnels))
	for _, t := range m.tunnels {
		tunnels = append(tunnels, t)
	}
	return tunnels
}

// ListForWorkspace returns all tunnels for a specific workspace.
func (m *Manager) ListForWorkspace(workspaceID string) []*Tunnel {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var tunnels []*Tunnel
	for _, t := range m.tunnels {
		if t.WorkspaceID == workspaceID {
			tunnels = append(tunnels, t)
		}
	}
	return tunnels
}

// Stop stops a tunnel by ID
func (m *Manager) Stop(id string) error {
	m.mu.Lock()
	tunnel, ok := m.tunnels[id]
	if !ok {
		m.mu.Unlock()
		return nil
	}
	delete(m.ports, tunnel.Port)
	delete(m.tunnels, id)
	m.mu.Unlock()

	tunnel.mu.Lock()
	defer tunnel.mu.Unlock()

	if tunnel.stopped {
		return nil
	}
	tunnel.stopped = true
	tunnel.Status = StatusStopping

	tunnel.Cancel()
	if tunnel.Cmd != nil && tunnel.Cmd.Process != nil {
		_ = tunnel.Cmd.Process.Kill()
	}

	return nil
}

// StopForWorkspace stops all active tunnels owned by a workspace.
func (m *Manager) StopForWorkspace(workspaceID string) {
	m.mu.RLock()
	var ids []string
	for _, t := range m.tunnels {
		if t.WorkspaceID == workspaceID {
			ids = append(ids, t.ID)
		}
	}
	m.mu.RUnlock()

	for _, id := range ids {
		_ = m.Stop(id)
	}
}

// StopAll stops all tunnels
func (m *Manager) StopAll() {
	m.mu.Lock()
	tunnels := make([]*Tunnel, 0, len(m.tunnels))
	for _, t := range m.tunnels {
		tunnels = append(tunnels, t)
	}
	m.tunnels = make(map[string]*Tunnel)
	m.ports = make(map[int]string)
	m.mu.Unlock()

	for _, t := range tunnels {
		t.mu.Lock()
		if !t.stopped {
			t.stopped = true
			t.Status = StatusStopping
			t.Cancel()
			if t.Cmd != nil && t.Cmd.Process != nil {
				_ = t.Cmd.Process.Kill()
			}
		}
		t.mu.Unlock()
	}
}

// FindByPort returns a copy of tunnel info for the given port, if present.
func (m *Manager) FindByPort(port int) *TunnelInfo {
	m.mu.RLock()
	defer m.mu.RUnlock()

	id, ok := m.ports[port]
	if !ok {
		return nil
	}
	t, exists := m.tunnels[id]
	if !exists {
		return nil
	}
	info := t.Info()
	return &info
}

// TunnelInfo is a serializable representation of a tunnel
type TunnelInfo struct {
	ID          string    `json:"id"`
	WorkspaceID string    `json:"workspaceId"`
	ProjectID   string    `json:"projectId"`
	Port        int       `json:"port"`
	URL         string    `json:"url"`
	Status      Status    `json:"status"`
	CreatedAt   time.Time `json:"createdAt"`
}

// Info returns the serializable info for a tunnel
func (t *Tunnel) Info() TunnelInfo {
	t.mu.Lock()
	defer t.mu.Unlock()

	return TunnelInfo{
		ID:          t.ID,
		WorkspaceID: t.WorkspaceID,
		ProjectID:   t.ProjectID,
		Port:        t.Port,
		URL:         t.URL,
		Status:      t.Status,
		CreatedAt:   t.CreatedAt,
	}
}
