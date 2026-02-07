package gitclone

import "testing"

func TestIsGitHubURL(t *testing.T) {
	tests := []struct {
		input string
		want  bool
	}{
		{"https://github.com/user/repo", true},
		{"https://github.com/user/repo.git", true},
		{"http://github.com/user/repo", true},
		{"git@github.com:user/repo.git", true},
		{"/home/user/projects/myrepo", false},
		{"https://gitlab.com/user/repo", false},
		{"", false},
		{"github.com/user/repo", false},
		{"  https://github.com/user/repo  ", true},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := IsGitHubURL(tt.input)
			if got != tt.want {
				t.Errorf("IsGitHubURL(%q) = %v, want %v", tt.input, got, tt.want)
			}
		})
	}
}

func TestParseRepoName(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"https://github.com/user/repo", "repo"},
		{"https://github.com/user/repo.git", "repo"},
		{"https://github.com/user/my-project.git", "my-project"},
		{"https://github.com/org/repo/", "repo"},
		{"git@github.com:user/repo.git", "repo"},
		{"https://github.com/user/repo.git/", "repo"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := ParseRepoName(tt.input)
			if got != tt.want {
				t.Errorf("ParseRepoName(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestNormalizeGitHubURL(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"https://github.com/user/repo", "https://github.com/user/repo.git"},
		{"https://github.com/user/repo.git", "https://github.com/user/repo.git"},
		{"https://github.com/user/repo/", "https://github.com/user/repo.git"},
		{"  https://github.com/user/repo  ", "https://github.com/user/repo.git"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := NormalizeGitHubURL(tt.input)
			if got != tt.want {
				t.Errorf("NormalizeGitHubURL(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}
