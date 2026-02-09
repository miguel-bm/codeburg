import { useState } from 'react';
import { Fingerprint } from 'lucide-react';
import { useAuthStore } from '../stores/auth';

export function Login() {
  const { needsSetup, hasPasskeys, login, loginWithPasskey } = useAuthStore();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      if (needsSetup) {
        if (password !== confirmPassword) {
          setError('Passwords do not match');
          setIsLoading(false);
          return;
        }
        if (password.length < 8) {
          setError('Password must be at least 8 characters');
          setIsLoading(false);
          return;
        }
        await useAuthStore.getState().setup(password);
      } else {
        await login(password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasskeyLogin = async () => {
    setError('');
    setPasskeyLoading(true);
    try {
      await loginWithPasskey();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Passkey login failed');
    } finally {
      setPasskeyLoading(false);
    }
  };

  const showPasskeyButton = hasPasskeys && !needsSetup;

  return (
    <div className="min-h-screen flex items-center justify-center bg-primary px-4">
      <div className="max-w-sm w-full space-y-8">
        <div>
          <h1 className="text-2xl font-semibold text-center text-[var(--color-text-primary)]">
            Codeburg
          </h1>
          <p className="mt-2 text-center text-dim text-sm">
            {needsSetup ? 'Set up your password' : 'Sign in to continue'}
          </p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {error && (
            <div className="border border-[var(--color-error)] rounded-md p-3 text-sm text-[var(--color-error)]">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label htmlFor="password" className="block text-sm text-dim mb-1">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="block w-full px-3 py-2 border border-subtle bg-secondary text-[var(--color-text-primary)] rounded-md focus:outline-none focus:border-[var(--color-text-secondary)]"
                placeholder="********"
              />
            </div>

            {needsSetup && (
              <div>
                <label htmlFor="confirmPassword" className="block text-sm text-dim mb-1">
                  Confirm password
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="block w-full px-3 py-2 border border-subtle bg-secondary text-[var(--color-text-primary)] rounded-md focus:outline-none focus:border-[var(--color-text-secondary)]"
                  placeholder="********"
                />
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2 px-4 bg-accent text-white rounded-md font-medium hover:bg-accent-dim transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Loading...' : needsSetup ? 'Initialize' : 'Sign in'}
          </button>
        </form>

        {showPasskeyButton && (
          <>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-[var(--color-border)]" />
              <span className="text-xs text-dim">or</span>
              <div className="flex-1 h-px bg-[var(--color-border)]" />
            </div>

            <button
              onClick={handlePasskeyLogin}
              disabled={passkeyLoading}
              className="w-full py-2 px-4 border border-subtle bg-secondary text-[var(--color-text-primary)] rounded-md font-medium hover:bg-tertiary transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <Fingerprint size={18} />
              {passkeyLoading ? 'Waiting for passkey...' : 'Sign in with passkey'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
