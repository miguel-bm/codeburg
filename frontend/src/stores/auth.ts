import { create } from 'zustand';
import { authApi } from '../api';
import { setOnUnauthorized } from '../api/client';

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  needsSetup: boolean | null;
  token: string | null;

  checkStatus: () => Promise<void>;
  login: (password: string) => Promise<void>;
  setup: (password: string) => Promise<void>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: !!localStorage.getItem('token'),
  isLoading: true,
  needsSetup: null,
  token: localStorage.getItem('token'),

  checkStatus: async () => {
    try {
      const status = await authApi.getStatus();
      set({ needsSetup: !status.setup, isLoading: false });

      // If we have a token, validate it
      const token = localStorage.getItem('token');
      if (token && status.setup) {
        try {
          await authApi.me();
          set({ isAuthenticated: true });
        } catch {
          // Token invalid, clear it
          localStorage.removeItem('token');
          set({ isAuthenticated: false, token: null });
        }
      }
    } catch {
      set({ isLoading: false });
    }
  },

  login: async (password: string) => {
    const { token } = await authApi.login(password);
    localStorage.setItem('token', token);
    set({ isAuthenticated: true, token });
  },

  setup: async (password: string) => {
    const { token } = await authApi.setup(password);
    localStorage.setItem('token', token);
    set({ isAuthenticated: true, needsSetup: false, token });
  },

  logout: () => {
    localStorage.removeItem('token');
    set({ isAuthenticated: false, token: null });
  },
}));

// Wire up 401 interception → logout (avoids circular import with api/client)
setOnUnauthorized(() => useAuthStore.getState().logout());
