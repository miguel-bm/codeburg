import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import { useTerminalSettings } from '../stores/terminal';

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

const MAX_RETRIES = 5;
const RETRY_DELAYS = [1000, 2000, 4000, 8000, 16000];

interface UseTerminalOptions {
  sessionId?: string;
  sessionStatus?: string;
}

export interface UseTerminalReturn {
  sendInput: (data: string) => void;
  actions: {
    copySelection: () => void;
    pasteClipboard: () => void;
    selectAll: () => void;
    clearSelection: () => void;
    clear: () => void;
    reset: () => void;
    scrollToBottom: () => void;
    hasSelection: () => boolean;
  };
}

export function useTerminal(
  containerRef: React.RefObject<HTMLDivElement | null>,
  target: string,
  options?: UseTerminalOptions,
): UseTerminalReturn {
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stableTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disposedRef = useRef(false);
  const awaitingManualReconnectRef = useRef(false);
  const sessionStatusRef = useRef(options?.sessionStatus);

  const settings = useTerminalSettings();

  // Keep ref in sync so closures always see latest status
  sessionStatusRef.current = options?.sessionStatus;

  // Build the WebSocket URL (stable across reconnects)
  const wsUrl = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let url = `${protocol}//${window.location.host}/ws/terminal?target=${encodeURIComponent(target)}`;
    if (options?.sessionId) {
      url += `&session=${encodeURIComponent(options.sessionId)}`;
    }
    return url;
  }, [target, options?.sessionId]);

  // Connect (or reconnect) the WebSocket to an existing Terminal
  const connectWS = useCallback((term: Terminal) => {
    if (disposedRef.current) return;

    const ws = new WebSocket(wsUrl());
    wsRef.current = ws;
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      const wasRetry = retryCountRef.current > 0;
      awaitingManualReconnectRef.current = false;

      if (wasRetry) {
        term.writeln('\x1b[32m// reconnected\x1b[0m');
      } else {
        term.writeln('\x1b[32m// connected\x1b[0m');
      }
      term.writeln('');

      ws.send(JSON.stringify({
        type: 'resize',
        cols: term.cols,
        rows: term.rows,
      }));

      // Only reset retry counter after connection is stable for 3s.
      // Prevents infinite retry loops when the server immediately closes
      // (e.g. tmux window gone → "can't find window" → close).
      if (stableTimerRef.current) clearTimeout(stableTimerRef.current);
      stableTimerRef.current = setTimeout(() => {
        retryCountRef.current = 0;
      }, 3000);
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(event.data));
      } else {
        term.write(event.data);
      }
    };

    ws.onerror = () => {
      // onclose will fire after this, handle retry there
    };

    ws.onclose = (event) => {
      if (stableTimerRef.current) clearTimeout(stableTimerRef.current);
      if (disposedRef.current) return;

      // Backend sent 4000 = tmux window no longer exists
      if (event.code === 4000) {
        term.writeln('');
        term.writeln('\x1b[33m// session ended — terminal no longer available\x1b[0m');
        return;
      }

      // Session is finished — don't retry
      const status = sessionStatusRef.current;
      if (status === 'completed' || status === 'error') {
        term.writeln('');
        term.writeln('\x1b[33m// session ended\x1b[0m');
        return;
      }

      if (retryCountRef.current < MAX_RETRIES) {
        const delay = RETRY_DELAYS[retryCountRef.current];
        term.writeln('');
        term.writeln(`\x1b[33m// disconnected — retrying in ${delay / 1000}s...\x1b[0m`);
        retryTimerRef.current = setTimeout(() => {
          retryCountRef.current++;
          connectWS(term);
        }, delay);
      } else {
        term.writeln('');
        term.writeln('\x1b[33m// disconnected — press any key to reconnect\x1b[0m');
        awaitingManualReconnectRef.current = true;
      }
    };
  }, [wsUrl]);

  // Create terminal + initial WS connection
  useEffect(() => {
    if (!containerRef.current) return;
    disposedRef.current = false;

    const term = new Terminal({
      cursorBlink: settings.cursorBlink,
      cursorStyle: settings.cursorStyle,
      fontSize: settings.fontSize,
      scrollback: settings.scrollback,
      fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
      theme: TERMINAL_THEME,
      allowProposedApi: true,
      macOptionClickForcesSelection: true,
    });
    termRef.current = term;

    // Core addons
    const fit = new FitAddon();
    fitAddonRef.current = fit;
    term.loadAddon(fit);
    term.loadAddon(new ClipboardAddon());

    const unicode11 = new Unicode11Addon();
    term.loadAddon(unicode11);
    term.unicode.activeVersion = '11';

    term.loadAddon(new SearchAddon());

    if (settings.webLinks) {
      term.loadAddon(new WebLinksAddon());
    }

    term.open(containerRef.current);

    if (settings.webgl) {
      try {
        term.loadAddon(new WebglAddon());
      } catch {
        // WebGL not supported
      }
    }

    fit.fit();

    // Input handler — sends to current WS, or triggers reconnect
    term.onData((data) => {
      if (awaitingManualReconnectRef.current) {
        awaitingManualReconnectRef.current = false;
        retryCountRef.current = 0;
        term.writeln('\x1b[33m// reconnecting...\x1b[0m');
        connectWS(term);
        return;
      }
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(data);
      }
    });

    term.onResize(({ cols, rows }) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    });

    // Cmd+C / Ctrl+C: copy selection if present, otherwise send SIGINT
    term.attachCustomKeyEventHandler((event) => {
      if (event.key === 'Enter' && event.shiftKey && event.type === 'keydown') {
        if (awaitingManualReconnectRef.current) {
          awaitingManualReconnectRef.current = false;
          retryCountRef.current = 0;
          term.writeln('\x1b[33m// reconnecting...\x1b[0m');
          connectWS(term);
          return false;
        }
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send('\n');
        }
        return false;
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.code === 'KeyC' && event.type === 'keydown') {
        if (term.hasSelection()) {
          navigator.clipboard.writeText(term.getSelection());
          return false;
        }
      }
      if ((event.metaKey || event.ctrlKey) && event.code === 'KeyC' && event.type === 'keydown') {
        if (term.hasSelection()) {
          navigator.clipboard.writeText(term.getSelection());
          return false;
        }
      }
      // Cmd+V / Ctrl+V: paste from clipboard
      if ((event.metaKey || event.ctrlKey) && event.code === 'KeyV' && event.type === 'keydown') {
        navigator.clipboard.readText().then((text) => {
          if (text && wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(text);
          }
        });
        return false;
      }
      return true;
    });

    term.focus();

    // Start WebSocket connection
    connectWS(term);

    return () => {
      disposedRef.current = true;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (stableTimerRef.current) clearTimeout(stableTimerRef.current);
      wsRef.current?.close();
      term.dispose();
      termRef.current = null;
    };
  }, [target, options?.sessionId, containerRef, connectWS, settings.fontSize, settings.scrollback, settings.cursorStyle, settings.cursorBlink, settings.webLinks, settings.webgl]);

  // Re-fit on container resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      fitAddonRef.current?.fit();
    });
    observer.observe(container);

    return () => observer.disconnect();
  }, [containerRef]);

  const sendInput = useCallback((data: string) => {
    if (awaitingManualReconnectRef.current && termRef.current) {
      awaitingManualReconnectRef.current = false;
      retryCountRef.current = 0;
      termRef.current.writeln('\x1b[33m// reconnecting...\x1b[0m');
      connectWS(termRef.current);
      return;
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(data);
    }
  }, [connectWS]);

  const actions = useRef<UseTerminalReturn['actions']>({
    copySelection: () => {},
    pasteClipboard: () => {},
    selectAll: () => {},
    clearSelection: () => {},
    clear: () => {},
    reset: () => {},
    scrollToBottom: () => {},
    hasSelection: () => false,
  });

  actions.current.copySelection = () => {
    const term = termRef.current;
    if (!term || !term.hasSelection()) return;
    navigator.clipboard.writeText(term.getSelection()).catch(() => {});
  };

  actions.current.pasteClipboard = () => {
    navigator.clipboard.readText().then((text) => {
      if (text && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(text);
      }
    }).catch(() => {});
  };

  actions.current.selectAll = () => {
    termRef.current?.selectAll();
  };

  actions.current.clearSelection = () => {
    termRef.current?.clearSelection();
  };

  actions.current.clear = () => {
    termRef.current?.clear();
  };

  actions.current.reset = () => {
    termRef.current?.reset();
  };

  actions.current.scrollToBottom = () => {
    termRef.current?.scrollToBottom();
  };

  actions.current.hasSelection = () => {
    return termRef.current?.hasSelection() ?? false;
  };

  return { sendInput, actions: actions.current };
}
