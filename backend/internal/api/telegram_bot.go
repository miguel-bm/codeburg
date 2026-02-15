package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/miguel-bm/codeburg/internal/db"
	"github.com/miguel-bm/codeburg/internal/telegram"
)

type telegramTaskView struct {
	ID          string `json:"id"`
	ProjectID   string `json:"projectId"`
	Project     string `json:"project"`
	Title       string `json:"title"`
	Status      string `json:"status"`
	HasWorktree bool   `json:"hasWorktree"`
}

type telegramProjectView struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	DefaultBranch string `json:"defaultBranch"`
}

type telegramSessionView struct {
	ID       string `json:"id"`
	TaskID   string `json:"taskId"`
	Provider string `json:"provider"`
	Status   string `json:"status"`
}

type telegramAssistantMemoryTurn struct {
	User      string
	Assistant string
}

const telegramAssistantMemoryPreferenceKey = "telegram_assistant_memory_v1"

func (s *Server) handleTelegramCommand(ctx context.Context, msg telegram.IncomingMessage) (string, error) {
	var (
		out string
		err error
	)

	switch msg.Command {
	case "help":
		out = strings.TrimSpace(`Commands:
/projects
/tasks [status]
/task <task-id>
/sessions [task-id]
/newtask <project-id-or-name> | <title>
/move <task-id> <backlog|in_progress|in_review|done>
/session <task-id> <claude|codex|terminal> [prompt]
/reply <session-id> <message>
/stage <task-id> [file1 file2 ...]
/commit <task-id> <message>
/push <task-id> [--force --yes]
/yeet <task-id> <commit message>
/stomp <task-id> --yes
/memory
/reset-memory

Non-command messages are handled by the LLM assistant.`)
	case "projects":
		out, err = s.telegramRenderProjectList(20)
	case "tasks":
		status := strings.TrimSpace(msg.Args)
		out, err = s.telegramRenderTaskList(status, 12)
	case "task":
		out, err = s.telegramRenderTaskDetail(strings.TrimSpace(msg.Args))
	case "sessions":
		out, err = s.telegramRenderSessionList(strings.TrimSpace(msg.Args), 12)
	case "newtask":
		out, err = s.telegramCommandCreateTask(strings.TrimSpace(msg.Args))
	case "move":
		out, err = s.telegramCommandMoveTask(strings.TrimSpace(msg.Args))
	case "session":
		out, err = s.telegramCommandStartSession(strings.TrimSpace(msg.Args))
	case "reply":
		out, err = s.telegramCommandReply(strings.TrimSpace(msg.Args))
	case "stage":
		out, err = s.telegramCommandStage(strings.TrimSpace(msg.Args))
	case "commit":
		out, err = s.telegramCommandCommit(strings.TrimSpace(msg.Args))
	case "push":
		out, err = s.telegramCommandPush(strings.TrimSpace(msg.Args))
	case "yeet":
		out, err = s.telegramCommandYeet(strings.TrimSpace(msg.Args))
	case "stomp":
		out, err = s.telegramCommandStomp(strings.TrimSpace(msg.Args))
	case "memory":
		out = s.telegramRenderAssistantMemory(msg.ChatID)
	case "reset-memory", "resetmemory":
		s.telegramResetAssistantMemory(msg.ChatID)
		out = "Assistant memory cleared for this Telegram chat."
	default:
		return `Unknown command. Use /help.`, nil
	}

	if err != nil {
		return s.telegramRenderCommandError(err), nil
	}
	return out, nil
}

func (s *Server) handleTelegramMessage(ctx context.Context, msg telegram.IncomingMessage) (string, error) {
	if msg.ReplyToMessageID != 0 {
		sessionID := s.telegramLookupReplySession(msg.ChatID, msg.ReplyToMessageID)
		if sessionID == "" {
			return "I couldn't map this reply to a session. Use /reply <session-id> <message>.", nil
		}
		return s.telegramSendReplyToSession(ctx, sessionID, msg)
	}
	reply, err := s.telegramRunAssistant(ctx, msg)
	if err != nil {
		return "I could not process that right now. Check Telegram LLM settings and try again.", nil
	}
	return reply, nil
}

func (s *Server) telegramRenderProjectList(limit int) (string, error) {
	projects, err := s.telegramListProjects(limit)
	if err != nil {
		return "", err
	}
	if len(projects) == 0 {
		return "No projects found.", nil
	}
	lines := make([]string, 0, len(projects)+1)
	lines = append(lines, "Projects:")
	for _, p := range projects {
		lines = append(lines, fmt.Sprintf("• %s (%s) [%s]", shortID(p.ID), p.Name, p.DefaultBranch))
	}
	return strings.Join(lines, "\n"), nil
}

func (s *Server) telegramRenderTaskList(status string, limit int) (string, error) {
	views, err := s.telegramListTasks(status, limit)
	if err != nil {
		return "", err
	}
	if len(views) == 0 {
		return "No tasks found.", nil
	}
	lines := make([]string, 0, len(views)+1)
	lines = append(lines, "Tasks:")
	for _, t := range views {
		w := ""
		if t.HasWorktree {
			w = " wt"
		}
		lines = append(lines, fmt.Sprintf("• %s [%s] (%s%s) %s", shortID(t.ID), t.Status, t.Project, w, t.Title))
	}
	return strings.Join(lines, "\n"), nil
}

func (s *Server) telegramRenderTaskDetail(taskRef string) (string, error) {
	if taskRef == "" {
		return "Usage: /task <task-id>", nil
	}
	task, err := s.resolveTaskRef(taskRef)
	if err != nil {
		return "", err
	}
	project, err := s.db.GetProject(task.ProjectID)
	if err != nil {
		return "", err
	}
	sessions, _ := s.db.ListSessionsByTask(task.ID)

	var b strings.Builder
	b.WriteString(fmt.Sprintf("%s\n", task.Title))
	b.WriteString(fmt.Sprintf("ID: %s\nProject: %s\nStatus: %s\n", task.ID, project.Name, task.Status))
	if task.WorktreePath != nil && *task.WorktreePath != "" {
		b.WriteString(fmt.Sprintf("Worktree: %s\n", *task.WorktreePath))
	}
	if task.Description != nil && strings.TrimSpace(*task.Description) != "" {
		b.WriteString("Description:\n")
		b.WriteString(strings.TrimSpace(*task.Description))
		b.WriteString("\n")
	}
	if len(sessions) > 0 {
		b.WriteString("Sessions:\n")
		maxSessions := 3
		if len(sessions) < maxSessions {
			maxSessions = len(sessions)
		}
		for i := 0; i < maxSessions; i++ {
			ss := sessions[i]
			b.WriteString(fmt.Sprintf("• %s %s (%s)\n", shortID(ss.ID), ss.Provider, ss.Status))
		}
	}
	return strings.TrimSpace(b.String()), nil
}

func (s *Server) telegramRenderSessionList(taskRef string, limit int) (string, error) {
	sessions, err := s.telegramListSessions(taskRef, limit)
	if err != nil {
		return "", err
	}
	if len(sessions) == 0 {
		return "No sessions found.", nil
	}
	lines := make([]string, 0, len(sessions)+1)
	lines = append(lines, "Sessions:")
	for _, ss := range sessions {
		task := ""
		if ss.TaskID != "" {
			task = " task:" + shortID(ss.TaskID)
		}
		lines = append(lines, fmt.Sprintf("• %s %s (%s%s)", shortID(ss.ID), ss.Provider, ss.Status, task))
	}
	return strings.Join(lines, "\n"), nil
}

func (s *Server) telegramCommandCreateTask(args string) (string, error) {
	parts := strings.SplitN(args, "|", 2)
	if len(parts) != 2 {
		return "Usage: /newtask <project-id-or-name> | <title>", nil
	}
	projectRef := strings.TrimSpace(parts[0])
	title := strings.TrimSpace(parts[1])
	if projectRef == "" || title == "" {
		return "Usage: /newtask <project-id-or-name> | <title>", nil
	}
	project, err := s.resolveProjectRef(projectRef)
	if err != nil {
		return "", err
	}
	task, err := s.db.CreateTask(db.CreateTaskInput{
		ProjectID: project.ID,
		Title:     title,
	})
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("Created task %s in %s: %s", shortID(task.ID), project.Name, task.Title), nil
}

func (s *Server) telegramCommandMoveTask(args string) (string, error) {
	fields := strings.Fields(args)
	if len(fields) < 2 {
		return "Usage: /move <task-id> <backlog|in_progress|in_review|done>", nil
	}
	status := db.TaskStatus(strings.ToLower(strings.TrimSpace(fields[1])))
	if !isTelegramValidTaskStatus(status) {
		return "Invalid status. Use backlog, in_progress, in_review, or done.", nil
	}
	task, err := s.resolveTaskRef(fields[0])
	if err != nil {
		return "", err
	}
	if _, err := s.db.UpdateTask(task.ID, db.UpdateTaskInput{Status: &status}); err != nil {
		return "", err
	}
	return fmt.Sprintf("Moved %s to %s.", shortID(task.ID), status), nil
}

func (s *Server) telegramCommandStartSession(args string) (string, error) {
	fields := strings.Fields(args)
	if len(fields) < 2 {
		return "Usage: /session <task-id> <claude|codex|terminal> [prompt]", nil
	}
	taskRef := fields[0]
	provider := strings.ToLower(fields[1])
	prompt := ""
	if len(fields) > 2 {
		prompt = strings.TrimSpace(strings.Join(fields[2:], " "))
	}
	task, err := s.resolveTaskRef(taskRef)
	if err != nil {
		return "", err
	}
	project, err := s.db.GetProject(task.ProjectID)
	if err != nil {
		return "", err
	}
	workDir := project.Path
	if task.WorktreePath != nil && *task.WorktreePath != "" {
		workDir = *task.WorktreePath
	}
	session, err := s.startSessionInternal(startSessionParams{
		ProjectID: project.ID,
		TaskID:    task.ID,
		WorkDir:   workDir,
	}, StartSessionRequest{
		Provider: provider,
		Prompt:   prompt,
	})
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("Started %s session %s for task %s.", provider, shortID(session.ID), shortID(task.ID)), nil
}

func (s *Server) telegramCommandReply(args string) (string, error) {
	parts := strings.SplitN(strings.TrimSpace(args), " ", 2)
	if len(parts) != 2 || strings.TrimSpace(parts[1]) == "" {
		return "Usage: /reply <session-id> <message>", nil
	}
	session, err := s.resolveSessionRef(parts[0])
	if err != nil {
		return "", err
	}
	content := strings.TrimSpace(parts[1])
	if session.SessionType == "chat" {
		if err := s.startChatTurn(session.ID, content, "telegram_reply"); err != nil {
			return "", err
		}
		return fmt.Sprintf("Sent message to chat session %s.", shortID(session.ID)), nil
	}
	if err := s.sessions.runtime.Write(session.ID, []byte(content+"\n")); err != nil {
		return "", err
	}
	return fmt.Sprintf("Sent message to terminal session %s.", shortID(session.ID)), nil
}

func (s *Server) telegramCommandYeet(args string) (string, error) {
	parts := strings.SplitN(strings.TrimSpace(args), " ", 2)
	if len(parts) != 2 || strings.TrimSpace(parts[1]) == "" {
		return "Usage: /yeet <task-id> <commit message>", nil
	}
	task, project, workDir, err := s.resolveTaskGitContext(parts[0])
	if err != nil {
		return "", err
	}
	if _, err := runGit(workDir, "add", "-A"); err != nil {
		return "", err
	}
	if _, err := runGit(workDir, "commit", "-m", strings.TrimSpace(parts[1])); err != nil {
		return "", err
	}
	if err := gitPushCurrentBranch(workDir, false); err != nil {
		return "", err
	}
	return fmt.Sprintf("Yeeted %s (%s).", shortID(task.ID), project.Name), nil
}

func (s *Server) telegramCommandStomp(args string) (string, error) {
	fields := strings.Fields(args)
	if len(fields) == 0 {
		return "Usage: /stomp <task-id> --yes", nil
	}
	taskRef := fields[0]
	if !telegramHasFlag(fields[1:], "--yes") {
		return "Stomp rewrites history and force-pushes. Re-run with /stomp <task-id> --yes", nil
	}
	task, project, workDir, err := s.resolveTaskGitContext(taskRef)
	if err != nil {
		return "", err
	}
	if _, err := runGit(workDir, "add", "-A"); err != nil {
		return "", err
	}
	if _, err := runGit(workDir, "commit", "--amend", "--no-edit"); err != nil {
		return "", err
	}
	if err := gitPushCurrentBranch(workDir, true); err != nil {
		return "", err
	}
	return fmt.Sprintf("Stomped %s (%s).", shortID(task.ID), project.Name), nil
}

func (s *Server) telegramCommandStage(args string) (string, error) {
	fields := strings.Fields(strings.TrimSpace(args))
	if len(fields) == 0 {
		return "Usage: /stage <task-id> [file1 file2 ...]", nil
	}
	task, _, workDir, err := s.resolveTaskGitContext(fields[0])
	if err != nil {
		return "", err
	}
	if len(fields) == 1 {
		if _, err := runGit(workDir, "add", "-A"); err != nil {
			return "", err
		}
		return fmt.Sprintf("Staged all changes for %s.", shortID(task.ID)), nil
	}
	argsAdd := []string{"add", "--"}
	argsAdd = append(argsAdd, fields[1:]...)
	if _, err := runGit(workDir, argsAdd...); err != nil {
		return "", err
	}
	return fmt.Sprintf("Staged %d file(s) for %s.", len(fields)-1, shortID(task.ID)), nil
}

func (s *Server) telegramCommandCommit(args string) (string, error) {
	parts := strings.SplitN(strings.TrimSpace(args), " ", 2)
	if len(parts) != 2 || strings.TrimSpace(parts[1]) == "" {
		return "Usage: /commit <task-id> <message>", nil
	}
	task, _, workDir, err := s.resolveTaskGitContext(parts[0])
	if err != nil {
		return "", err
	}
	if _, err := runGit(workDir, "commit", "-m", strings.TrimSpace(parts[1])); err != nil {
		return "", err
	}
	return fmt.Sprintf("Committed changes for %s.", shortID(task.ID)), nil
}

func (s *Server) telegramCommandPush(args string) (string, error) {
	fields := strings.Fields(strings.TrimSpace(args))
	if len(fields) == 0 {
		return "Usage: /push <task-id> [--force --yes]", nil
	}
	task, _, workDir, err := s.resolveTaskGitContext(fields[0])
	if err != nil {
		return "", err
	}
	force := telegramHasFlag(fields[1:], "--force")
	confirm := telegramHasFlag(fields[1:], "--yes")
	if force && !confirm {
		return "Force push is risky. Re-run with /push <task-id> --force --yes", nil
	}
	if err := gitPushCurrentBranch(workDir, force); err != nil {
		return "", err
	}
	if force {
		return fmt.Sprintf("Force-pushed branch for %s.", shortID(task.ID)), nil
	}
	return fmt.Sprintf("Pushed branch for %s.", shortID(task.ID)), nil
}

func (s *Server) resolveTaskGitContext(taskRef string) (*db.Task, *db.Project, string, error) {
	task, err := s.resolveTaskRef(taskRef)
	if err != nil {
		return nil, nil, "", err
	}
	if task.WorktreePath == nil || *task.WorktreePath == "" {
		return nil, nil, "", fmt.Errorf("task has no worktree")
	}
	project, err := s.db.GetProject(task.ProjectID)
	if err != nil {
		return nil, nil, "", err
	}
	return task, project, *task.WorktreePath, nil
}

func (s *Server) resolveProjectRef(ref string) (*db.Project, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return nil, fmt.Errorf("project ref is required")
	}
	projects, err := s.db.ListProjects()
	if err != nil {
		return nil, err
	}
	lower := strings.ToLower(ref)
	var exact []*db.Project
	var prefix []*db.Project
	var contains []*db.Project
	for _, p := range projects {
		if p.ID == ref || strings.EqualFold(p.Name, ref) {
			exact = append(exact, p)
			continue
		}
		if strings.HasPrefix(strings.ToLower(p.ID), lower) {
			prefix = append(prefix, p)
			continue
		}
		if strings.Contains(strings.ToLower(p.Name), lower) {
			contains = append(contains, p)
		}
	}
	switch {
	case len(exact) == 1:
		return exact[0], nil
	case len(exact) > 1:
		return nil, fmt.Errorf("ambiguous project reference")
	case len(prefix) == 1:
		return prefix[0], nil
	case len(prefix) > 1:
		return nil, fmt.Errorf("ambiguous project reference")
	case len(contains) == 1:
		return contains[0], nil
	case len(contains) > 1:
		return nil, fmt.Errorf("ambiguous project reference")
	default:
		return nil, fmt.Errorf("project not found")
	}
}

func (s *Server) resolveTaskRef(ref string) (*db.Task, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return nil, fmt.Errorf("task ref is required")
	}
	if t, err := s.db.GetTask(ref); err == nil {
		return t, nil
	}
	tasks, err := s.db.ListTasks(db.TaskFilter{})
	if err != nil {
		return nil, err
	}
	lower := strings.ToLower(ref)
	candidates := make([]*db.Task, 0, 2)
	for _, t := range tasks {
		if strings.HasPrefix(strings.ToLower(t.ID), lower) {
			candidates = append(candidates, t)
		}
	}
	if len(candidates) == 1 {
		return candidates[0], nil
	}
	if len(candidates) > 1 {
		return nil, fmt.Errorf("ambiguous task reference")
	}
	return nil, fmt.Errorf("task not found")
}

func (s *Server) resolveSessionRef(ref string) (*db.AgentSession, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return nil, fmt.Errorf("session ref is required")
	}
	if ss, err := s.db.GetSession(ref); err == nil {
		return ss, nil
	}
	sessions, err := s.db.ListActiveSessions()
	if err != nil {
		return nil, err
	}
	lower := strings.ToLower(ref)
	candidates := make([]*db.AgentSession, 0, 2)
	for _, ss := range sessions {
		if strings.HasPrefix(strings.ToLower(ss.ID), lower) {
			candidates = append(candidates, ss)
		}
	}
	if len(candidates) == 1 {
		return candidates[0], nil
	}
	if len(candidates) > 1 {
		return nil, fmt.Errorf("ambiguous session reference")
	}
	return nil, fmt.Errorf("session not found")
}

func (s *Server) telegramListTasks(status string, limit int) ([]telegramTaskView, error) {
	filter := db.TaskFilter{}
	if status != "" {
		st := db.TaskStatus(strings.ToLower(status))
		if !isTelegramValidTaskStatus(st) {
			return nil, fmt.Errorf("invalid status")
		}
		filter.Status = &st
	}
	tasks, err := s.db.ListTasks(filter)
	if err != nil {
		return nil, err
	}
	projects, err := s.db.ListProjects()
	if err != nil {
		return nil, err
	}
	projectNameByID := make(map[string]string, len(projects))
	for _, p := range projects {
		projectNameByID[p.ID] = p.Name
	}

	sort.SliceStable(tasks, func(i, j int) bool {
		if tasks[i].Status != tasks[j].Status {
			return tasks[i].Status < tasks[j].Status
		}
		return tasks[i].Position < tasks[j].Position
	})

	if limit <= 0 {
		limit = 20
	}
	if len(tasks) > limit {
		tasks = tasks[:limit]
	}
	out := make([]telegramTaskView, 0, len(tasks))
	for _, t := range tasks {
		out = append(out, telegramTaskView{
			ID:          t.ID,
			ProjectID:   t.ProjectID,
			Project:     projectNameByID[t.ProjectID],
			Title:       t.Title,
			Status:      string(t.Status),
			HasWorktree: t.WorktreePath != nil && *t.WorktreePath != "",
		})
	}
	return out, nil
}

func (s *Server) telegramListProjects(limit int) ([]telegramProjectView, error) {
	projects, err := s.db.ListProjects()
	if err != nil {
		return nil, err
	}
	sort.SliceStable(projects, func(i, j int) bool {
		return strings.ToLower(projects[i].Name) < strings.ToLower(projects[j].Name)
	})
	if limit <= 0 {
		limit = 20
	}
	if len(projects) > limit {
		projects = projects[:limit]
	}
	out := make([]telegramProjectView, 0, len(projects))
	for _, p := range projects {
		out = append(out, telegramProjectView{
			ID:            p.ID,
			Name:          p.Name,
			DefaultBranch: p.DefaultBranch,
		})
	}
	return out, nil
}

func (s *Server) telegramListSessions(taskRef string, limit int) ([]telegramSessionView, error) {
	var sessions []*db.AgentSession
	var err error
	if strings.TrimSpace(taskRef) == "" {
		sessions, err = s.db.ListActiveSessions()
	} else {
		task, resolveErr := s.resolveTaskRef(taskRef)
		if resolveErr != nil {
			return nil, resolveErr
		}
		sessions, err = s.db.ListSessionsByTask(task.ID)
	}
	if err != nil {
		return nil, err
	}
	sort.SliceStable(sessions, func(i, j int) bool {
		return sessions[i].CreatedAt.After(sessions[j].CreatedAt)
	})
	if limit <= 0 {
		limit = 20
	}
	if len(sessions) > limit {
		sessions = sessions[:limit]
	}
	out := make([]telegramSessionView, 0, len(sessions))
	for _, ss := range sessions {
		out = append(out, telegramSessionView{
			ID:       ss.ID,
			TaskID:   ss.TaskID,
			Provider: ss.Provider,
			Status:   string(ss.Status),
		})
	}
	return out, nil
}

func isTelegramValidTaskStatus(st db.TaskStatus) bool {
	switch st {
	case db.TaskStatusBacklog, db.TaskStatusInProgress, db.TaskStatusInReview, db.TaskStatusDone:
		return true
	default:
		return false
	}
}

func shortID(id string) string {
	if len(id) <= 8 {
		return id
	}
	return id[:8]
}

type openAIToolDef struct {
	Type     string              `json:"type"`
	Function openAIToolDefDetail `json:"function"`
}

type openAIToolDefDetail struct {
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	Parameters  map[string]any `json:"parameters,omitempty"`
}

type openAIResponsesRequest struct {
	Model              string          `json:"model"`
	Input              any             `json:"input"`
	Tools              []openAIToolDef `json:"tools,omitempty"`
	ToolChoice         string          `json:"tool_choice,omitempty"`
	Temperature        float64         `json:"temperature,omitempty"`
	PreviousResponseID string          `json:"previous_response_id,omitempty"`
}

type openAIResponsesResponse struct {
	ID     string                 `json:"id"`
	Output []openAIResponseOutput `json:"output"`
}

type openAIResponseOutput struct {
	Type      string `json:"type"`
	CallID    string `json:"call_id,omitempty"`
	Name      string `json:"name,omitempty"`
	Arguments string `json:"arguments,omitempty"`
	Content   []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content,omitempty"`
}

type openAIResponseFunctionCall struct {
	CallID    string
	Name      string
	Arguments string
}

func (s *Server) telegramRunAssistant(ctx context.Context, msg telegram.IncomingMessage) (string, error) {
	apiKey, _ := s.telegramOpenAIAPIKey()
	if strings.TrimSpace(apiKey) == "" {
		return "LLM bot is not configured. Set Telegram OpenAI API Key in Settings.", nil
	}

	model, _ := s.telegramPreferenceString("telegram_openai_model")
	if strings.TrimSpace(model) == "" {
		model, _ = s.telegramPreferenceString("telegram_llm_model")
	}
	if strings.TrimSpace(model) == "" {
		model = "gpt-4.1-mini"
	}

	prompt, err := s.telegramResolvePrompt(ctx, msg, apiKey)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(prompt) == "" {
		return "", nil
	}

	systemPrompt, err := s.telegramAssistantSystemPrompt()
	if err != nil {
		return "", err
	}

	input := []map[string]any{{"role": "system", "content": systemPrompt}}
	for _, turn := range s.telegramAssistantMemorySnapshot(msg.ChatID) {
		if strings.TrimSpace(turn.User) != "" {
			input = append(input, map[string]any{"role": "user", "content": turn.User})
		}
		if strings.TrimSpace(turn.Assistant) != "" {
			input = append(input, map[string]any{"role": "assistant", "content": turn.Assistant})
		}
	}
	input = append(input, map[string]any{"role": "user", "content": prompt})

	tools := s.telegramAssistantTools()
	httpClient := &http.Client{Timeout: 45 * time.Second}
	endpoint := "https://api.openai.com/v1/responses"
	previousResponseID := ""

	for i := 0; i < 6; i++ {
		respMsg, err := s.telegramCallResponses(ctx, httpClient, endpoint, apiKey, openAIResponsesRequest{
			Model:              model,
			Input:              input,
			Tools:              tools,
			ToolChoice:         "auto",
			Temperature:        0.2,
			PreviousResponseID: previousResponseID,
		})
		if err != nil {
			return "", err
		}
		assistantText := flattenResponseOutputText(respMsg.Output)
		toolCalls := responseFunctionCalls(respMsg.Output)
		if len(toolCalls) == 0 {
			if strings.TrimSpace(assistantText) == "" {
				assistantText = "Done."
			}
			s.telegramAssistantMemoryAppend(msg.ChatID, prompt, assistantText)
			return assistantText, nil
		}

		previousResponseID = respMsg.ID
		toolOutputs := make([]map[string]any, 0, len(toolCalls))
		for _, tc := range toolCalls {
			result := s.telegramRunToolCall(tc.Name, tc.Arguments)
			raw, _ := json.Marshal(result)
			callID := strings.TrimSpace(tc.CallID)
			if callID == "" {
				continue
			}
			toolOutputs = append(toolOutputs, map[string]any{
				"type":    "function_call_output",
				"call_id": callID,
				"output":  string(raw),
			})
		}
		if len(toolOutputs) == 0 {
			return "I could not execute the requested tools.", nil
		}
		input = toolOutputs
	}
	return "I hit the tool-call loop limit. Please retry.", nil
}

func (s *Server) telegramResolvePrompt(ctx context.Context, msg telegram.IncomingMessage, apiKey string) (string, error) {
	text := strings.TrimSpace(msg.Text)
	if text != "" {
		return text, nil
	}

	fileID := strings.TrimSpace(msg.VoiceFileID)
	if fileID == "" {
		fileID = strings.TrimSpace(msg.AudioFileID)
	}
	if fileID == "" {
		return "", nil
	}

	transcript, err := s.telegramTranscribeAudioByFileID(ctx, fileID, apiKey)
	if err != nil {
		return "", fmt.Errorf("voice transcription failed: %w", err)
	}
	if transcript == "" {
		return "", nil
	}
	return transcript, nil
}

func (s *Server) telegramTranscribeAudioByFileID(ctx context.Context, fileID, apiKey string) (string, error) {
	s.telegramBotMu.Lock()
	bot := s.telegramBot
	s.telegramBotMu.Unlock()
	if bot == nil {
		return "", fmt.Errorf("telegram bot is not running")
	}
	audioBytes, err := bot.DownloadFileByID(ctx, fileID)
	if err != nil {
		return "", err
	}
	if len(audioBytes) == 0 {
		return "", fmt.Errorf("empty audio file")
	}
	httpClient := &http.Client{Timeout: 45 * time.Second}
	return s.telegramCallAudioTranscription(ctx, httpClient, apiKey, audioBytes)
}

func (s *Server) telegramCallAudioTranscription(
	ctx context.Context,
	client *http.Client,
	apiKey string,
	audio []byte,
) (string, error) {
	model, _ := s.telegramPreferenceString("telegram_openai_transcription_model")
	if strings.TrimSpace(model) == "" {
		model = "gpt-4o-mini-transcribe"
	}

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("model", model); err != nil {
		return "", err
	}
	part, err := writer.CreateFormFile("file", "telegram_audio.ogg")
	if err != nil {
		return "", err
	}
	if _, err := part.Write(audio); err != nil {
		return "", err
	}
	if err := writer.Close(); err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", "https://api.openai.com/v1/audio/transcriptions", &body)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", writer.FormDataContentType())

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("transcription request failed: %s", strings.TrimSpace(string(raw)))
	}
	var parsed struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return "", err
	}
	return strings.TrimSpace(parsed.Text), nil
}

func (s *Server) telegramAssistantSystemPrompt() (string, error) {
	projects, err := s.telegramListProjects(20)
	if err != nil {
		return "", err
	}
	tasks, err := s.telegramListTasks("", 60)
	if err != nil {
		return "", err
	}

	openByProject := map[string][]telegramTaskView{}
	for _, t := range tasks {
		if t.Status == string(db.TaskStatusDone) {
			continue
		}
		openByProject[t.Project] = append(openByProject[t.Project], t)
	}

	var b strings.Builder
	b.WriteString("You are the Telegram control plane assistant for Codeburg, an AI-agent task management app.\n")
	b.WriteString("Keep replies concise and operational. Use tool calls for concrete actions.\n")
	b.WriteString("Task statuses are: backlog, in_progress, in_review, done.\n")
	b.WriteString("Never force-push or stomp unless user explicitly asks and confirms.\n")
	b.WriteString("Current project/task context:\n")
	for _, p := range projects {
		openTasks := openByProject[p.Name]
		b.WriteString(fmt.Sprintf("- %s (%s), default branch %s, open tasks: %d\n", p.Name, shortID(p.ID), p.DefaultBranch, len(openTasks)))
		limit := 3
		if len(openTasks) < limit {
			limit = len(openTasks)
		}
		for i := 0; i < limit; i++ {
			t := openTasks[i]
			b.WriteString(fmt.Sprintf("  - %s [%s] %s\n", shortID(t.ID), t.Status, t.Title))
		}
	}
	return strings.TrimSpace(b.String()), nil
}

func (s *Server) telegramCallResponses(
	ctx context.Context,
	client *http.Client,
	endpoint string,
	apiKey string,
	reqBody openAIResponsesRequest,
) (*openAIResponsesResponse, error) {
	raw, err := json.Marshal(reqBody)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", endpoint, bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("llm request failed: %s", strings.TrimSpace(string(body)))
	}

	var parsed openAIResponsesResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, err
	}
	if strings.TrimSpace(parsed.ID) == "" {
		return nil, fmt.Errorf("llm response missing id")
	}
	return &parsed, nil
}

func flattenResponseOutputText(items []openAIResponseOutput) string {
	parts := make([]string, 0, 2)
	for _, item := range items {
		if item.Type != "message" {
			continue
		}
		for _, c := range item.Content {
			if c.Type == "output_text" || c.Type == "text" {
				if t := strings.TrimSpace(c.Text); t != "" {
					parts = append(parts, t)
				}
			}
		}
	}
	return strings.TrimSpace(strings.Join(parts, "\n"))
}

func responseFunctionCalls(items []openAIResponseOutput) []openAIResponseFunctionCall {
	out := make([]openAIResponseFunctionCall, 0, 2)
	for _, item := range items {
		if item.Type != "function_call" {
			continue
		}
		out = append(out, openAIResponseFunctionCall{
			CallID:    item.CallID,
			Name:      item.Name,
			Arguments: item.Arguments,
		})
	}
	return out
}

func (s *Server) telegramAssistantMemorySnapshot(chatID int64) []telegramAssistantMemoryTurn {
	s.telegramMemoryMu.Lock()
	defer s.telegramMemoryMu.Unlock()
	h := s.telegramMemory[chatID]
	out := make([]telegramAssistantMemoryTurn, len(h))
	copy(out, h)
	return out
}

func (s *Server) telegramAssistantMemoryAppend(chatID int64, user, assistant string) {
	user = strings.TrimSpace(user)
	assistant = strings.TrimSpace(assistant)
	if user == "" && assistant == "" {
		return
	}
	s.telegramMemoryMu.Lock()
	h := append(s.telegramMemory[chatID], telegramAssistantMemoryTurn{User: user, Assistant: assistant})
	const maxTurns = 12
	if len(h) > maxTurns {
		h = h[len(h)-maxTurns:]
	}
	s.telegramMemory[chatID] = h
	s.telegramMemoryMu.Unlock()
	s.telegramPersistAssistantMemory()
}

func (s *Server) telegramRenderAssistantMemory(chatID int64) string {
	h := s.telegramAssistantMemorySnapshot(chatID)
	if len(h) == 0 {
		return "Memory is empty for this chat."
	}
	start := 0
	if len(h) > 8 {
		start = len(h) - 8
	}
	lines := []string{fmt.Sprintf("Memory turns: %d (showing last %d)", len(h), len(h)-start)}
	for i := start; i < len(h); i++ {
		u := strings.TrimSpace(h[i].User)
		a := strings.TrimSpace(h[i].Assistant)
		if len(u) > 120 {
			u = u[:120] + "..."
		}
		if len(a) > 120 {
			a = a[:120] + "..."
		}
		lines = append(lines, fmt.Sprintf("%d. U: %s", i+1, u))
		lines = append(lines, fmt.Sprintf("   A: %s", a))
	}
	lines = append(lines, "Use /reset-memory to clear.")
	return strings.Join(lines, "\n")
}

func (s *Server) telegramResetAssistantMemory(chatID int64) {
	s.telegramMemoryMu.Lock()
	delete(s.telegramMemory, chatID)
	s.telegramMemoryMu.Unlock()
	s.telegramPersistAssistantMemory()
}

func (s *Server) telegramLoadAssistantMemory() {
	pref, err := s.db.GetPreference(db.DefaultUserID, telegramAssistantMemoryPreferenceKey)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			return
		}
		slog.Warn("failed to load telegram assistant memory", "error", err)
		return
	}

	var raw map[string][]telegramAssistantMemoryTurn
	if err := json.Unmarshal([]byte(pref.Value), &raw); err != nil {
		slog.Warn("failed to decode telegram assistant memory", "error", err)
		return
	}

	s.telegramMemoryMu.Lock()
	defer s.telegramMemoryMu.Unlock()
	if s.telegramMemory == nil {
		s.telegramMemory = make(map[int64][]telegramAssistantMemoryTurn)
	}
	for chatIDRaw, turns := range raw {
		chatID, parseErr := strconv.ParseInt(strings.TrimSpace(chatIDRaw), 10, 64)
		if parseErr != nil {
			continue
		}
		trimmed := make([]telegramAssistantMemoryTurn, 0, len(turns))
		for _, t := range turns {
			user := strings.TrimSpace(t.User)
			assistant := strings.TrimSpace(t.Assistant)
			if user == "" && assistant == "" {
				continue
			}
			trimmed = append(trimmed, telegramAssistantMemoryTurn{User: user, Assistant: assistant})
		}
		if len(trimmed) == 0 {
			continue
		}
		const maxTurns = 12
		if len(trimmed) > maxTurns {
			trimmed = trimmed[len(trimmed)-maxTurns:]
		}
		s.telegramMemory[chatID] = trimmed
	}
}

func (s *Server) telegramPersistAssistantMemory() {
	s.telegramMemoryMu.Lock()
	snapshot := make(map[string][]telegramAssistantMemoryTurn, len(s.telegramMemory))
	for chatID, turns := range s.telegramMemory {
		if len(turns) == 0 {
			continue
		}
		copied := make([]telegramAssistantMemoryTurn, len(turns))
		copy(copied, turns)
		snapshot[strconv.FormatInt(chatID, 10)] = copied
	}
	s.telegramMemoryMu.Unlock()

	if len(snapshot) == 0 {
		if err := s.db.DeletePreference(db.DefaultUserID, telegramAssistantMemoryPreferenceKey); err != nil && !errors.Is(err, db.ErrNotFound) {
			slog.Warn("failed to clear telegram assistant memory preference", "error", err)
		}
		return
	}

	raw, err := json.Marshal(snapshot)
	if err != nil {
		slog.Warn("failed to marshal telegram assistant memory", "error", err)
		return
	}
	if _, err := s.db.SetPreference(db.DefaultUserID, telegramAssistantMemoryPreferenceKey, string(raw)); err != nil {
		slog.Warn("failed to persist telegram assistant memory", "error", err)
	}
}

func (s *Server) telegramOpenAIAPIKey() (string, error) {
	key, err := s.telegramPreferenceString("telegram_openai_api_key")
	if err == nil && strings.TrimSpace(key) != "" {
		return strings.TrimSpace(key), nil
	}
	key, err = s.telegramPreferenceString("telegram_llm_api_key")
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(key), nil
}

func (s *Server) telegramAssistantTools() []openAIToolDef {
	return []openAIToolDef{
		{
			Type: "function",
			Function: openAIToolDefDetail{
				Name:        "list_projects",
				Description: "List available projects",
				Parameters: map[string]any{
					"type": "object",
					"properties": map[string]any{
						"limit": map[string]any{"type": "integer"},
					},
				},
			},
		},
		{
			Type: "function",
			Function: openAIToolDefDetail{
				Name:        "list_tasks",
				Description: "List tasks with status and project",
				Parameters: map[string]any{
					"type": "object",
					"properties": map[string]any{
						"status": map[string]any{"type": "string"},
						"limit":  map[string]any{"type": "integer"},
					},
				},
			},
		},
		{
			Type: "function",
			Function: openAIToolDefDetail{
				Name:        "list_sessions",
				Description: "List sessions globally or for a specific task",
				Parameters: map[string]any{
					"type": "object",
					"properties": map[string]any{
						"task_id": map[string]any{"type": "string"},
						"limit":   map[string]any{"type": "integer"},
					},
				},
			},
		},
		{
			Type: "function",
			Function: openAIToolDefDetail{
				Name:        "create_task",
				Description: "Create a task in a project",
				Parameters: map[string]any{
					"type":     "object",
					"required": []string{"project", "title"},
					"properties": map[string]any{
						"project":     map[string]any{"type": "string"},
						"title":       map[string]any{"type": "string"},
						"description": map[string]any{"type": "string"},
					},
				},
			},
		},
		{
			Type: "function",
			Function: openAIToolDefDetail{
				Name:        "move_task",
				Description: "Move a task between statuses",
				Parameters: map[string]any{
					"type":     "object",
					"required": []string{"task_id", "status"},
					"properties": map[string]any{
						"task_id": map[string]any{"type": "string"},
						"status":  map[string]any{"type": "string"},
					},
				},
			},
		},
		{
			Type: "function",
			Function: openAIToolDefDetail{
				Name:        "start_session",
				Description: "Start a Claude, Codex, or terminal session for a task",
				Parameters: map[string]any{
					"type":     "object",
					"required": []string{"task_id", "provider"},
					"properties": map[string]any{
						"task_id":  map[string]any{"type": "string"},
						"provider": map[string]any{"type": "string"},
						"prompt":   map[string]any{"type": "string"},
						"model":    map[string]any{"type": "string"},
					},
				},
			},
		},
		{
			Type: "function",
			Function: openAIToolDefDetail{
				Name:        "send_session_message",
				Description: "Reply to a running/waiting session",
				Parameters: map[string]any{
					"type":     "object",
					"required": []string{"session_id", "content"},
					"properties": map[string]any{
						"session_id": map[string]any{"type": "string"},
						"content":    map[string]any{"type": "string"},
					},
				},
			},
		},
		{
			Type: "function",
			Function: openAIToolDefDetail{
				Name:        "stage_task_files",
				Description: "Stage files in a task worktree (or all files if omitted)",
				Parameters: map[string]any{
					"type":     "object",
					"required": []string{"task_id"},
					"properties": map[string]any{
						"task_id": map[string]any{"type": "string"},
						"files": map[string]any{
							"type":  "array",
							"items": map[string]any{"type": "string"},
						},
					},
				},
			},
		},
		{
			Type: "function",
			Function: openAIToolDefDetail{
				Name:        "commit_task_branch",
				Description: "Commit staged changes for a task worktree",
				Parameters: map[string]any{
					"type":     "object",
					"required": []string{"task_id"},
					"properties": map[string]any{
						"task_id": map[string]any{"type": "string"},
						"message": map[string]any{"type": "string"},
						"amend":   map[string]any{"type": "boolean"},
					},
				},
			},
		},
		{
			Type: "function",
			Function: openAIToolDefDetail{
				Name:        "push_task_branch",
				Description: "Push a task branch. Force push requires confirm=true.",
				Parameters: map[string]any{
					"type":     "object",
					"required": []string{"task_id"},
					"properties": map[string]any{
						"task_id": map[string]any{"type": "string"},
						"force":   map[string]any{"type": "boolean"},
						"confirm": map[string]any{"type": "boolean"},
					},
				},
			},
		},
		{
			Type: "function",
			Function: openAIToolDefDetail{
				Name:        "yeet_task_branch",
				Description: "Run task-level yeet: git add -A, commit, push",
				Parameters: map[string]any{
					"type":     "object",
					"required": []string{"task_id", "message"},
					"properties": map[string]any{
						"task_id": map[string]any{"type": "string"},
						"message": map[string]any{"type": "string"},
					},
				},
			},
		},
		{
			Type: "function",
			Function: openAIToolDefDetail{
				Name:        "stomp_task_branch",
				Description: "Run task-level stomp: git add -A, amend, force-push",
				Parameters: map[string]any{
					"type":     "object",
					"required": []string{"task_id", "confirm"},
					"properties": map[string]any{
						"task_id": map[string]any{"type": "string"},
						"confirm": map[string]any{"type": "boolean"},
					},
				},
			},
		},
	}
}

func (s *Server) telegramRunToolCall(name, rawArgs string) map[string]any {
	decoder := json.NewDecoder(strings.NewReader(rawArgs))
	decoder.DisallowUnknownFields()

	switch name {
	case "list_projects":
		var input struct {
			Limit int `json:"limit"`
		}
		if err := decoder.Decode(&input); err != nil && err != io.EOF {
			return map[string]any{"ok": false, "error": err.Error()}
		}
		projects, err := s.telegramListProjects(input.Limit)
		if err != nil {
			return map[string]any{"ok": false, "error": err.Error()}
		}
		return map[string]any{"ok": true, "projects": projects}
	case "list_tasks":
		var input struct {
			Status string `json:"status"`
			Limit  int    `json:"limit"`
		}
		if err := decoder.Decode(&input); err != nil && err != io.EOF {
			return map[string]any{"ok": false, "error": err.Error()}
		}
		tasks, err := s.telegramListTasks(input.Status, input.Limit)
		if err != nil {
			return map[string]any{"ok": false, "error": err.Error()}
		}
		return map[string]any{"ok": true, "tasks": tasks}
	case "list_sessions":
		var input struct {
			TaskID string `json:"task_id"`
			Limit  int    `json:"limit"`
		}
		if err := decoder.Decode(&input); err != nil && err != io.EOF {
			return map[string]any{"ok": false, "error": err.Error()}
		}
		sessions, err := s.telegramListSessions(input.TaskID, input.Limit)
		if err != nil {
			return map[string]any{"ok": false, "error": err.Error()}
		}
		return map[string]any{"ok": true, "sessions": sessions}
	case "create_task":
		var input struct {
			Project     string `json:"project"`
			Title       string `json:"title"`
			Description string `json:"description"`
		}
		if err := decoder.Decode(&input); err != nil {
			return map[string]any{"ok": false, "error": err.Error()}
		}
		project, err := s.resolveProjectRef(input.Project)
		if err != nil {
			return map[string]any{"ok": false, "error": err.Error()}
		}
		req := db.CreateTaskInput{ProjectID: project.ID, Title: strings.TrimSpace(input.Title)}
		if d := strings.TrimSpace(input.Description); d != "" {
			req.Description = &d
		}
		task, err := s.db.CreateTask(req)
		if err != nil {
			return map[string]any{"ok": false, "error": err.Error()}
		}
		return map[string]any{"ok": true, "task_id": task.ID, "title": task.Title}
	case "move_task":
		var input struct {
			TaskID string `json:"task_id"`
			Status string `json:"status"`
		}
		if err := decoder.Decode(&input); err != nil {
			return map[string]any{"ok": false, "error": err.Error()}
		}
		task, err := s.resolveTaskRef(input.TaskID)
		if err != nil {
			return map[string]any{"ok": false, "error": err.Error()}
		}
		status := db.TaskStatus(strings.ToLower(strings.TrimSpace(input.Status)))
		if !isTelegramValidTaskStatus(status) {
			return map[string]any{"ok": false, "error": "invalid status"}
		}
		if _, err := s.db.UpdateTask(task.ID, db.UpdateTaskInput{Status: &status}); err != nil {
			return map[string]any{"ok": false, "error": err.Error()}
		}
		return map[string]any{"ok": true, "task_id": task.ID, "status": status}
	case "start_session":
		var input struct {
			TaskID   string `json:"task_id"`
			Provider string `json:"provider"`
			Prompt   string `json:"prompt"`
			Model    string `json:"model"`
		}
		if err := decoder.Decode(&input); err != nil {
			return map[string]any{"ok": false, "error": err.Error()}
		}
		task, err := s.resolveTaskRef(input.TaskID)
		if err != nil {
			return map[string]any{"ok": false, "error": err.Error()}
		}
		project, err := s.db.GetProject(task.ProjectID)
		if err != nil {
			return map[string]any{"ok": false, "error": err.Error()}
		}
		workDir := project.Path
		if task.WorktreePath != nil && *task.WorktreePath != "" {
			workDir = *task.WorktreePath
		}
		session, err := s.startSessionInternal(startSessionParams{
			ProjectID: project.ID,
			TaskID:    task.ID,
			WorkDir:   workDir,
		}, StartSessionRequest{
			Provider: strings.ToLower(strings.TrimSpace(input.Provider)),
			Prompt:   strings.TrimSpace(input.Prompt),
			Model:    strings.TrimSpace(input.Model),
		})
		if err != nil {
			return map[string]any{"ok": false, "error": err.Error()}
		}
		return map[string]any{"ok": true, "session_id": session.ID, "provider": session.Provider, "status": session.Status}
	case "send_session_message":
		var input struct {
			SessionID string `json:"session_id"`
			Content   string `json:"content"`
		}
		if err := decoder.Decode(&input); err != nil {
			return map[string]any{"ok": false, "error": err.Error()}
		}
		session, err := s.resolveSessionRef(input.SessionID)
		if err != nil {
			return map[string]any{"ok": false, "error": err.Error()}
		}
		content := strings.TrimSpace(input.Content)
		if content == "" {
			return map[string]any{"ok": false, "error": "content is required"}
		}
		if session.SessionType == "chat" {
			if err := s.startChatTurn(session.ID, content, "telegram_tool"); err != nil {
				return map[string]any{"ok": false, "error": err.Error()}
			}
		} else {
			if err := s.sessions.runtime.Write(session.ID, []byte(content+"\n")); err != nil {
				return map[string]any{"ok": false, "error": err.Error()}
			}
		}
		return map[string]any{"ok": true, "session_id": session.ID}
	case "stage_task_files":
		var input struct {
			TaskID string   `json:"task_id"`
			Files  []string `json:"files"`
		}
		if err := decoder.Decode(&input); err != nil {
			return map[string]any{"ok": false, "error": err.Error()}
		}
		_, _, workDir, err := s.resolveTaskGitContext(input.TaskID)
		if err != nil {
			return map[string]any{"ok": false, "error": err.Error()}
		}
		if len(input.Files) == 0 {
			if _, err := runGit(workDir, "add", "-A"); err != nil {
				return map[string]any{"ok": false, "error": err.Error()}
			}
			return map[string]any{"ok": true, "staged": "all"}
		}
		argsAdd := []string{"add", "--"}
		argsAdd = append(argsAdd, input.Files...)
		if _, err := runGit(workDir, argsAdd...); err != nil {
			return map[string]any{"ok": false, "error": err.Error()}
		}
		return map[string]any{"ok": true, "staged_count": len(input.Files)}
	case "commit_task_branch":
		var input struct {
			TaskID  string `json:"task_id"`
			Message string `json:"message"`
			Amend   bool   `json:"amend"`
		}
		if err := decoder.Decode(&input); err != nil {
			return map[string]any{"ok": false, "error": err.Error()}
		}
		_, _, workDir, err := s.resolveTaskGitContext(input.TaskID)
		if err != nil {
			return map[string]any{"ok": false, "error": err.Error()}
		}
		msg := strings.TrimSpace(input.Message)
		if input.Amend {
			if msg == "" {
				if _, err := runGit(workDir, "commit", "--amend", "--no-edit"); err != nil {
					return map[string]any{"ok": false, "error": err.Error()}
				}
			} else {
				if _, err := runGit(workDir, "commit", "--amend", "-m", msg); err != nil {
					return map[string]any{"ok": false, "error": err.Error()}
				}
			}
			return map[string]any{"ok": true, "amend": true}
		}
		if msg == "" {
			return map[string]any{"ok": false, "error": "message is required unless amend=true"}
		}
		if _, err := runGit(workDir, "commit", "-m", msg); err != nil {
			return map[string]any{"ok": false, "error": err.Error()}
		}
		return map[string]any{"ok": true, "amend": false}
	case "push_task_branch":
		var input struct {
			TaskID  string `json:"task_id"`
			Force   bool   `json:"force"`
			Confirm bool   `json:"confirm"`
		}
		if err := decoder.Decode(&input); err != nil {
			return map[string]any{"ok": false, "error": err.Error()}
		}
		_, _, workDir, err := s.resolveTaskGitContext(input.TaskID)
		if err != nil {
			return map[string]any{"ok": false, "error": err.Error()}
		}
		if input.Force && !input.Confirm {
			return map[string]any{"ok": false, "error": "force push requires confirm=true"}
		}
		if err := gitPushCurrentBranch(workDir, input.Force); err != nil {
			return map[string]any{"ok": false, "error": err.Error()}
		}
		return map[string]any{"ok": true, "force": input.Force}
	case "yeet_task_branch":
		var input struct {
			TaskID  string `json:"task_id"`
			Message string `json:"message"`
		}
		if err := decoder.Decode(&input); err != nil {
			return map[string]any{"ok": false, "error": err.Error()}
		}
		_, _, workDir, err := s.resolveTaskGitContext(input.TaskID)
		if err != nil {
			return map[string]any{"ok": false, "error": err.Error()}
		}
		if _, err := runGit(workDir, "add", "-A"); err != nil {
			return map[string]any{"ok": false, "error": err.Error()}
		}
		if _, err := runGit(workDir, "commit", "-m", strings.TrimSpace(input.Message)); err != nil {
			return map[string]any{"ok": false, "error": err.Error()}
		}
		if err := gitPushCurrentBranch(workDir, false); err != nil {
			return map[string]any{"ok": false, "error": err.Error()}
		}
		return map[string]any{"ok": true}
	case "stomp_task_branch":
		var input struct {
			TaskID  string `json:"task_id"`
			Confirm bool   `json:"confirm"`
		}
		if err := decoder.Decode(&input); err != nil {
			return map[string]any{"ok": false, "error": err.Error()}
		}
		if !input.Confirm {
			return map[string]any{"ok": false, "error": "stomp requires confirm=true"}
		}
		_, _, workDir, err := s.resolveTaskGitContext(input.TaskID)
		if err != nil {
			return map[string]any{"ok": false, "error": err.Error()}
		}
		if _, err := runGit(workDir, "add", "-A"); err != nil {
			return map[string]any{"ok": false, "error": err.Error()}
		}
		if _, err := runGit(workDir, "commit", "--amend", "--no-edit"); err != nil {
			return map[string]any{"ok": false, "error": err.Error()}
		}
		if err := gitPushCurrentBranch(workDir, true); err != nil {
			return map[string]any{"ok": false, "error": err.Error()}
		}
		return map[string]any{"ok": true}
	default:
		return map[string]any{"ok": false, "error": "unknown tool"}
	}
}

func (s *Server) telegramPreferenceString(key string) (string, error) {
	pref, err := s.db.GetPreference(db.DefaultUserID, key)
	if err != nil {
		return "", err
	}
	return unquotePreference(pref.Value), nil
}

func telegramHasFlag(flags []string, flag string) bool {
	for _, f := range flags {
		if strings.EqualFold(strings.TrimSpace(f), flag) {
			return true
		}
	}
	return false
}

func (s *Server) telegramRenderCommandError(err error) string {
	msg := strings.TrimSpace(err.Error())
	if msg == "" {
		return "Request failed."
	}
	switch {
	case strings.Contains(msg, "ambiguous project reference"):
		return "Project reference is ambiguous. Use /projects and retry with a longer ID."
	case strings.Contains(msg, "project not found"):
		return "Project not found. Use /projects to list available projects."
	case strings.Contains(msg, "ambiguous task reference"):
		return "Task reference is ambiguous. Use /tasks and retry with a longer ID."
	case strings.Contains(msg, "task not found"):
		return "Task not found. Use /tasks to list available tasks."
	case strings.Contains(msg, "ambiguous session reference"):
		return "Session reference is ambiguous. Use /sessions and retry with a longer ID."
	case strings.Contains(msg, "session not found"):
		return "Session not found. Use /sessions to list active sessions."
	case strings.Contains(msg, "task has no worktree"):
		return "This task has no worktree yet."
	default:
		return "Request failed: " + msg
	}
}

func (s *Server) notifyTelegramSessionNeedsAttention(sessionID, taskID, reason string) {
	s.telegramBotMu.Lock()
	bot := s.telegramBot
	s.telegramBotMu.Unlock()
	if bot == nil {
		return
	}
	chatIDRaw, err := s.telegramPreferenceString("telegram_user_id")
	if err != nil || strings.TrimSpace(chatIDRaw) == "" {
		return
	}
	chatID, err := strconv.ParseInt(strings.TrimSpace(chatIDRaw), 10, 64)
	if err != nil {
		return
	}

	title := ""
	providerLabel := "Agent"
	if session, err := s.db.GetSession(sessionID); err == nil {
		providerLabel = telegramProviderLabel(session.Provider)
	}
	if taskID != "" {
		if task, err := s.db.GetTask(taskID); err == nil {
			title = task.Title
		}
	}

	origin := ""
	if cfg, err := s.auth.loadConfig(); err == nil {
		origin = strings.TrimSpace(cfg.Auth.Origin)
	}
	taskLabel := html.EscapeString(strings.TrimSpace(title))
	if taskLabel == "" {
		taskLabel = shortID(taskID)
	}
	sessionLabel := html.EscapeString(providerLabel)
	text := fmt.Sprintf("%s is waiting for a reply.", sessionLabel)
	if origin != "" && taskID != "" {
		sessionURL := strings.TrimSuffix(origin, "/") + "/tasks/" + taskID + "/session/" + sessionID
		taskURL := strings.TrimSuffix(origin, "/") + "/tasks/" + taskID
		text = fmt.Sprintf("<a href=\"%s\">%s</a> is waiting for a reply on task <a href=\"%s\">%s</a>.",
			html.EscapeString(sessionURL), sessionLabel, html.EscapeString(taskURL), taskLabel)
	} else if taskID != "" {
		text = fmt.Sprintf("%s is waiting for a reply on task _%s_.", sessionLabel, taskLabel)
	}
	if strings.TrimSpace(reason) != "" {
		text += fmt.Sprintf("\n\nReason: %s", html.EscapeString(reason))
	}
	text += fmt.Sprintf("\n\nReply to this message to answer, or use /reply %s <message>.", sessionID)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	messageID, err := bot.SendMessageWithOptions(ctx, chatID, text, telegram.SendMessageOptions{ParseMode: "HTML"})
	if err == nil && messageID != 0 {
		s.telegramStoreReplySession(chatID, messageID, sessionID)
	}
}

func telegramProviderLabel(provider string) string {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case "claude":
		return "Claude"
	case "codex":
		return "Codex"
	case "terminal":
		return "Terminal"
	default:
		if provider == "" {
			return "Agent"
		}
		return strings.ToUpper(provider[:1]) + provider[1:]
	}
}

func telegramReplySessionMapKey(chatID, messageID int64) string {
	return strconv.FormatInt(chatID, 10) + ":" + strconv.FormatInt(messageID, 10)
}

func (s *Server) telegramStoreReplySession(chatID, messageID int64, sessionID string) {
	if chatID == 0 || messageID == 0 || strings.TrimSpace(sessionID) == "" {
		return
	}
	key := telegramReplySessionMapKey(chatID, messageID)
	s.telegramReplyMapMu.Lock()
	s.telegramReplyToSession[key] = strings.TrimSpace(sessionID)
	s.telegramReplyMapMu.Unlock()
}

func (s *Server) telegramLookupReplySession(chatID, messageID int64) string {
	if chatID == 0 || messageID == 0 {
		return ""
	}
	key := telegramReplySessionMapKey(chatID, messageID)
	s.telegramReplyMapMu.Lock()
	sessionID := strings.TrimSpace(s.telegramReplyToSession[key])
	s.telegramReplyMapMu.Unlock()
	return sessionID
}

func (s *Server) telegramSendReplyToSession(ctx context.Context, sessionID string, msg telegram.IncomingMessage) (string, error) {
	session, err := s.resolveSessionRef(sessionID)
	if err != nil {
		return "", err
	}
	content := strings.TrimSpace(msg.Text)
	if content == "" {
		apiKey, _ := s.telegramOpenAIAPIKey()
		if strings.TrimSpace(apiKey) != "" {
			content, _ = s.telegramResolvePrompt(ctx, msg, apiKey)
			content = strings.TrimSpace(content)
		}
	}
	if content == "" {
		return "Reply content is empty.", nil
	}

	if session.SessionType == "chat" {
		if err := s.startChatTurn(session.ID, content, "telegram_reply_inline"); err != nil {
			return "", err
		}
		return fmt.Sprintf("Sent message to %s session %s.", telegramProviderLabel(session.Provider), shortID(session.ID)), nil
	}
	if err := s.sessions.runtime.Write(session.ID, []byte(content+"\n")); err != nil {
		return "", err
	}
	return fmt.Sprintf("Sent message to terminal session %s.", shortID(session.ID)), nil
}
