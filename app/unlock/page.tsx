'use client';

import { useState, useId } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, KeyRound } from 'lucide-react';
import { OrbitLogo } from '@/components/orbit/OrbitLogo';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { vaultStore } from '@/lib/store/vault-store';
import { settingsStore } from '@/lib/store/settings-store';
import { useT } from '@/lib/i18n/use-t';
import { cn } from '@/lib/utils';

export default function UnlockPage() {
  const router = useRouter();
  const t = useT();

  const [password, setPassword] = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  const pwId  = useId();
  const errId = useId();

  const canSubmit = password.length > 0 && !loading;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError('');
    try {
      await vaultStore.getState().unlock(password);
      // Load settings once vault is open
      await settingsStore.getState().loadSettings();
      router.replace('/dashboard');
    } catch {
      // Deliberate: don't reveal anything about password correctness beyond "wrong"
      setError(t('unlock.error'));
      setLoading(false);
    }
  }

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center bg-background px-4 py-12">
      {/* Theme toggle — top-right */}
      <div className="fixed top-4 right-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-sm space-y-8">
        {/* ── Logo + heading ─────────────────────────────────────────── */}
        <div className="flex flex-col items-center gap-4 text-center">
          <OrbitLogo size={56} className="drop-shadow-md" />
          <div className="space-y-1">
            <h1 className="font-heading text-3xl text-foreground tracking-tight">
              {t('unlock.title')}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t('unlock.subtitle')}
            </p>
          </div>
        </div>

        {/* ── Form ────────────────────────────────────────────────────── */}
        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor={pwId}>{t('unlock.passwordLabel')}</Label>
            <div className="relative">
              <Input
                id={pwId}
                type={showPw ? 'text' : 'password'}
                autoComplete="current-password"
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  // Clear error when user starts typing again
                  if (error) setError('');
                }}
                className={cn('h-11 pr-10 text-base', error && 'border-destructive')}
                aria-describedby={error ? errId : undefined}
                aria-invalid={!!error || undefined}
                placeholder={t('unlock.passwordPlaceholder')}
                required
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? t('unlock.hidePassword') : t('unlock.showPassword')}
                tabIndex={0}
              >
                {showPw ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
              </button>
            </div>

            {/* Inline error — below the field, per UX guidelines */}
            {error && (
              <p
                id={errId}
                role="alert"
                aria-live="polite"
                className="text-xs text-destructive"
              >
                {error}
              </p>
            )}
          </div>

          <Button
            type="submit"
            className="w-full h-11 text-sm font-semibold gap-2"
            disabled={!canSubmit}
          >
            <KeyRound size={16} aria-hidden />
            {loading ? t('unlock.submitting') : t('unlock.submit')}
          </Button>
        </form>
      </div>
    </div>
  );
}
