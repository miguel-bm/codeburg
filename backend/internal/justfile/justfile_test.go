package justfile

import (
	"testing"
)

func TestParseJustList_BasicRecipes(t *testing.T) {
	input := []byte(`Available recipes:
    build
    test
    deploy
`)

	mgr := NewManager()
	recipes := mgr.parseJustList(input)

	if len(recipes) != 3 {
		t.Fatalf("expected 3 recipes, got %d", len(recipes))
	}

	expected := []string{"build", "test", "deploy"}
	for i, name := range expected {
		if recipes[i].Name != name {
			t.Errorf("recipe %d: expected name %q, got %q", i, name, recipes[i].Name)
		}
		if recipes[i].Description != "" {
			t.Errorf("recipe %d: expected empty description, got %q", i, recipes[i].Description)
		}
		if recipes[i].Args != "" {
			t.Errorf("recipe %d: expected empty args, got %q", i, recipes[i].Args)
		}
	}
}

func TestParseJustList_WithDescriptions(t *testing.T) {
	input := []byte(`Available recipes:
    build  # Build the project
    test   # Run tests
    deploy # Deploy to production
`)

	mgr := NewManager()
	recipes := mgr.parseJustList(input)

	if len(recipes) != 3 {
		t.Fatalf("expected 3 recipes, got %d", len(recipes))
	}

	tests := []struct {
		name string
		desc string
	}{
		{"build", "Build the project"},
		{"test", "Run tests"},
		{"deploy", "Deploy to production"},
	}

	for i, tt := range tests {
		if recipes[i].Name != tt.name {
			t.Errorf("recipe %d: expected name %q, got %q", i, tt.name, recipes[i].Name)
		}
		if recipes[i].Description != tt.desc {
			t.Errorf("recipe %d: expected desc %q, got %q", i, tt.desc, recipes[i].Description)
		}
	}
}

func TestParseJustList_WithArgs(t *testing.T) {
	input := []byte(`Available recipes:
    build target
    test filter pattern # Run filtered tests
    deploy env region   # Deploy to env
`)

	mgr := NewManager()
	recipes := mgr.parseJustList(input)

	if len(recipes) != 3 {
		t.Fatalf("expected 3 recipes, got %d", len(recipes))
	}

	if recipes[0].Name != "build" {
		t.Errorf("expected name 'build', got %q", recipes[0].Name)
	}
	if recipes[0].Args != "target" {
		t.Errorf("expected args 'target', got %q", recipes[0].Args)
	}

	if recipes[1].Name != "test" {
		t.Errorf("expected name 'test', got %q", recipes[1].Name)
	}
	if recipes[1].Args != "filter pattern" {
		t.Errorf("expected args 'filter pattern', got %q", recipes[1].Args)
	}
	if recipes[1].Description != "Run filtered tests" {
		t.Errorf("expected desc 'Run filtered tests', got %q", recipes[1].Description)
	}

	if recipes[2].Name != "deploy" {
		t.Errorf("expected name 'deploy', got %q", recipes[2].Name)
	}
	if recipes[2].Args != "env region" {
		t.Errorf("expected args 'env region', got %q", recipes[2].Args)
	}
}

func TestParseJustList_EmptyOutput(t *testing.T) {
	mgr := NewManager()

	recipes := mgr.parseJustList([]byte(""))
	if len(recipes) != 0 {
		t.Errorf("expected 0 recipes, got %d", len(recipes))
	}
}

func TestParseJustList_HeaderOnly(t *testing.T) {
	mgr := NewManager()

	recipes := mgr.parseJustList([]byte("Available recipes:\n"))
	if len(recipes) != 0 {
		t.Errorf("expected 0 recipes, got %d", len(recipes))
	}
}

func TestParseJustList_BlankLines(t *testing.T) {
	input := []byte(`Available recipes:

    build

    test

`)

	mgr := NewManager()
	recipes := mgr.parseJustList(input)

	if len(recipes) != 2 {
		t.Fatalf("expected 2 recipes, got %d", len(recipes))
	}
	if recipes[0].Name != "build" {
		t.Errorf("expected 'build', got %q", recipes[0].Name)
	}
	if recipes[1].Name != "test" {
		t.Errorf("expected 'test', got %q", recipes[1].Name)
	}
}

func TestParseJustList_DescriptionWithSpecialChars(t *testing.T) {
	input := []byte(`Available recipes:
    build # Build (debug & release) - fast!
`)

	mgr := NewManager()
	recipes := mgr.parseJustList(input)

	if len(recipes) != 1 {
		t.Fatalf("expected 1 recipe, got %d", len(recipes))
	}
	if recipes[0].Description != "Build (debug & release) - fast!" {
		t.Errorf("expected special chars in description, got %q", recipes[0].Description)
	}
}

func TestParseJustList_MultipleHashInDescription(t *testing.T) {
	// The parser uses strings.Index which finds the FIRST #
	input := []byte(`Available recipes:
    build # Build # with hashes
`)

	mgr := NewManager()
	recipes := mgr.parseJustList(input)

	if len(recipes) != 1 {
		t.Fatalf("expected 1 recipe, got %d", len(recipes))
	}
	if recipes[0].Description != "Build # with hashes" {
		t.Errorf("expected 'Build # with hashes', got %q", recipes[0].Description)
	}
}
