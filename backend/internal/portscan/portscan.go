package portscan

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os/exec"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

var (
	lsofPortRe      = regexp.MustCompile(`:([0-9]{1,5})(?:\b|->)`)
	addressPortRe   = regexp.MustCompile(`(?:\[[0-9a-fA-F:]+\]|[0-9a-fA-F:.]+|\*):([0-9]{1,5})`)
	errNoScannerCmd = errors.New("no supported scanner command available")
)

// Scanner discovers listening TCP ports on the host.
type Scanner struct {
	run      func(ctx context.Context, name string, args ...string) ([]byte, error)
	lookPath func(file string) (string, error)
}

// NewScanner creates a scanner using system commands.
func NewScanner() *Scanner {
	return &Scanner{
		run: func(ctx context.Context, name string, args ...string) ([]byte, error) {
			cmd := exec.CommandContext(ctx, name, args...)
			return cmd.CombinedOutput()
		},
		lookPath: exec.LookPath,
	}
}

// ListListeningPorts returns deduplicated listening TCP ports.
func (s *Scanner) ListListeningPorts(ctx context.Context) ([]int, error) {
	type strategy struct {
		name   string
		args   []string
		parser func([]byte) []int
	}

	strategies := []strategy{
		{name: "lsof", args: []string{"-nP", "-iTCP", "-sTCP:LISTEN"}, parser: parseLsofOutput},
		{name: "ss", args: []string{"-ltnH"}, parser: parseSSOutput},
		{name: "netstat", args: []string{"-ltn"}, parser: parseNetstatOutput},
	}

	var lastErr error = errNoScannerCmd
	for _, st := range strategies {
		if _, err := s.lookPath(st.name); err != nil {
			continue
		}
		out, err := s.run(ctx, st.name, st.args...)
		if err != nil {
			lastErr = fmt.Errorf("%s failed: %w", st.name, err)
			continue
		}

		ports := dedupeAndSortPorts(st.parser(out))
		return ports, nil
	}

	return nil, lastErr
}

func parseLsofOutput(out []byte) []int {
	var ports []int
	lines := bytes.Split(out, []byte{'\n'})
	for _, line := range lines {
		text := strings.TrimSpace(string(line))
		if text == "" || strings.HasPrefix(text, "COMMAND") {
			continue
		}
		matches := lsofPortRe.FindAllStringSubmatch(text, -1)
		for _, m := range matches {
			p, err := strconv.Atoi(m[1])
			if err == nil {
				ports = append(ports, p)
			}
		}
	}
	return ports
}

func parseSSOutput(out []byte) []int {
	return parseAddressPortOutput(out)
}

func parseNetstatOutput(out []byte) []int {
	return parseAddressPortOutput(out)
}

func parseAddressPortOutput(out []byte) []int {
	var ports []int
	lines := bytes.Split(out, []byte{'\n'})
	for _, line := range lines {
		text := strings.TrimSpace(string(line))
		if text == "" {
			continue
		}
		if strings.HasPrefix(text, "Proto") || strings.HasPrefix(text, "State") {
			continue
		}

		m := addressPortRe.FindStringSubmatch(text)
		if len(m) < 2 {
			continue
		}
		p, err := strconv.Atoi(m[1])
		if err == nil {
			ports = append(ports, p)
		}
	}
	return ports
}

func dedupeAndSortPorts(ports []int) []int {
	seen := make(map[int]struct{}, len(ports))
	out := make([]int, 0, len(ports))
	for _, p := range ports {
		if p <= 0 || p > 65535 {
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
