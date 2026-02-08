import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Layout } from '../components/layout/Layout';
import { authApi } from '../api';
import { useAuthStore } from '../stores/auth';

export function Settings() {
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);

  return (
    <Layout>
      <div className="flex flex-col h-full">
        {/* Header */}
        <header className="bg-secondary border-b border-subtle px-6 py-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/')}
              className="text-dim hover:text-[var(--color-text-primary)] transition-colors"
            >
              &lt; back
            </button>
            <h1 className="text-lg font-medium">// settings</h1>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-md space-y-8">
            {/* Password Change */}
            <PasswordChangeForm />

            {/* Logout */}
            <div>
              <h2 className="text-sm text-dim mb-3">// session</h2>
              <button
                onClick={logout}
                className="px-4 py-2 border border-[var(--color-error)] text-[var(--color-error)] text-sm hover:bg-[var(--color-error)] hover:text-[var(--color-bg-primary)] transition-colors"
              >
                logout
              </button>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}

function PasswordChangeForm() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const mutation = useMutation({
    mutationFn: () => authApi.changePassword(currentPassword, newPassword),
    onSuccess: () => {
      setSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setError('');
      setTimeout(() => setSuccess(false), 3000);
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to change password');
      setSuccess(false);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    mutation.mutate();
  };

  return (
    <div>
      <h2 className="text-sm text-dim mb-3">// change_password</h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && (
          <div className="border border-[var(--color-error)] p-3 text-sm text-[var(--color-error)]">
            {error}
          </div>
        )}
        {success && (
          <div className="border border-accent p-3 text-sm text-accent">
            password changed successfully
          </div>
        )}
        <div>
          <label className="block text-sm text-dim mb-1">current password</label>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="block w-full px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] focus:border-accent focus:outline-none"
            required
          />
        </div>
        <div>
          <label className="block text-sm text-dim mb-1">new password</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="block w-full px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] focus:border-accent focus:outline-none"
            required
            minLength={8}
          />
        </div>
        <div>
          <label className="block text-sm text-dim mb-1">confirm new password</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="block w-full px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] focus:border-accent focus:outline-none"
            required
            minLength={8}
          />
        </div>
        <button
          type="submit"
          disabled={mutation.isPending}
          className="px-4 py-2 border border-accent text-accent text-sm hover:bg-accent hover:text-[var(--color-bg-primary)] transition-colors disabled:opacity-50"
        >
          {mutation.isPending ? 'changing...' : 'change password'}
        </button>
      </form>
    </div>
  );
}
