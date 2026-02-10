package tmux

import (
	"bufio"
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
)

const (
	// SessionName is the main tmux session name for Codeburg
	SessionName = "codeburg"
)

// Manager handles tmux session operations
type Manager struct {
	mu sync.Mutex
}

// NewManager creates a new tmux manager
func NewManager() *Manager {
	return &Manager{}
}

// Available checks if tmux is installed and accessible
func (m *Manager) Available() bool {
	cmd := exec.Command("tmux", "-V")
	return cmd.Run() == nil
}

// EnsureSession ensures the main codeburg tmux session exists
func (m *Manager) EnsureSession() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	return m.ensureSessionLocked()
}

// WindowInfo contains information about a tmux window
type WindowInfo struct {
	Session string
	Window  string
	Pane    string
	Target  string // Full target string: session:window.pane
}

// CreateWindow creates a new window in the codeburg session
// Returns the window info including pane ID
func (m *Manager) CreateWindow(name string, workDir string) (*WindowInfo, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Ensure session exists first
	if err := m.ensureSessionLocked(); err != nil {
		return nil, err
	}

	// Create new window
	args := []string{"new-window", "-t", SessionName, "-n", name, "-P", "-F", "#{window_id}:#{pane_id}"}
	if workDir != "" {
		args = append(args, "-c", workDir)
	}

	cmd := exec.Command("tmux", args...)
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("create window: %w", err)
	}

	// Parse output: @window_id:%pane_id
	parts := strings.Split(strings.TrimSpace(string(output)), ":")
	if len(parts) != 2 {
		return nil, fmt.Errorf("unexpected tmux output: %s", output)
	}

	return &WindowInfo{
		Session: SessionName,
		Window:  parts[0],
		Pane:    parts[1],
		Target:  fmt.Sprintf("%s:%s.%s", SessionName, parts[0], parts[1]),
	}, nil
}

// DestroyWindow closes a tmux window
func (m *Manager) DestroyWindow(window string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	target := fmt.Sprintf("%s:%s", SessionName, window)
	cmd := exec.Command("tmux", "kill-window", "-t", target)
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("kill window: %s: %w", string(output), err)
	}

	return nil
}

// SendKeys sends keystrokes to a tmux pane
// This is how we send user input to the agent
func (m *Manager) SendKeys(target string, keys string, pressEnter bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	args := []string{"send-keys", "-t", target, keys}
	if pressEnter {
		args = append(args, "Enter")
	}

	cmd := exec.Command("tmux", args...)
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("send keys: %s: %w", string(output), err)
	}

	return nil
}

// SendKeysRaw sends literal keystrokes to a tmux pane (no extra Enter).
func (m *Manager) SendKeysRaw(target string, keys string) error {
	if keys == "" {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()

	args := []string{"send-keys", "-t", target, "-l", keys}
	cmd := exec.Command("tmux", args...)
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("send keys raw: %s: %w", string(output), err)
	}

	return nil
}

// SendSignal sends a signal to the process in a pane
func (m *Manager) SendSignal(target string, signal string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Get the pane PID
	cmd := exec.Command("tmux", "display-message", "-t", target, "-p", "#{pane_pid}")
	output, err := cmd.Output()
	if err != nil {
		return fmt.Errorf("get pane pid: %w", err)
	}

	pid := strings.TrimSpace(string(output))
	if pid == "" {
		return fmt.Errorf("no process in pane")
	}

	// Send signal
	killCmd := exec.Command("kill", "-"+signal, pid)
	if output, err := killCmd.CombinedOutput(); err != nil {
		return fmt.Errorf("send signal: %s: %w", string(output), err)
	}

	return nil
}

// CapturePane captures the current content of a pane
func (m *Manager) CapturePane(target string, lines int) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	args := []string{"capture-pane", "-t", target, "-p"}
	if lines > 0 {
		args = append(args, "-S", fmt.Sprintf("-%d", lines))
	}

	cmd := exec.Command("tmux", args...)
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("capture pane: %w", err)
	}

	return string(output), nil
}

// RunCommand runs a command in a new window and returns a channel for output
// The command runs in the specified working directory
func (m *Manager) RunCommand(windowName, workDir string, command string, args ...string) (*WindowInfo, <-chan string, error) {
	// Create window first
	info, err := m.CreateWindow(windowName, workDir)
	if err != nil {
		return nil, nil, err
	}

	// Build the full command
	fullCmd := command
	if len(args) > 0 {
		fullCmd = fmt.Sprintf("%s %s", command, strings.Join(args, " "))
	}

	// Send the command
	if err := m.SendKeys(info.Target, fullCmd, true); err != nil {
		m.DestroyWindow(info.Window)
		return nil, nil, err
	}

	// Start output capture goroutine
	outputChan := make(chan string, 100)
	go m.streamOutput(info.Target, outputChan)

	return info, outputChan, nil
}

// streamOutput continuously captures pane output and sends to channel
func (m *Manager) streamOutput(target string, output chan<- string) {
	defer close(output)

	lastContent := ""
	for {
		content, err := m.CapturePane(target, 1000)
		if err != nil {
			return // Pane probably closed
		}

		// Only send new content
		if content != lastContent && len(content) > len(lastContent) {
			newContent := content[len(lastContent):]
			if newContent != "" {
				output <- newContent
			}
			lastContent = content
		}
	}
}

// PipeOutput creates a pipe to capture real-time output from a pane
// Returns a reader that can be used to stream output
func (m *Manager) PipeOutput(target string) (*bufio.Reader, func(), error) {
	// Use tmux pipe-pane to redirect output into a FIFO and stream it.
	// This avoids attaching a tmux client and prevents drift between windows.

	tmpDir, err := os.MkdirTemp("", "codeburg-pipe-")
	if err != nil {
		return nil, nil, fmt.Errorf("create temp dir: %w", err)
	}
	fifoPath := filepath.Join(tmpDir, "pane.fifo")
	if err := syscall.Mkfifo(fifoPath, 0600); err != nil {
		os.RemoveAll(tmpDir)
		return nil, nil, fmt.Errorf("mkfifo: %w", err)
	}

	// Start piping pane output into the FIFO (tmux runs command via shell).
	pipeCmd := fmt.Sprintf("cat > %s", fifoPath)
	if err := exec.Command("tmux", "pipe-pane", "-t", target, "-O", pipeCmd).Run(); err != nil {
		os.RemoveAll(tmpDir)
		return nil, nil, fmt.Errorf("start pipe-pane: %w", err)
	}

	// Open FIFO for reading (blocks until a writer connects).
	fifo, err := os.OpenFile(fifoPath, os.O_RDONLY, 0600)
	if err != nil {
		exec.Command("tmux", "pipe-pane", "-t", target).Run()
		os.RemoveAll(tmpDir)
		return nil, nil, fmt.Errorf("open fifo: %w", err)
	}

	cleanup := func() {
		exec.Command("tmux", "pipe-pane", "-t", target).Run()
		fifo.Close()
		os.RemoveAll(tmpDir)
	}

	return bufio.NewReader(fifo), cleanup, nil
}

// ListWindows lists all windows in the codeburg session
func (m *Manager) ListWindows() ([]WindowInfo, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	cmd := exec.Command("tmux", "list-windows", "-t", SessionName, "-F", "#{window_id}:#{window_name}:#{pane_id}")
	output, err := cmd.Output()
	if err != nil {
		// Session might not exist
		return nil, nil
	}

	var windows []WindowInfo
	scanner := bufio.NewScanner(bytes.NewReader(output))
	for scanner.Scan() {
		parts := strings.SplitN(scanner.Text(), ":", 3)
		if len(parts) == 3 {
			windows = append(windows, WindowInfo{
				Session: SessionName,
				Window:  parts[0],
				Pane:    parts[2],
				Target:  fmt.Sprintf("%s:%s.%s", SessionName, parts[0], parts[2]),
			})
		}
	}

	return windows, scanner.Err()
}

// WindowExists checks if a window exists
func (m *Manager) WindowExists(window string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()

	target := fmt.Sprintf("%s:%s", SessionName, window)
	cmd := exec.Command("tmux", "has-session", "-t", target)
	return cmd.Run() == nil
}

// TargetExists checks if a fully-qualified tmux target (e.g. "codeburg:@4.%5") exists
func (m *Manager) TargetExists(target string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()

	cmd := exec.Command("tmux", "has-session", "-t", target)
	return cmd.Run() == nil
}

// ensureSessionLocked ensures the session exists (must be called with lock held)
func (m *Manager) ensureSessionLocked() error {
	cmd := exec.Command("tmux", "has-session", "-t", SessionName)
	if cmd.Run() == nil {
		return nil
	}

	// Create new session (detached)
	cmd = exec.Command("tmux", "new-session", "-d", "-s", SessionName)
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("create tmux session: %s: %w", string(output), err)
	}

	// Enable mouse mode so scroll wheel enters copy-mode for scrollback
	// instead of being converted to arrow key sequences
	cmd = exec.Command("tmux", "set-option", "-t", SessionName, "mouse", "on")
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("set mouse option: %s: %w", string(output), err)
	}

	return nil
}
