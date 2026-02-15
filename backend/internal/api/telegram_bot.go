package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
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

func (s *Server) handleTelegramCommand(ctx context.Context, msg telegram.IncomingMessage) (string, error) {
	switch msg.Command {
	case "help":
		return strings.TrimSpace(`Commands:
/tasks [status]
/task <task-id>
/newtask <project-id-or-name> | <title>
/move <task-id> <backlog|in_progress|in_review|done>
/session <task-id> <claude|codex|terminal> [prompt]
/reply <session-id> <message>
/yeet <task-id> <commit message>
/stomp <task-id>

Non-command messages are handled by the LLM assistant.`), nil
	case "tasks":
		status := strings.TrimSpace(msg.Args)
		return s.telegramRenderTaskList(status, 12)
	case "task":
		return s.telegramRenderTaskDetail(strings.TrimSpace(msg.Args))
	case "newtask":
		return s.telegramCommandCreateTask(strings.TrimSpace(msg.Args))
	case "move":
		return s.telegramCommandMoveTask(strings.TrimSpace(msg.Args))
	case "session":
		return s.telegramCommandStartSession(strings.TrimSpace(msg.Args))
	case "reply":
		return s.telegramCommandReply(strings.TrimSpace(msg.Args))
	case "yeet":
		return s.telegramCommandYeet(strings.TrimSpace(msg.Args))
	case "stomp":
		return s.telegramCommandStomp(strings.TrimSpace(msg.Args))
	default:
		return `Unknown command. Use /help.`, nil
	}
}

func (s *Server) handleTelegramMessage(ctx context.Context, msg telegram.IncomingMessage) (string, error) {
	reply, err := s.telegramRunAssistant(ctx, msg)
	if err != nil {
		return "", err
	}
	return reply, nil
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
	taskRef := strings.TrimSpace(args)
	if taskRef == "" {
		return "Usage: /stomp <task-id>", nil
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

type openAIChatCompletionRequest struct {
	Model       string              `json:"model"`
	Messages    []openAIChatMessage `json:"messages"`
	Tools       []openAIToolDef     `json:"tools,omitempty"`
	ToolChoice  string              `json:"tool_choice,omitempty"`
	Temperature float64             `json:"temperature,omitempty"`
}

type openAIChatMessage struct {
	Role       string              `json:"role"`
	Content    any                 `json:"content,omitempty"`
	Name       string              `json:"name,omitempty"`
	ToolCallID string              `json:"tool_call_id,omitempty"`
	ToolCalls  []openAIToolCallOut `json:"tool_calls,omitempty"`
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

type openAIChatCompletionResponse struct {
	Choices []struct {
		Message openAIChatMessageIn `json:"message"`
	} `json:"choices"`
}

type openAIChatMessageIn struct {
	Role      string             `json:"role"`
	Content   any                `json:"content"`
	ToolCalls []openAIToolCallIn `json:"tool_calls,omitempty"`
}

type openAIToolCallOut struct {
	ID       string `json:"id,omitempty"`
	Type     string `json:"type,omitempty"`
	Function struct {
		Name      string `json:"name,omitempty"`
		Arguments string `json:"arguments,omitempty"`
	} `json:"function,omitempty"`
}

type openAIToolCallIn struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

func (s *Server) telegramRunAssistant(ctx context.Context, msg telegram.IncomingMessage) (string, error) {
	apiKey, _ := s.telegramPreferenceString("telegram_llm_api_key")
	if strings.TrimSpace(apiKey) == "" {
		return "LLM bot is not configured. Set Telegram LLM API Key in Settings.", nil
	}
	baseURL, _ := s.telegramPreferenceString("telegram_llm_base_url")
	if strings.TrimSpace(baseURL) == "" {
		baseURL = "https://api.openai.com/v1"
	}
	model, _ := s.telegramPreferenceString("telegram_llm_model")
	if strings.TrimSpace(model) == "" {
		model = "gpt-4.1-mini"
	}
	prompt := strings.TrimSpace(msg.Text)
	if prompt == "" {
		return "", nil
	}

	messages := []openAIChatMessage{
		{
			Role: "system",
			Content: "You are the Telegram control plane for Codeburg. Keep replies concise. " +
				"Use tool calls for concrete actions. Task status values are: backlog, in_progress, in_review, done.",
		},
		{
			Role:    "user",
			Content: prompt,
		},
	}

	tools := s.telegramAssistantTools()
	httpClient := &http.Client{Timeout: 45 * time.Second}
	endpoint := strings.TrimSuffix(baseURL, "/") + "/chat/completions"

	for i := 0; i < 6; i++ {
		respMsg, err := s.telegramCallChatCompletions(ctx, httpClient, endpoint, apiKey, model, messages, tools)
		if err != nil {
			return "", err
		}

		if len(respMsg.ToolCalls) == 0 {
			text := flattenAssistantContent(respMsg.Content)
			if strings.TrimSpace(text) == "" {
				return "Done.", nil
			}
			return text, nil
		}

		messages = append(messages, openAIChatMessage{
			Role:      "assistant",
			Content:   flattenAssistantContent(respMsg.Content),
			ToolCalls: toToolCallOut(respMsg.ToolCalls),
		})

		for _, tc := range respMsg.ToolCalls {
			result := s.telegramRunToolCall(tc.Function.Name, tc.Function.Arguments)
			raw, _ := json.Marshal(result)
			messages = append(messages, openAIChatMessage{
				Role:       "tool",
				ToolCallID: tc.ID,
				Name:       tc.Function.Name,
				Content:    string(raw),
			})
		}
	}
	return "I hit the tool-call loop limit. Please retry.", nil
}

func (s *Server) telegramCallChatCompletions(
	ctx context.Context,
	client *http.Client,
	endpoint, apiKey, model string,
	messages []openAIChatMessage,
	tools []openAIToolDef,
) (*openAIChatMessageIn, error) {
	reqBody := openAIChatCompletionRequest{
		Model:       model,
		Messages:    messages,
		Tools:       tools,
		ToolChoice:  "auto",
		Temperature: 0.2,
	}
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

	var parsed openAIChatCompletionResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, err
	}
	if len(parsed.Choices) == 0 {
		return nil, fmt.Errorf("llm response missing choices")
	}
	return &parsed.Choices[0].Message, nil
}

func (s *Server) telegramAssistantTools() []openAIToolDef {
	return []openAIToolDef{
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
					"required": []string{"task_id"},
					"properties": map[string]any{
						"task_id": map[string]any{"type": "string"},
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
			TaskID string `json:"task_id"`
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

func flattenAssistantContent(content any) string {
	switch v := content.(type) {
	case string:
		return strings.TrimSpace(v)
	case []any:
		var parts []string
		for _, item := range v {
			m, ok := item.(map[string]any)
			if !ok {
				continue
			}
			if t, _ := m["type"].(string); t != "" && t != "text" {
				continue
			}
			if text, _ := m["text"].(string); text != "" {
				parts = append(parts, strings.TrimSpace(text))
			}
		}
		return strings.TrimSpace(strings.Join(parts, "\n"))
	default:
		return ""
	}
}

func toToolCallOut(in []openAIToolCallIn) []openAIToolCallOut {
	out := make([]openAIToolCallOut, 0, len(in))
	for _, tc := range in {
		var o openAIToolCallOut
		o.ID = tc.ID
		o.Type = tc.Type
		o.Function.Name = tc.Function.Name
		o.Function.Arguments = tc.Function.Arguments
		out = append(out, o)
	}
	return out
}

func (s *Server) telegramPreferenceString(key string) (string, error) {
	pref, err := s.db.GetPreference(db.DefaultUserID, key)
	if err != nil {
		return "", err
	}
	return unquotePreference(pref.Value), nil
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
	if taskID != "" {
		if task, err := s.db.GetTask(taskID); err == nil {
			title = task.Title
		}
	}
	text := fmt.Sprintf("Session %s needs attention (%s).", shortID(sessionID), reason)
	if taskID != "" {
		text += fmt.Sprintf("\nTask: %s (%s)", shortID(taskID), title)
	}
	text += fmt.Sprintf("\nReply with /reply %s <message>", sessionID)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = bot.SendMessage(ctx, chatID, text)
}
