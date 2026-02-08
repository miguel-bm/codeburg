import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import '@xterm/xterm/css/xterm.css';

const TERMINAL_THEME = {
  background: '#0a0a0a',
  foreground: '#e0e0e0',
  cursor: '#22c55e',
  cursorAccent: '#0a0a0a',
  selectionBackground: '#22c55e33',
  black: '#0a0a0a',
  red: '#ef4444',
  green: '#22c55e',
  yellow: '#eab308',
  blue: '#3b82f6',
  magenta: '#a855f7',
  cyan: '#06b6d4',
  white: '#e0e0e0',
  brightBlack: '#525252',
  brightRed: '#f87171',
  brightGreen: '#4ade80',
  brightYellow: '#facc15',
  brightBlue: '#60a5fa',
  brightMagenta: '#c084fc',
  brightCyan: '#22d3ee',
  brightWhite: '#ffffff',
};

interface UseTerminalOptions {
  sessionId?: string;
}

export interface UseTerminalReturn {
  sendInput: (data: string) => void;
}

export function useTerminal(
  containerRef: React.RefObject<HTMLDivElement | null>,
  target: string,
  options?: UseTerminalOptions,
): UseTerminalReturn {
  const terminalInstance = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const connectTerminal = useCallback(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
      theme: TERMINAL_THEME,
      scrollback: 5000,
    });

    terminalInstance.current = term;

    const fit = new FitAddon();
    fitAddon.current = fit;
    term.loadAddon(fit);
    term.loadAddon(new ClipboardAddon());

    term.open(containerRef.current);
    fit.fit();

    // Connect WebSocket
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let wsUrl = `${protocol}//${window.location.host}/ws/terminal?target=${encodeURIComponent(target)}`;
    if (options?.sessionId) {
      wsUrl += `&session=${encodeURIComponent(options.sessionId)}`;
    }
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      term.writeln('\x1b[32m// connected\x1b[0m');
      term.writeln('');

      ws.send(JSON.stringify({
        type: 'resize',
        cols: term.cols,
        rows: term.rows,
      }));
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(event.data));
      } else {
        term.write(event.data);
      }
    };

    ws.onerror = () => {
      term.writeln('\x1b[31m// connection error\x1b[0m');
    };

    ws.onclose = () => {
      term.writeln('');
      term.writeln('\x1b[33m// disconnected\x1b[0m');
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    });

    term.focus();
  }, [target, options?.sessionId, containerRef]);

  // Connect on mount, cleanup on unmount
  useEffect(() => {
    connectTerminal();

    return () => {
      wsRef.current?.close();
      terminalInstance.current?.dispose();
    };
  }, [connectTerminal]);

  // Re-fit on container size change
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      fitAddon.current?.fit();
    });
    observer.observe(container);

    return () => observer.disconnect();
  }, [containerRef]);

  const sendInput = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(data);
    }
  }, []);

  return { sendInput };
}
