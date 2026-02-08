package worktree

import "testing"

func TestSlugify(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"Fix login bug", "fix-login-bug"},
		{"Add OAuth2 / OIDC support!!!", "add-oauth2-oidc-support"},
		{"", "task"},
		{"   ", "task"},
		{"---", "task"},
		{"Hello World", "hello-world"},
		{"multiple   spaces   here", "multiple-spaces-here"},
		{"special!@#$%chars", "special-chars"},
		{"UPPERCASE TITLE", "uppercase-title"},
		{"trailing-dash-", "trailing-dash"},
		{"-leading-dash", "leading-dash"},
		// 50 char truncation
		{"this is a very long title that should be truncated to fifty characters max", "this-is-a-very-long-title-that-should-be-truncated"},
		// Truncation should not leave trailing dash
		{"this is a very long title that should be truncated-to fifty characters", "this-is-a-very-long-title-that-should-be-truncated"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := Slugify(tt.input)
			if got != tt.want {
				t.Errorf("Slugify(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestShortID(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"01JMXYZ1234567890ABCDEFGH", "CDEFGH"},
		{"ABCDEF", "ABCDEF"},
		{"ABC", "ABC"},
		{"", ""},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := shortID(tt.input)
			if got != tt.want {
				t.Errorf("shortID(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}
