import { api } from './client';
import type { AuthStatus, AuthToken, PasskeyInfo } from './types';

export const authApi = {
  getStatus: () => api.get<AuthStatus>('/auth/status'),

  setup: (password: string) =>
    api.post<AuthToken>('/auth/setup', { password }),

  login: (password: string) =>
    api.post<AuthToken>('/auth/login', { password }),

  me: () => api.get<{ user: string }>('/auth/me'),

  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<{ status: string }>('/auth/password', { currentPassword, newPassword }),

  // Passkey registration (protected)
  passkeyRegisterBegin: () =>
    api.post<PublicKeyCredentialCreationOptionsJSON>('/auth/passkey/register/begin'),

  passkeyRegisterFinish: (data: unknown) =>
    api.post<{ id: string; name: string }>('/auth/passkey/register/finish', data),

  // Passkey login (public)
  passkeyLoginBegin: () =>
    api.post<PublicKeyCredentialRequestOptionsJSON>('/auth/passkey/login/begin'),

  passkeyLoginFinish: (data: unknown) =>
    api.post<AuthToken>('/auth/passkey/login/finish', data),

  // Passkey management (protected)
  listPasskeys: () =>
    api.get<PasskeyInfo[]>('/auth/passkeys'),

  updatePasskey: (id: string, data: { name: string }) =>
    api.patch<{ status: string }>(`/auth/passkeys/${id}`, data),

  deletePasskey: (id: string) =>
    api.delete(`/auth/passkeys/${id}`),

  // Telegram auth (public)
  telegramAuth: (initData: string) =>
    api.post<AuthToken>('/auth/telegram', { initData }),

  // Telegram bot management (protected)
  restartTelegramBot: () =>
    api.post<{ status: string }>('/telegram/bot/restart'),
};

// WebAuthn JSON types (from W3C spec)
interface PublicKeyCredentialCreationOptionsJSON {
  publicKey: {
    rp: { name: string; id: string };
    user: { id: string; name: string; displayName: string };
    challenge: string;
    pubKeyCredParams: Array<{ type: string; alg: number }>;
    timeout?: number;
    excludeCredentials?: Array<{ type: string; id: string; transports?: string[] }>;
    authenticatorSelection?: {
      authenticatorAttachment?: string;
      residentKey?: string;
      requireResidentKey?: boolean;
      userVerification?: string;
    };
    attestation?: string;
  };
}

interface PublicKeyCredentialRequestOptionsJSON {
  publicKey: {
    challenge: string;
    timeout?: number;
    rpId?: string;
    allowCredentials?: Array<{ type: string; id: string; transports?: string[] }>;
    userVerification?: string;
  };
}
