import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAuthToken,
  configureAuthTokenStorage,
  getAuthToken,
  setAuthToken,
} from './authTokenStorage';

describe('authTokenStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    configureAuthTokenStorage(null);
    delete window.__CODEBURG_TOKEN_STORAGE__;
  });

  it('reads and writes token via localStorage by default', () => {
    expect(getAuthToken()).toBeNull();
    setAuthToken('abc123');
    expect(getAuthToken()).toBe('abc123');
    clearAuthToken();
    expect(getAuthToken()).toBeNull();
  });

  it('uses window adapter when provided', () => {
    const adapter = {
      getToken: vi.fn(() => 'desktop-token'),
      setToken: vi.fn(),
      clearToken: vi.fn(),
    };
    window.__CODEBURG_TOKEN_STORAGE__ = adapter;

    expect(getAuthToken()).toBe('desktop-token');
    setAuthToken('new-token');
    clearAuthToken();

    expect(adapter.getToken).toHaveBeenCalledTimes(1);
    expect(adapter.setToken).toHaveBeenCalledWith('new-token');
    expect(adapter.clearToken).toHaveBeenCalledTimes(1);
  });
});
