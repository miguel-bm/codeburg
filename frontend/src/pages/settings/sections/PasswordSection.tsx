import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Lock } from 'lucide-react';
import { authApi } from '../../../api';
import { Button } from '../../../components/ui/Button';
import { SectionBody, SectionCard, SectionHeader } from '../../../components/ui/settings';

export function PasswordSection() {
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

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
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

  const inputClass =
    'block w-full px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] rounded-md text-sm focus:outline-none focus:border-accent transition-colors';

  return (
    <SectionCard>
      <SectionHeader
        title="Password"
        description="Manage your account password"
        icon={<Lock size={15} />}
      />
      <SectionBody>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-md bg-[var(--color-error)]/8 border border-[var(--color-error)]/30 text-sm text-[var(--color-error)]">
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
              {error}
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-md bg-[var(--color-success)]/8 border border-[var(--color-success)]/30 text-sm text-[var(--color-success)]">
              <CheckCircle2 size={16} className="flex-shrink-0" />
              Password changed successfully
            </div>
          )}

          <div>
            <label className="block text-sm text-dim mb-1.5">Current password</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className={inputClass}
              required
            />
          </div>

          <div className="h-px bg-[var(--color-border)] -mx-5" />

          <div>
            <label className="block text-sm text-dim mb-1.5">New password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={inputClass}
              required
              minLength={8}
            />
            <p className="text-xs text-dim mt-1">Minimum 8 characters</p>
          </div>
          <div>
            <label className="block text-sm text-dim mb-1.5">Confirm new password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={inputClass}
              required
              minLength={8}
            />
          </div>

          <div className="pt-1">
            <Button
              variant="primary"
              size="md"
              type="submit"
              disabled={mutation.isPending}
              loading={mutation.isPending}
            >
              Update password
            </Button>
          </div>
        </form>
      </SectionBody>
    </SectionCard>
  );
}
