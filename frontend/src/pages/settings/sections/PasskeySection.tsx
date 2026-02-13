import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { startRegistration } from '@simplewebauthn/browser';
import { AlertCircle, CheckCircle2, Fingerprint, KeyRound, Pencil, Trash2 } from 'lucide-react';
import { authApi } from '../../../api';
import { SectionBody, SectionCard, SectionHeader } from '../../../components/ui/settings';

export function PasskeySection() {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const { data: passkeys = [], isLoading } = useQuery({
    queryKey: ['passkeys'],
    queryFn: () => authApi.listPasskeys(),
  });

  const registerMutation = useMutation({
    mutationFn: async () => {
      const resp = await authApi.passkeyRegisterBegin();
      type RegistrationOptions = Parameters<typeof startRegistration>[0]['optionsJSON'];
      const maybeWrapped = resp as RegistrationOptions | { publicKey: RegistrationOptions };
      const optionsJSON = 'publicKey' in maybeWrapped ? maybeWrapped.publicKey : maybeWrapped;
      const credential = await startRegistration({ optionsJSON });
      return authApi.passkeyRegisterFinish(credential);
    },
    onSuccess: (result) => {
      setSuccess(`Passkey "${result.name}" registered`);
      setError('');
      queryClient.invalidateQueries({ queryKey: ['passkeys'] });
      setTimeout(() => setSuccess(''), 3000);
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to register passkey');
      setSuccess('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => authApi.deletePasskey(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['passkeys'] });
    },
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => authApi.updatePasskey(id, { name }),
    onSuccess: () => {
      setEditingId(null);
      queryClient.invalidateQueries({ queryKey: ['passkeys'] });
    },
  });

  const handleRename = (id: string) => {
    if (editName.trim()) {
      renameMutation.mutate({ id, name: editName.trim() });
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <SectionCard>
      <SectionHeader
        title="Passkeys"
        description="Passwordless sign-in with biometrics or security keys"
        icon={<Fingerprint size={15} />}
        action={
          <button
            onClick={() => registerMutation.mutate()}
            disabled={registerMutation.isPending}
            className="text-xs text-accent hover:text-accent-dim transition-colors whitespace-nowrap mt-0.5 inline-flex items-center gap-1"
          >
            <Fingerprint size={14} />
            {registerMutation.isPending ? 'Registering...' : 'Add passkey'}
          </button>
        }
      />
      <SectionBody>
        {error && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-md bg-[var(--color-error)]/8 border border-[var(--color-error)]/30 text-sm text-[var(--color-error)] mb-3">
            <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
            {error}
          </div>
        )}
        {success && (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-md bg-[var(--color-success)]/8 border border-[var(--color-success)]/30 text-sm text-[var(--color-success)] mb-3">
            <CheckCircle2 size={16} className="flex-shrink-0" />
            {success}
          </div>
        )}

        {isLoading ? (
          <p className="text-sm text-dim">Loading...</p>
        ) : passkeys.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-4 text-dim text-center">
            <KeyRound size={32} className="text-dim" />
            <p className="text-sm">No passkeys registered. Add one to enable passwordless login.</p>
          </div>
        ) : (
          <div className="space-y-0">
            {passkeys.map((passkey) => (
              <div
                key={passkey.id}
                className="flex items-center justify-between gap-3 py-3 border-b border-subtle last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  {editingId === passkey.id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleRename(passkey.id);
                      }}
                      className="flex items-center gap-2"
                    >
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="px-2 py-1 text-sm border border-subtle bg-primary text-[var(--color-text-primary)] rounded focus:outline-none focus:border-accent"
                        autoFocus
                        onBlur={() => setEditingId(null)}
                        onKeyDown={(e) => e.key === 'Escape' && setEditingId(null)}
                      />
                    </form>
                  ) : (
                    <>
                      <span className="text-sm text-[var(--color-text-primary)]">{passkey.name}</span>
                      <span className="block text-xs text-dim mt-0.5">
                        Created {formatDate(passkey.createdAt)}
                        {passkey.lastUsedAt && ` \u00b7 Last used ${formatDate(passkey.lastUsedAt)}`}
                      </span>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => {
                      setEditingId(passkey.id);
                      setEditName(passkey.name);
                    }}
                    className="p-1.5 text-dim hover:text-[var(--color-text-primary)] transition-colors rounded"
                    title="Rename"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => deleteMutation.mutate(passkey.id)}
                    disabled={deleteMutation.isPending}
                    className="p-1.5 text-dim hover:text-[var(--color-error)] transition-colors rounded"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionBody>
    </SectionCard>
  );
}
