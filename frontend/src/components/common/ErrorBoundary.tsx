import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="min-h-screen flex items-center justify-center bg-primary p-8">
        <div className="max-w-lg w-full border border-highlight p-6">
          <h1 className="text-lg font-bold text-highlight mb-2">something broke</h1>
          <p className="text-dim text-sm mb-4">
            An unexpected error crashed the UI. You can try reloading the page.
          </p>
          <pre className="text-xs text-red-400 bg-black/50 p-3 overflow-auto max-h-40 mb-4 border border-border">
            {this.state.error?.message}
          </pre>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-highlight text-black text-sm font-bold hover:opacity-80"
          >
            reload
          </button>
        </div>
      </div>
    );
  }
}
