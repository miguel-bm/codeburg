import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api, ApiError } from './client';

describe('API Client', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(status: number, body: unknown, ok = status < 400) {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok,
      status,
      json: () => Promise.resolve(body),
    });
  }

  it('makes GET requests with correct path', async () => {
    mockFetch(200, { id: '1' });

    const result = await api.get<{ id: string }>('/projects');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/projects',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
      })
    );
    expect(result).toEqual({ id: '1' });
  });

  it('makes POST requests with body', async () => {
    mockFetch(200, { id: '1' });

    await api.post('/projects', { name: 'test' });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/projects',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'test' }),
      })
    );
  });

  it('makes PATCH requests with body', async () => {
    mockFetch(200, { id: '1', name: 'updated' });

    await api.patch('/projects/1', { name: 'updated' });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/projects/1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ name: 'updated' }),
      })
    );
  });

  it('makes DELETE requests', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: () => Promise.reject(new Error('no body')),
    });

    await api.delete('/projects/1');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/projects/1',
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('includes auth token from localStorage', async () => {
    localStorage.setItem('token', 'test-jwt-token');
    mockFetch(200, {});

    await api.get('/projects');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/projects',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-jwt-token',
        }),
      })
    );
  });

  it('does not include auth header when no token', async () => {
    mockFetch(200, {});

    await api.get('/projects');

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const headers = call[1].headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });

  it('throws ApiError on non-OK response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: 'Not found' }),
    });

    await expect(api.get('/projects/nonexistent')).rejects.toThrow(ApiError);

    try {
      await api.get('/projects/nonexistent');
    } catch (e) {
      const err = e as ApiError;
      expect(err.status).toBe(404);
      expect(err.message).toBe('Not found');
    }
  });

  it('handles 401 unauthorized', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: 'Unauthorized' }),
    });

    await expect(api.get('/projects')).rejects.toThrow('Unauthorized');
  });

  it('handles non-JSON error response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error('not json')),
    });

    await expect(api.get('/projects')).rejects.toThrow('Unknown error');
  });

  it('returns undefined for 204 No Content', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: () => Promise.reject(new Error('no body')),
    });

    const result = await api.delete('/projects/1');
    expect(result).toBeUndefined();
  });
});
