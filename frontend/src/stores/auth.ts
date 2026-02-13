import { startAuthentication } from '@simplewebauthn/browser';
import { create } from 'zustand';
import { authApi } from '../api';
import { setOnUnauthorized } from '../api/client';
import { clearAuthToken, getAuthToken, setAuthToken } from '../platform/authTokenStorage';

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData?: string;
      };
    };
  }
}

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  needsSetup: boolean | null;
  hasPasskeys: boolean;
  hasTelegram: boolean;
  token: string | null;

  checkStatus: () => Promise<void>;
  login: (password: string) => Promise<void>;
  loginWithPasskey: () => Promise<void>;
  loginWithTelegram: (initData: string) => Promise<void>;
  setup: (password: string) => Promise<void>;
  logout: () => void;
}

type StartAuthenticationOptionsJSON = Parameters<typeof startAuthentication>[0]['optionsJSON'];

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: !!getAuthToken(),
  isLoading: true,
  needsSetup: null,
  hasPasskeys: false,
  hasTelegram: false,
  token: getAuthToken(),

  checkStatus: async () => {
    try {
      const status = await authApi.getStatus();
      set({
        needsSetup: !status.setup,
        hasPasskeys: status.hasPasskeys,
        hasTelegram: status.hasTelegram,
        isLoading: false,
      });

      // Auto-login via Telegram Web App if available
      const initData = window.Telegram?.WebApp?.initData;
      if (initData && status.hasTelegram && status.setup) {
        try {
          const { token } = await authApi.telegramAuth(initData);
          setAuthToken(token);
          set({ isAuthenticated: true, token });
          return;
        } catch {
          // Fall through to normal token validation
        }
      }

      // If we have a token, validate it
      const token = getAuthToken();
      if (token && status.setup) {
        try {
          await authApi.me();
          set({ isAuthenticated: true });
        } catch {
          // Token invalid, clear it
          clearAuthToken();
          set({ isAuthenticated: false, token: null });
        }
      }
    } catch {
      set({ isLoading: false });
    }
  },

  login: async (password: string) => {
    const { token } = await authApi.login(password);
    setAuthToken(token);
    set({ isAuthenticated: true, token });
  },

  loginWithPasskey: async () => {
    const resp = await authApi.passkeyLoginBegin();
    // go-webauthn wraps in { publicKey: {...} }, @simplewebauthn expects the inner object
    const optionsJSON = (
      typeof resp === 'object'
      && resp !== null
      && 'publicKey' in resp
    )
      ? (resp.publicKey as StartAuthenticationOptionsJSON)
      : (resp as StartAuthenticationOptionsJSON);
    const assertion = await startAuthentication({ optionsJSON });
    const { token } = await authApi.passkeyLoginFinish(assertion);
    setAuthToken(token);
    set({ isAuthenticated: true, token });
  },

  loginWithTelegram: async (initData: string) => {
    const { token } = await authApi.telegramAuth(initData);
    setAuthToken(token);
    set({ isAuthenticated: true, token });
  },

  setup: async (password: string) => {
    const { token } = await authApi.setup(password);
    setAuthToken(token);
    set({ isAuthenticated: true, needsSetup: false, token });
  },

  logout: () => {
    clearAuthToken();
    set({ isAuthenticated: false, token: null });
  },
}));

// Wire up 401 interception → logout (avoids circular import with api/client)
setOnUnauthorized(() => useAuthStore.getState().logout());
