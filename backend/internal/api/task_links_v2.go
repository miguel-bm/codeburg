package api

import (
	"net/http"
	"strings"

	"github.com/miguel-bm/codeburg/internal/db"
)

type createTaskLinkRequest struct {
	TargetType   string `json:"targetType"`
	TargetID     string `json:"targetId"`
	RelationType string `json:"relationType,omitempty"`
}

func (s *Server) handleListProjectTaskLinks(w http.ResponseWriter, r *http.Request) {
	projectID := urlParam(r, "id")
	if _, err := s.db.GetProject(projectID); err != nil {
		writeDBError(w, err, "project")
		return
	}

	filter := db.TaskLinkFilter{ProjectID: &projectID}
	if rawType := strings.TrimSpace(r.URL.Query().Get("targetType")); rawType != "" {
		targetType, ok := parseTaskLinkTargetType(rawType)
		if !ok {
			writeError(w, http.StatusBadRequest, "invalid targetType")
			return
		}
		filter.TargetType = &targetType
	}
	if rawTargetID := strings.TrimSpace(r.URL.Query().Get("targetId")); rawTargetID != "" {
		filter.TargetID = &rawTargetID
	}

	links, err := s.db.ListTaskLinks(filter)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list task links")
		return
	}
	writeJSON(w, http.StatusOK, links)
}

func (s *Server) handleListTaskLinks(w http.ResponseWriter, r *http.Request) {
	taskID := urlParam(r, "id")
	task, err := s.db.GetTask(taskID)
	if err != nil {
		writeDBError(w, err, "task")
		return
	}
	links, err := s.db.ListTaskLinks(db.TaskLinkFilter{
		ProjectID: &task.ProjectID,
		TaskID:    &task.ID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list task links")
		return
	}
	writeJSON(w, http.StatusOK, links)
}

func (s *Server) handleCreateTaskLink(w http.ResponseWriter, r *http.Request) {
	taskID := urlParam(r, "id")
	task, err := s.db.GetTask(taskID)
	if err != nil {
		writeDBError(w, err, "task")
		return
	}

	var req createTaskLinkRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	targetType, ok := parseTaskLinkTargetType(req.TargetType)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid targetType")
		return
	}
	targetID := strings.TrimSpace(req.TargetID)
	if targetID == "" {
		writeError(w, http.StatusBadRequest, "targetId is required")
		return
	}
	if err := s.validateTaskLinkTarget(task.ProjectID, targetType, targetID); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	link, err := s.db.CreateTaskLink(db.CreateTaskLinkInput{
		TaskID:       task.ID,
		ProjectID:    task.ProjectID,
		TargetType:   targetType,
		TargetID:     targetID,
		RelationType: req.RelationType,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create task link")
		return
	}
	writeJSON(w, http.StatusCreated, link)
}

func (s *Server) handleDeleteTaskLink(w http.ResponseWriter, r *http.Request) {
	taskID := urlParam(r, "id")
	linkID := urlParam(r, "linkId")
	task, err := s.db.GetTask(taskID)
	if err != nil {
		writeDBError(w, err, "task")
		return
	}
	link, err := s.db.GetTaskLink(linkID)
	if err != nil {
		writeDBError(w, err, "task link")
		return
	}
	if link.TaskID != task.ID || link.ProjectID != task.ProjectID {
		writeError(w, http.StatusNotFound, "task link not found")
		return
	}
	if err := s.db.DeleteTaskLink(linkID); err != nil {
		writeDBError(w, err, "task link")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleUpdateTaskTracking(w http.ResponseWriter, r *http.Request) {
	id := urlParam(r, "id")
	var input db.UpdateTaskInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if input.Status != nil {
		switch *input.Status {
		case db.TaskStatusBacklog, db.TaskStatusInProgress, db.TaskStatusInReview, db.TaskStatusDone:
		default:
			writeError(w, http.StatusBadRequest, "invalid status")
			return
		}
	}
	task, err := s.db.UpdateTask(id, input)
	if err != nil {
		writeDBError(w, err, "task")
		return
	}
	if labels, err := s.db.GetTaskLabels(id); err == nil {
		task.Labels = labels
	}
	writeJSON(w, http.StatusOK, task)
}

func parseTaskLinkTargetType(raw string) (db.TaskLinkTargetType, bool) {
	switch db.TaskLinkTargetType(strings.TrimSpace(raw)) {
	case db.TaskLinkTargetWorkspace:
		return db.TaskLinkTargetWorkspace, true
	case db.TaskLinkTargetConversation:
		return db.TaskLinkTargetConversation, true
	default:
		return "", false
	}
}

func (s *Server) validateTaskLinkTarget(projectID string, targetType db.TaskLinkTargetType, targetID string) error {
	switch targetType {
	case db.TaskLinkTargetWorkspace:
		workspace, err := s.db.GetWorkspace(targetID)
		if err != nil {
			return err
		}
		if workspace.ProjectID != projectID {
			return errBadRequest("workspace must belong to the same project")
		}
	case db.TaskLinkTargetConversation:
		conversation, err := s.db.GetConversation(targetID)
		if err != nil {
			return err
		}
		if conversation.ProjectID != projectID {
			return errBadRequest("conversation must belong to the same project")
		}
	}
	return nil
}

type errBadRequest string

func (e errBadRequest) Error() string { return string(e) }
