'use client';

import { useState, useId } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, ShieldAlert, Lock, CheckCircle2 } from 'lucide-react';
import { OrbitLogo } from '@/components/orbit/OrbitLogo';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { vaultStore } from '@/lib/store/vault-store';
import { settingsStore } from '@/lib/store/settings-store';
import { useT } from '@/lib/i18n/use-t';
import { cn } from '@/lib/utils';

// ── Password strength ──────────────────────────────────────────────────────────

interface StrengthResult {
  score: 0 | 1 | 2 | 3 | 4;
  labelKey: 'onboarding.strengthWeak' | 'onboarding.strengthFair' | 'onboarding.strengthGood' | 'onboarding.strengthStrong' | '';
  color: string;
  width: string;
}

function getStrength(pw: string): StrengthResult {
  if (pw.length === 0) return { score: 0, labelKey: '', color: 'bg-border', width: 'w-0' };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;

  const levels: StrengthResult[] = [
    { score: 0, labelKey: '', color: 'bg-border', width: 'w-0' },
    { score: 1, labelKey: 'onboarding.strengthWeak', color: 'bg-destructive', width: 'w-1/4' },
    { score: 2, labelKey: 'onboarding.strengthFair', color: 'bg-amber-400', width: 'w-2/4' },
    { score: 3, labelKey: 'onboarding.strengthGood', color: 'bg-emerald-400', width: 'w-3/4' },
    { score: 4, labelKey: 'onboarding.strengthStrong', color: 'bg-emerald-500', width: 'w-full' },
  ];
  return levels[score] as StrengthResult;
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter();
  const t = useT();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [showCf, setShowCf]     = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  const pwId  = useId();
  const cfId  = useId();
  const errId = useId();

  const strength = getStrength(password);

  // Validation
  const tooShort     = password.length > 0 && password.length < 8;
  const mismatch     = confirm.length > 0 && password !== confirm;
  const canSubmit    = password.length >= 8 && password === confirm && !loading;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError('');
    try {
      await vaultStore.getState().createVault(password);
      // Load settings after vault creation
      await settingsStore.getState().loadSettings();
      router.replace('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create vault. Please try again.');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center bg-background px-4 py-12">
      {/* Theme toggle — top-right */}
      <div className="fixed top-4 right-4">
        <ThemeToggle />
      </div>

      <main className="w-full max-w-sm space-y-8">
        {/* ── Logo + heading ─────────────────────────────────────────── */}
        <div className="flex flex-col items-center gap-4 text-center">
          <OrbitLogo size={56} className="drop-shadow-md" />
          <div className="space-y-1">
            <h1 className="font-heading text-3xl text-foreground tracking-tight">
              {t('onboarding.title')}
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t('onboarding.subtitle')}
            </p>
          </div>
        </div>

        {/* ── No-recovery warning ────────────────────────────────────── */}
        <div
          role="alert"
          className="flex gap-3 rounded-xl border border-amber-300/70 bg-amber-50 px-4 py-3.5 dark:border-amber-400/30 dark:bg-amber-950/40"
        >
          <ShieldAlert
            className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"
            size={18}
            aria-hidden
          />
          <p className="text-sm leading-relaxed text-amber-800 dark:text-amber-200">
            <strong className="font-semibold">{t('onboarding.warning')}</strong>{' '}
            {t('onboarding.warningBody')}
          </p>
        </div>

        {/* ── Form ────────────────────────────────────────────────────── */}
        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          {/* Master password */}
          <div className="space-y-1.5">
            <Label htmlFor={pwId}>{t('onboarding.passwordLabel')}</Label>
            <div className="relative">
              <Input
                id={pwId}
                type={showPw ? 'text' : 'password'}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={cn(
                  'h-11 pr-10 text-base',
                  tooShort && 'aria-invalid:border-destructive'
                )}
                aria-describedby={`${pwId}-hint`}
                aria-invalid={tooShort || undefined}
                placeholder={t('onboarding.passwordPlaceholder')}
                required
              />
              <button
                type="button"
                className="absolute right-1 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? t('unlock.hidePassword') : t('unlock.showPassword')}
                tabIndex={0}
              >
                {showPw ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
              </button>
            </div>

            {/* Strength bar */}
            {password.length > 0 && (
              <div className="space-y-1">
                <div className="h-1 w-full rounded-full bg-muted overflow-hidden" aria-hidden>
                  <div
                    className={cn(
                      'h-full rounded-full transition-all duration-300',
                      strength.color,
                      strength.width
                    )}
                  />
                </div>
                <div className="flex justify-between items-center">
                  <p id={`${pwId}-hint`} className="text-xs text-muted-foreground">
                    {tooShort ? t('onboarding.passwordTooShort') : t('onboarding.passwordHint')}
                  </p>
                  {strength.labelKey && (
                    <span className={cn('text-xs font-medium', {
                      'text-destructive':  strength.score === 1,
                      'text-amber-600 dark:text-amber-400': strength.score === 2,
                      'text-emerald-600 dark:text-emerald-400': strength.score >= 3,
                    })}>
                      {t(strength.labelKey)}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Confirm password */}
          <div className="space-y-1.5">
            <Label htmlFor={cfId}>{t('onboarding.confirmLabel')}</Label>
            <div className="relative">
              <Input
                id={cfId}
                type={showCf ? 'text' : 'password'}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className={cn('h-11 pr-10 text-base', mismatch && 'aria-invalid:border-destructive')}
                aria-describedby={mismatch ? `${cfId}-err` : undefined}
                aria-invalid={mismatch || undefined}
                placeholder={t('onboarding.confirmPlaceholder')}
                required
              />
              <button
                type="button"
                className="absolute right-1 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                onClick={() => setShowCf((v) => !v)}
                aria-label={showCf ? t('unlock.hidePassword') : t('unlock.showPassword')}
                tabIndex={0}
              >
                {showCf ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
              </button>
            </div>
            {mismatch && (
              <p id={`${cfId}-err`} role="alert" className="text-xs text-destructive">
                {t('onboarding.passwordsMismatch')}
              </p>
            )}
            {!mismatch && confirm.length > 0 && password === confirm && (
              <p className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 size={12} aria-hidden /> {t('onboarding.passwordsMatch')}
              </p>
            )}
          </div>

          {/* Global error */}
          {error && (
            <p id={errId} role="alert" className="text-sm text-destructive text-center">
              {error}
            </p>
          )}

          {/* Submit */}
          <Button
            type="submit"
            className="w-full h-11 text-sm font-semibold gap-2"
            disabled={!canSubmit}
            aria-describedby={error ? errId : undefined}
          >
            <Lock size={16} aria-hidden />
            {loading ? t('onboarding.submitting') : t('onboarding.submit')}
          </Button>
        </form>
      </main>
    </div>
  );
}
