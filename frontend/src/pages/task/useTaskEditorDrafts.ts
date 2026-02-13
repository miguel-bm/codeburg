import { useState } from 'react';
import type { Task } from '../../api/types';

type TaskTextUpdate = {
  title?: string;
  description?: string;
};

interface UseTaskEditorDraftsParams {
  task: Pick<Task, 'title' | 'description'>;
  onUpdate: (input: TaskTextUpdate) => void;
}

export function useTaskEditorDrafts({ task, onUpdate }: UseTaskEditorDraftsParams) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState(task.description || '');

  const startTitleEditing = () => {
    setTitleDraft(task.title);
    setEditingTitle(true);
  };

  const saveTitle = () => {
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== task.title) {
      onUpdate({ title: trimmed });
    }
    setEditingTitle(false);
  };

  const cancelTitleEditing = () => {
    setEditingTitle(false);
  };

  const startDescEditing = () => {
    setDescDraft(task.description || '');
    setEditingDesc(true);
  };

  const saveDesc = () => {
    const trimmed = descDraft.trim();
    if (trimmed !== (task.description || '')) {
      onUpdate({ description: trimmed || undefined });
    }
    setEditingDesc(false);
  };

  const cancelDescEditing = () => {
    setEditingDesc(false);
  };

  return {
    editingTitle,
    titleDraft,
    editingDesc,
    descDraft,
    setTitleDraft,
    setDescDraft,
    startTitleEditing,
    saveTitle,
    cancelTitleEditing,
    startDescEditing,
    saveDesc,
    cancelDescEditing,
  };
}
