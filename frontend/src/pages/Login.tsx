import { useState } from 'react';
import { useAuthStore } from '../stores/auth';

export function Login() {
  const { needsSetup, login, setup } = useAuthStore();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

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
        await setup(password);
      } else {
        await login(password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-primary px-4">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-center text-accent">
            CODEBURG
          </h1>
          <p className="mt-2 text-center text-dim text-sm">
            {needsSetup ? '// initialize password' : '// authenticate'}
          </p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {error && (
            <div className="border border-[var(--color-error)] p-3 text-sm text-[var(--color-error)]">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label htmlFor="password" className="block text-sm text-dim mb-1">
                password
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="block w-full px-3 py-2 border border-subtle bg-secondary text-[var(--color-text-primary)] focus:border-accent focus:outline-none"
                placeholder="********"
              />
            </div>

            {needsSetup && (
              <div>
                <label htmlFor="confirmPassword" className="block text-sm text-dim mb-1">
                  confirm_password
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="block w-full px-3 py-2 border border-subtle bg-secondary text-[var(--color-text-primary)] focus:border-accent focus:outline-none"
                  placeholder="********"
                />
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2 px-4 border border-accent text-accent hover:bg-accent hover:text-[var(--color-bg-primary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'loading...' : needsSetup ? 'initialize' : 'login'}
          </button>
        </form>
      </div>
    </div>
  );
}
