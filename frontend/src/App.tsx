import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from './stores/auth';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { TaskDetail } from './pages/TaskDetail';
import { TaskCreate } from './pages/task/TaskCreate';
import { ProjectSettings } from './pages/ProjectSettings';
import { Settings } from './pages/Settings';
import { CommandPalette, useCommandPalette } from './components/common/CommandPalette';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { useNotifications } from './hooks/useNotifications';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 minute
      retry: 1,
    },
  },
});

function AuthGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, needsSetup, checkStatus } = useAuthStore();

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-primary">
        <div className="text-dim">loading...</div>
      </div>
    );
  }

  if (!isAuthenticated || needsSetup) {
    return <Login />;
  }

  return <>{children}</>;
}

function AppShell() {
  useNotifications();
  const { open: paletteOpen, setOpen: setPaletteOpen } = useCommandPalette();

  return (
    <>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/tasks/new" element={<TaskCreate />} />
        <Route path="/tasks/:id" element={<TaskDetail />} />
        <Route path="/projects/:id/settings" element={<ProjectSettings />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthGate>
            <AppShell />
          </AuthGate>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
