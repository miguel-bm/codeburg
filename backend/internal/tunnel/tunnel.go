package tunnel

import (
	"bufio"
	"context"
	"fmt"
	"os/exec"
	"regexp"
	"sync"
)

// Tunnel represents an active cloudflared tunnel
type Tunnel struct {
	ID       string
	TaskID   string
	Port     int
	URL      string
	Cmd      *exec.Cmd
	Cancel   context.CancelFunc
	mu       sync.Mutex
	stopped  bool
}

// Manager manages cloudflared tunnels
type Manager struct {
	tunnels map[string]*Tunnel
	mu      sync.RWMutex
}

// NewManager creates a new tunnel manager
func NewManager() *Manager {
	return &Manager{
		tunnels: make(map[string]*Tunnel),
	}
}

// Available checks if cloudflared is installed
func (m *Manager) Available() bool {
	cmd := exec.Command("cloudflared", "--version")
	return cmd.Run() == nil
}

// Create starts a new cloudflared tunnel
func (m *Manager) Create(id, taskID string, port int) (*Tunnel, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Check if tunnel already exists for this ID
	if existing, ok := m.tunnels[id]; ok {
		return existing, nil
	}

	ctx, cancel := context.WithCancel(context.Background())

	// Start cloudflared tunnel
	cmd := exec.CommandContext(ctx, "cloudflared", "tunnel", "--url", fmt.Sprintf("http://localhost:%d", port))

	// Get stderr to capture the URL
	stderr, err := cmd.StderrPipe()
	if err != nil {
		cancel()
		return nil, fmt.Errorf("create stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		cancel()
		return nil, fmt.Errorf("start cloudflared: %w", err)
	}

	tunnel := &Tunnel{
		ID:     id,
		TaskID: taskID,
		Port:   port,
		Cmd:    cmd,
		Cancel: cancel,
	}

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
		}
	}()

	// Wait for URL with timeout
	select {
	case url := <-urlChan:
		tunnel.URL = url
	case err := <-errChan:
		cmd.Process.Kill()
		cancel()
		return nil, fmt.Errorf("read cloudflared output: %w", err)
	case <-ctx.Done():
		cmd.Process.Kill()
		cancel()
		return nil, fmt.Errorf("context cancelled")
	}

	m.tunnels[id] = tunnel

	// Monitor tunnel and clean up on exit
	go func() {
		cmd.Wait()
		m.mu.Lock()
		delete(m.tunnels, id)
		m.mu.Unlock()
	}()

	return tunnel, nil
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

// ListForTask returns all tunnels for a specific task
func (m *Manager) ListForTask(taskID string) []*Tunnel {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var tunnels []*Tunnel
	for _, t := range m.tunnels {
		if t.TaskID == taskID {
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
	delete(m.tunnels, id)
	m.mu.Unlock()

	tunnel.mu.Lock()
	defer tunnel.mu.Unlock()

	if tunnel.stopped {
		return nil
	}
	tunnel.stopped = true

	tunnel.Cancel()
	if tunnel.Cmd.Process != nil {
		tunnel.Cmd.Process.Kill()
	}

	return nil
}

// StopAll stops all tunnels
func (m *Manager) StopAll() {
	m.mu.Lock()
	tunnels := make([]*Tunnel, 0, len(m.tunnels))
	for _, t := range m.tunnels {
		tunnels = append(tunnels, t)
	}
	m.tunnels = make(map[string]*Tunnel)
	m.mu.Unlock()

	for _, t := range tunnels {
		t.mu.Lock()
		if !t.stopped {
			t.stopped = true
			t.Cancel()
			if t.Cmd.Process != nil {
				t.Cmd.Process.Kill()
			}
		}
		t.mu.Unlock()
	}
}

// TunnelInfo is a serializable representation of a tunnel
type TunnelInfo struct {
	ID     string `json:"id"`
	TaskID string `json:"taskId"`
	Port   int    `json:"port"`
	URL    string `json:"url"`
}

// Info returns the serializable info for a tunnel
func (t *Tunnel) Info() TunnelInfo {
	return TunnelInfo{
		ID:     t.ID,
		TaskID: t.TaskID,
		Port:   t.Port,
		URL:    t.URL,
	}
}
