package portscan

import (
	"context"
	"errors"
	"testing"
)

func TestParseLsofOutput(t *testing.T) {
	out := []byte(`COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME
node    12345 dev   19u  IPv4 0x01      0t0  TCP *:5173 (LISTEN)
postgres 999 dev   17u  IPv4 0x02      0t0  TCP 127.0.0.1:5432 (LISTEN)
`)
	ports := parseLsofOutput(out)
	got := dedupeAndSortPorts(ports)
	if len(got) != 2 || got[0] != 5173 || got[1] != 5432 {
		t.Fatalf("unexpected ports: %#v", got)
	}
}

func TestParseSSOutput(t *testing.T) {
	out := []byte(`LISTEN 0      4096    127.0.0.1:8080      0.0.0.0:*
LISTEN 0      4096         [::]:3000         [::]:*
`)
	ports := parseSSOutput(out)
	got := dedupeAndSortPorts(ports)
	if len(got) != 2 || got[0] != 3000 || got[1] != 8080 {
		t.Fatalf("unexpected ports: %#v", got)
	}
}

func TestListListeningPorts_UsesFirstAvailableCommand(t *testing.T) {
	scanner := &Scanner{
		lookPath: func(file string) (string, error) {
			if file == "lsof" {
				return "/usr/bin/lsof", nil
			}
			return "", errors.New("not found")
		},
		run: func(_ context.Context, name string, args ...string) ([]byte, error) {
			if name != "lsof" {
				t.Fatalf("unexpected command: %s", name)
			}
			return []byte("node 123 dev 19u IPv4 0x01 0t0 TCP *:5173 (LISTEN)\n"), nil
		},
	}

	ports, err := scanner.ListListeningPorts(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(ports) != 1 || ports[0] != 5173 {
		t.Fatalf("unexpected ports: %#v", ports)
	}
}
