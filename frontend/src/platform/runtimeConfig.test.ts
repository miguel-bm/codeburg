import { beforeEach, describe, expect, it } from 'vitest';
import { buildWsUrl, getApiHttpBase, getApiWsBase } from './runtimeConfig';

describe('runtimeConfig', () => {
  beforeEach(() => {
    delete window.__CODEBURG_CONFIG__;
  });

  it('uses same-origin defaults for web', () => {
    expect(getApiHttpBase()).toBe('/api');
    expect(getApiWsBase()).toBe('ws://localhost:3000');
    expect(buildWsUrl('/ws')).toBe('ws://localhost:3000/ws');
  });

  it('uses explicit runtime config values', () => {
    window.__CODEBURG_CONFIG__ = {
      apiHttpBase: 'https://codeburg.example.com/api/',
      apiWsBase: 'wss://codeburg.example.com/',
    };

    expect(getApiHttpBase()).toBe('https://codeburg.example.com/api');
    expect(getApiWsBase()).toBe('wss://codeburg.example.com');
    expect(buildWsUrl('/ws/terminal?session=abc')).toBe('wss://codeburg.example.com/ws/terminal?session=abc');
  });
});
