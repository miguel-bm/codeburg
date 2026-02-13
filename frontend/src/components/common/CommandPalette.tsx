import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { AnimatePresence, motion } from 'motion/react';
import {
  Search,
  FolderGit2,
  Circle,
  CircleDot,
  CircleCheck,
  CircleDashed,
  Terminal,
  Bot,
  LayoutDashboard,
  Plus,
  Settings,
  Filter,
} from 'lucide-react';
import { sidebarApi, projectsApi, TASK_STATUS } from '../../api';
import type { TaskStatus, SidebarSession } from '../../api';
import { usePanelNavigation } from '../../hooks/usePanelNavigation';

interface CommandPaletteProps {
  onClose: () => void;
}

function taskStatusIcon(status: TaskStatus) {
  switch (status) {
    case TASK_STATUS.BACKLOG:
      return <Circle className="w-4 h-4 status-backlog" />;
    case TASK_STATUS.IN_PROGRESS:
      return <CircleDot className="w-4 h-4 status-in-progress" />;
    case TASK_STATUS.IN_REVIEW:
      return <CircleDashed className="w-4 h-4 status-in-review" />;
    case TASK_STATUS.DONE:
      return <CircleCheck className="w-4 h-4 status-done" />;
    default:
      return <Circle className="w-4 h-4 text-dim" />;
  }
}

function sessionIcon(session: SidebarSession) {
  const Icon = session.provider === 'terminal' ? Terminal : Bot;
  if (session.status === 'waiting_input') {
    return (
      <span className="relative">
        <Icon className="w-4 h-4 text-[var(--color-warning)]" />
        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-[var(--color-warning)] rounded-full animate-pulse" />
      </span>
    );
  }
  return <Icon className="w-4 h-4 text-dim" />;
}

function TypeBadge({ type }: { type: string }) {
  return (
    <span className="text-[10px] text-dim px-1.5 py-0.5 bg-tertiary rounded flex-shrink-0">
      {type}
    </span>
  );
}

export function CommandPalette({ onClose }: CommandPaletteProps) {
  const [search, setSearch] = useState('');
  const navigate = useNavigate();
  const { navigateToPanel, closePanel } = usePanelNavigation();
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: sidebar } = useQuery({
    queryKey: ['sidebar'],
    queryFn: sidebarApi.get,
  });

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: projectsApi.list,
  });

  // Waiting sessions extracted from sidebar
  const waitingSessions = useMemo(() => {
    const results: Array<{
      session: SidebarSession;
      taskId: string;
      taskTitle: string;
      projectName: string;
    }> = [];
    if (!sidebar?.projects) return results;
    for (const p of sidebar.projects) {
      for (const t of p.tasks) {
        for (const s of t.sessions) {
          if (s.status === 'waiting_input') {
            results.push({
              session: s,
              taskId: t.id,
              taskTitle: t.title,
              projectName: p.name,
            });
          }
        }
      }
    }
    return results;
  }, [sidebar]);

  const select = useCallback((fn: () => void) => {
    fn();
    onClose();
  }, [onClose]);

  // Close on click outside the command container
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
      onClose();
    }
  }, [onClose]);

  return createPortal(
    <AnimatePresence>
      <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh]" onClick={handleBackdropClick}>
        {/* Backdrop */}
        <motion.div
          className="absolute inset-0 bg-[var(--color-bg-primary)]/60 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        />

        {/* Palette container */}
        <motion.div
          ref={containerRef}
          className="relative w-full max-w-xl"
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.97 }}
          transition={{ duration: 0.15 }}
        >
          <Command
            loop
            className="bg-[var(--color-card)] border border-[var(--color-card-border)] rounded-xl shadow-card-hover overflow-hidden"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              }
            }}
          >
            {/* Search input */}
            <div className="flex items-center gap-2 px-3 border-b border-subtle">
              <Search className="w-4 h-4 text-dim flex-shrink-0" />
              <Command.Input
                value={search}
                onValueChange={setSearch}
                placeholder="Search projects, tasks..."
                className="flex-1 bg-transparent text-sm text-[var(--color-text-primary)] py-3 focus:outline-none placeholder:text-dim"
                autoFocus
              />
              <kbd className="text-[10px] text-dim bg-tertiary px-1.5 py-0.5 rounded">esc</kbd>
            </div>

            {/* Results list */}
            <Command.List className="max-h-[50vh] overflow-y-auto p-1 cmdk-list">
              <Command.Empty className="px-4 py-6 text-sm text-dim text-center">
                No results found
              </Command.Empty>

              {/* Projects */}
              {projects && projects.length > 0 && (
                <Command.Group heading="Projects" className="cmdk-group">
                  {projects.filter(p => !p.hidden).map((p) => (
                    <Command.Item
                      key={`project-${p.id}`}
                      value={`project ${p.name}`}
                      keywords={[p.path, p.gitOrigin ?? '', p.defaultBranch]}
                      onSelect={() => select(() => navigateToPanel(`/projects/${p.id}`))}
                      className="cmdk-item"
                    >
                      <FolderGit2 className="w-4 h-4 text-accent flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">{p.name}</div>
                        <div className="text-[10px] text-dim truncate">{p.path}</div>
                      </div>
                      <TypeBadge type="project" />
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              {/* Tasks */}
              {sidebar?.projects && sidebar.projects.some(p => p.tasks.length > 0) && (
                <Command.Group heading="Tasks" className="cmdk-group">
                  {sidebar.projects.flatMap((p) =>
                    p.tasks.map((t) => (
                      <Command.Item
                        key={`task-${t.id}`}
                        value={`task ${t.title} ${p.name}`}
                        keywords={[
                          p.name,
                          t.status.replace('_', ' '),
                          t.branch ?? '',
                        ]}
                        onSelect={() => select(() => navigateToPanel(`/tasks/${t.id}`))}
                        className="cmdk-item"
                      >
                        {taskStatusIcon(t.status)}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm truncate">{t.title}</div>
                          <div className="text-[10px] text-dim truncate">
                            {p.name} &middot; {t.status.replace('_', ' ')}
                          </div>
                        </div>
                        <TypeBadge type="task" />
                      </Command.Item>
                    ))
                  )}
                </Command.Group>
              )}

              {/* Waiting sessions */}
              {waitingSessions.length > 0 && (
                <Command.Group heading="Needs Attention" className="cmdk-group">
                  {waitingSessions.map(({ session, taskId, taskTitle, projectName }) => (
                    <Command.Item
                      key={`session-${session.id}`}
                      value={`session ${session.provider} ${taskTitle}`}
                      keywords={[
                        taskTitle,
                        projectName,
                        session.status.replace('_', ' '),
                        session.provider,
                        'waiting',
                      ]}
                      onSelect={() => select(() => navigateToPanel(`/tasks/${taskId}?session=${session.id}`))}
                      className="cmdk-item"
                    >
                      {sessionIcon(session)}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">
                          {session.provider} #{session.number}
                        </div>
                        <div className="text-[10px] text-dim truncate">
                          {taskTitle} &middot; waiting for input
                        </div>
                      </div>
                      <TypeBadge type="session" />
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              {/* Actions */}
              <Command.Group heading="Actions" className="cmdk-group">
                <Command.Item
                  value="Dashboard"
                  onSelect={() => select(() => closePanel())}
                  className="cmdk-item"
                >
                  <LayoutDashboard className="w-4 h-4 text-dim flex-shrink-0" />
                  <span className="text-sm flex-1">Go to Dashboard</span>
                </Command.Item>
                <Command.Item
                  value="Create Task"
                  keywords={['new', 'add']}
                  onSelect={() => select(() => navigate('/tasks/quick'))}
                  className="cmdk-item"
                >
                  <Plus className="w-4 h-4 text-dim flex-shrink-0" />
                  <span className="text-sm flex-1">Create Task</span>
                </Command.Item>
                {projects?.filter(p => !p.hidden).map((p) => (
                  <Command.Item
                    key={`filter-${p.id}`}
                    value={`Filter ${p.name}`}
                    keywords={[p.name, 'dashboard', 'board']}
                    onSelect={() => select(() => navigate(`/?project=${p.id}`))}
                    className="cmdk-item"
                  >
                    <Filter className="w-4 h-4 text-dim flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">Filter: {p.name}</div>
                      <div className="text-[10px] text-dim truncate">Show only this project on the board</div>
                    </div>
                  </Command.Item>
                ))}
                <Command.Item
                  value="Settings"
                  keywords={['preferences', 'config']}
                  onSelect={() => select(() => navigate('/settings'))}
                  className="cmdk-item"
                >
                  <Settings className="w-4 h-4 text-dim flex-shrink-0" />
                  <span className="text-sm flex-1">Settings</span>
                </Command.Item>
              </Command.Group>
            </Command.List>

            {/* Footer */}
            <div className="px-3 py-2 border-t border-subtle flex gap-4 text-[10px] text-dim">
              <span><kbd className="bg-tertiary px-1 py-0.5 rounded">&#8593;&#8595;</kbd> navigate</span>
              <span><kbd className="bg-tertiary px-1 py-0.5 rounded">&#8629;</kbd> open</span>
              <span><kbd className="bg-tertiary px-1 py-0.5 rounded">esc</kbd> close</span>
            </div>
          </Command>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body,
  );
}

// Hook to manage Cmd+K keybinding
// eslint-disable-next-line react-refresh/only-export-components
export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return { open, setOpen };
}
