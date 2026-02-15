import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Send } from 'lucide-react';
import { authApi, preferencesApi } from '../../../api';
import { Button } from '../../../components/ui/Button';
import { SectionBody, SectionCard, SectionHeader } from '../../../components/ui/settings';

export function TelegramSection() {
  const [botToken, setBotToken] = useState('');
  const [botTokenConfigured, setBotTokenConfigured] = useState(false);
  const [botTokenDirty, setBotTokenDirty] = useState(false);
  const [telegramId, setTelegramId] = useState('');
  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [openaiApiKeyConfigured, setOpenaiApiKeyConfigured] = useState(false);
  const [openaiApiKeyDirty, setOpenaiApiKeyDirty] = useState(false);
  const [llmModel, setLlmModel] = useState('gpt-4.1-mini');
  const [showSetup, setShowSetup] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    preferencesApi
      .getConfigured('telegram_bot_token')
      .then((val) => {
        setBotTokenConfigured(val);
      })
      .catch(() => {
        setBotTokenConfigured(false);
      });

    preferencesApi
      .get<string>('telegram_user_id')
      .then((val) => {
        if (val) setTelegramId(String(val));
      })
      .catch(() => {
        // Not set yet.
      });

    preferencesApi
      .getConfigured('telegram_openai_api_key')
      .then((val) => {
        setOpenaiApiKeyConfigured(val);
      })
      .catch(() => {
        setOpenaiApiKeyConfigured(false);
      });

    preferencesApi
      .get<string>('telegram_openai_model')
      .then((val) => {
        if (val) setLlmModel(String(val));
      })
      .catch(() => {
        // Not set yet.
      });
  }, []);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (botTokenDirty) {
        if (botToken.trim()) {
          await preferencesApi.set('telegram_bot_token', botToken.trim());
        } else {
          await preferencesApi.delete('telegram_bot_token').catch(() => {});
        }
      }

      if (telegramId.trim()) {
        await preferencesApi.set('telegram_user_id', telegramId.trim());
      } else {
        await preferencesApi.delete('telegram_user_id').catch(() => {});
      }

      if (openaiApiKeyDirty) {
        if (openaiApiKey.trim()) {
          await preferencesApi.set('telegram_openai_api_key', openaiApiKey.trim());
        } else {
          await preferencesApi.delete('telegram_openai_api_key').catch(() => {});
        }
      }

      if (llmModel.trim()) {
        await preferencesApi.set('telegram_openai_model', llmModel.trim());
      } else {
        await preferencesApi.delete('telegram_openai_model').catch(() => {});
      }

      await authApi.restartTelegramBot();
    },
    onSuccess: () => {
      const hasBotToken = botToken.trim() !== '';
      const hasOpenAIKey = openaiApiKey.trim() !== '';
      setBotToken('');
      setOpenaiApiKey('');
      setBotTokenDirty(false);
      setOpenaiApiKeyDirty(false);
      if (botTokenDirty) setBotTokenConfigured(hasBotToken);
      if (openaiApiKeyDirty) setOpenaiApiKeyConfigured(hasOpenAIKey);
      setSaved(true);
      setError('');
      setTimeout(() => setSaved(false), 3000);
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to save');
      setSaved(false);
    },
  });

  const inputClass =
    'block w-full px-3 py-2 border border-subtle bg-primary text-[var(--color-text-primary)] rounded-md text-sm focus:outline-none focus:border-accent transition-colors';

  return (
    <SectionCard>
      <SectionHeader
        title="Telegram"
        description="Auto-login when opening Codeburg from Telegram"
        icon={<Send size={15} />}
        action={
          <button
            onClick={() => setShowSetup((v) => !v)}
            className="text-xs text-accent hover:text-accent-dim transition-colors whitespace-nowrap mt-0.5"
          >
            {showSetup ? 'Hide setup guide' : 'Setup guide'}
          </button>
        }
      />

      {showSetup && (
        <SectionBody bordered>
          <ol className="text-xs text-dim space-y-2 list-decimal list-inside">
            <li>
              Open Telegram and search for <span className="text-[var(--color-text-primary)]">@BotFather</span>
            </li>
            <li>
              Send{' '}
              <code className="px-1 py-0.5 bg-primary rounded text-[var(--color-text-primary)]">/newbot</code>{' '}
              and follow the prompts to create a bot
            </li>
            <li>
              Copy the <span className="text-[var(--color-text-primary)]">bot token</span> BotFather gives you
            </li>
            <li>
              To find your user ID, send{' '}
              <code className="px-1 py-0.5 bg-primary rounded text-[var(--color-text-primary)]">/start</code>{' '}
              to <span className="text-[var(--color-text-primary)]">@userinfobot</span>
            </li>
            <li>Enter both values below and save</li>
          </ol>
        </SectionBody>
      )}

      <SectionBody>
        {error && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-md bg-[var(--color-error)]/8 border border-[var(--color-error)]/30 text-sm text-[var(--color-error)] mb-3">
            <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
            {error}
          </div>
        )}
        {saved && (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-md bg-[var(--color-success)]/8 border border-[var(--color-success)]/30 text-sm text-[var(--color-success)] mb-3">
            <CheckCircle2 size={16} className="flex-shrink-0" />
            Saved
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-dim mb-1.5">Bot Token</label>
            <input
              type="password"
              value={botToken}
              onChange={(e) => {
                setBotToken(e.target.value);
                setBotTokenDirty(true);
              }}
              className={inputClass}
              placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v..."
              autoComplete="off"
            />
            {botTokenConfigured && !botTokenDirty && (
              <p className="text-xs text-dim mt-1.5">Bot token is already configured. Enter a new value to rotate it.</p>
            )}
          </div>

          <div className="h-px bg-[var(--color-border)] -mx-5" />

          <div>
            <label className="block text-sm text-dim mb-1.5">Your Telegram User ID</label>
            <input
              type="text"
              value={telegramId}
              onChange={(e) => setTelegramId(e.target.value)}
              className={inputClass}
              placeholder="123456789"
            />
            <p className="text-xs text-dim mt-1.5">Only this user will be able to log in via Telegram</p>
          </div>

          <div className="h-px bg-[var(--color-border)] -mx-5" />

          <div>
            <label className="block text-sm text-dim mb-1.5">OpenAI API Key</label>
            <input
              type="password"
              value={openaiApiKey}
              onChange={(e) => {
                setOpenaiApiKey(e.target.value);
                setOpenaiApiKeyDirty(true);
              }}
              className={inputClass}
              placeholder="sk-..."
              autoComplete="off"
            />
            <p className="text-xs text-dim mt-1.5">
              Used for non-command Telegram messages (OpenAI Responses + transcription).
            </p>
            {openaiApiKeyConfigured && !openaiApiKeyDirty && (
              <p className="text-xs text-dim mt-1.5">OpenAI API key is already configured. Enter a new value to rotate it.</p>
            )}
          </div>

          <div>
            <label className="block text-sm text-dim mb-1.5">OpenAI Model</label>
            <input
              type="text"
              value={llmModel}
              onChange={(e) => setLlmModel(e.target.value)}
              className={inputClass}
              placeholder="gpt-4.1-mini"
              autoComplete="off"
            />
          </div>

          <Button
            variant="primary"
            size="md"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            loading={saveMutation.isPending}
          >
            Save
          </Button>
        </div>
      </SectionBody>
    </SectionCard>
  );
}
