import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAuthStore } from './auth';

// Mock the authApi module
vi.mock('../api', () => ({
  authApi: {
    getStatus: vi.fn(),
    me: vi.fn(),
    login: vi.fn(),
    setup: vi.fn(),
  },
}));

import { authApi } from '../api';

const mockedAuthApi = vi.mocked(authApi);

describe('Auth Store', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    // Reset store state
    useAuthStore.setState({
      isAuthenticated: false,
      isLoading: true,
      needsSetup: null,
      token: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes with default state', () => {
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.isLoading).toBe(true);
    expect(state.needsSetup).toBeNull();
    expect(state.token).toBeNull();
  });

  it('login stores token and updates state', async () => {
    mockedAuthApi.login.mockResolvedValue({ token: 'test-token' });

    await useAuthStore.getState().login('password123');

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.token).toBe('test-token');
    expect(localStorage.getItem('token')).toBe('test-token');
  });

  it('setup stores token and clears needsSetup', async () => {
    mockedAuthApi.setup.mockResolvedValue({ token: 'setup-token' });

    await useAuthStore.getState().setup('new-password');

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.needsSetup).toBe(false);
    expect(state.token).toBe('setup-token');
    expect(localStorage.getItem('token')).toBe('setup-token');
  });

  it('logout clears token and state', () => {
    localStorage.setItem('token', 'some-token');
    useAuthStore.setState({ isAuthenticated: true, token: 'some-token' });

    useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.token).toBeNull();
    expect(localStorage.getItem('token')).toBeNull();
  });

  it('checkStatus detects first-time setup needed', async () => {
    mockedAuthApi.getStatus.mockResolvedValue({ setup: false });

    await useAuthStore.getState().checkStatus();

    const state = useAuthStore.getState();
    expect(state.needsSetup).toBe(true);
    expect(state.isLoading).toBe(false);
  });

  it('checkStatus validates existing token', async () => {
    localStorage.setItem('token', 'existing-token');
    mockedAuthApi.getStatus.mockResolvedValue({ setup: true });
    mockedAuthApi.me.mockResolvedValue({ user: 'admin' });

    await useAuthStore.getState().checkStatus();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.isLoading).toBe(false);
    expect(mockedAuthApi.me).toHaveBeenCalled();
  });

  it('checkStatus clears invalid token', async () => {
    localStorage.setItem('token', 'expired-token');
    mockedAuthApi.getStatus.mockResolvedValue({ setup: true });
    mockedAuthApi.me.mockRejectedValue(new Error('Unauthorized'));

    await useAuthStore.getState().checkStatus();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.token).toBeNull();
    expect(localStorage.getItem('token')).toBeNull();
  });

  it('checkStatus handles network error', async () => {
    mockedAuthApi.getStatus.mockRejectedValue(new Error('Network error'));

    await useAuthStore.getState().checkStatus();

    const state = useAuthStore.getState();
    expect(state.isLoading).toBe(false);
  });
});
