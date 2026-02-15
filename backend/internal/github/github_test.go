package github

import "testing"

func TestIsWorktreeDeleteBranchFailure(t *testing.T) {
	tests := []struct {
		name   string
		output string
		want   bool
	}{
		{
			name: "matches gh local delete failure due to worktree",
			output: "failed to delete local branch track-user-activity: " +
				"failed to run git: error: cannot delete branch 'track-user-activity' " +
				"used by worktree at '/tmp/wt'",
			want: true,
		},
		{
			name:   "different merge failure",
			output: "GraphQL: Pull request is in clean status and cannot be merged",
			want:   false,
		},
		{
			name:   "local delete failure for checked out branch",
			output: "failed to delete local branch foo: branch is checked out",
			want:   true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isWorktreeDeleteBranchFailure(tt.output)
			if got != tt.want {
				t.Fatalf("isWorktreeDeleteBranchFailure()=%v, want %v", got, tt.want)
			}
		})
	}
}

func TestIsAlreadyMergedPRFailure(t *testing.T) {
	tests := []struct {
		name   string
		output string
		want   bool
	}{
		{
			name:   "already merged",
			output: "gh: Pull request org/repo#123 is already merged",
			want:   true,
		},
		{
			name:   "was merged",
			output: "pull request #123 was merged",
			want:   true,
		},
		{
			name: "already merged with branch-delete error",
			output: "gh pr merge: ! Pull request sellm-hq/sellm-app#83 was already merged " +
				"failed to delete local branch track-user-activity-on-analytics-engine: " +
				"failed to run git: error: cannot delete branch 'track-user-activity-on-analytics-engine' " +
				"used by worktree at '/home/codeburg/.codeburg/worktrees/sellm-app/track-user-activity-on-analytics-engine'",
			want: true,
		},
		{
			name:   "not merged yet",
			output: "pull request is not mergeable",
			want:   false,
		},
		{
			name:   "non-pr output",
			output: "already merged branch",
			want:   false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isAlreadyMergedPRFailure(tt.output)
			if got != tt.want {
				t.Fatalf("isAlreadyMergedPRFailure()=%v, want %v", got, tt.want)
			}
		})
	}
}
