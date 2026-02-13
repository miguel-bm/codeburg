import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useTaskEditorDrafts } from './useTaskEditorDrafts';

interface HarnessProps {
  task: { title: string; description?: string | null };
  onUpdate: (input: { title?: string; description?: string }) => void;
}

function Harness({ task, onUpdate }: HarnessProps) {
  const editor = useTaskEditorDrafts({
    task: { title: task.title, description: task.description ?? undefined },
    onUpdate,
  });

  return (
    <div>
      <div data-testid="editing-title">{String(editor.editingTitle)}</div>
      <div data-testid="editing-desc">{String(editor.editingDesc)}</div>
      <div data-testid="title-draft">{editor.titleDraft}</div>
      <div data-testid="desc-draft">{editor.descDraft}</div>

      <button onClick={editor.startTitleEditing}>start-title</button>
      <button onClick={editor.saveTitle}>save-title</button>
      <button onClick={editor.cancelTitleEditing}>cancel-title</button>
      <button onClick={() => editor.setTitleDraft('  New title  ')}>set-title-new</button>
      <button onClick={() => editor.setTitleDraft('')}>set-title-empty</button>

      <button onClick={editor.startDescEditing}>start-desc</button>
      <button onClick={editor.saveDesc}>save-desc</button>
      <button onClick={editor.cancelDescEditing}>cancel-desc</button>
      <button onClick={() => editor.setDescDraft('  New description  ')}>set-desc-new</button>
      <button onClick={() => editor.setDescDraft('   ')}>set-desc-empty</button>
    </div>
  );
}

describe('useTaskEditorDrafts', () => {
  it('starts title editing with current title and saves trimmed updates', () => {
    const onUpdate = vi.fn();

    render(<Harness task={{ title: 'Original title', description: 'Desc' }} onUpdate={onUpdate} />);

    fireEvent.click(screen.getByText('start-title'));
    expect(screen.getByTestId('editing-title')).toHaveTextContent('true');
    expect(screen.getByTestId('title-draft')).toHaveTextContent('Original title');

    fireEvent.click(screen.getByText('set-title-new'));
    fireEvent.click(screen.getByText('save-title'));

    expect(onUpdate).toHaveBeenCalledWith({ title: 'New title' });
    expect(screen.getByTestId('editing-title')).toHaveTextContent('false');
  });

  it('does not emit title update for unchanged or empty title', () => {
    const onUpdate = vi.fn();

    render(<Harness task={{ title: 'Original title', description: 'Desc' }} onUpdate={onUpdate} />);

    fireEvent.click(screen.getByText('start-title'));
    fireEvent.click(screen.getByText('save-title'));

    fireEvent.click(screen.getByText('start-title'));
    fireEvent.click(screen.getByText('set-title-empty'));
    fireEvent.click(screen.getByText('save-title'));

    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('starts description editing and saves empty description as undefined', () => {
    const onUpdate = vi.fn();

    render(<Harness task={{ title: 'T', description: 'Original desc' }} onUpdate={onUpdate} />);

    fireEvent.click(screen.getByText('start-desc'));
    expect(screen.getByTestId('editing-desc')).toHaveTextContent('true');
    expect(screen.getByTestId('desc-draft')).toHaveTextContent('Original desc');

    fireEvent.click(screen.getByText('set-desc-empty'));
    fireEvent.click(screen.getByText('save-desc'));

    expect(onUpdate).toHaveBeenCalledWith({ description: undefined });
    expect(screen.getByTestId('editing-desc')).toHaveTextContent('false');
  });

  it('can cancel edit modes without calling update', () => {
    const onUpdate = vi.fn();

    render(<Harness task={{ title: 'Title', description: 'Desc' }} onUpdate={onUpdate} />);

    fireEvent.click(screen.getByText('start-title'));
    fireEvent.click(screen.getByText('cancel-title'));
    fireEvent.click(screen.getByText('start-desc'));
    fireEvent.click(screen.getByText('cancel-desc'));

    expect(screen.getByTestId('editing-title')).toHaveTextContent('false');
    expect(screen.getByTestId('editing-desc')).toHaveTextContent('false');
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
