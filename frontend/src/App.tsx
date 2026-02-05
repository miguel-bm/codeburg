import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from './stores/auth';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 minute
      retry: 1,
    },
  },
});

function AuthGate() {
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

  return <Dashboard />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthGate />
    </QueryClientProvider>
  );
}

export default App;
