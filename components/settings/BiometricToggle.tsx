'use client';

import * as React from 'react';
import { Fingerprint, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { vaultStore } from '@/lib/store/vault-store';
import { useT } from '@/lib/i18n/use-t';
import { isPlatformAuthenticatorMaybeAvailable } from '@/lib/webauthn/support';
import { enrollBiometric, revokeBiometric, isBiometricEnrolled, PrfUnsupportedError } from '@/lib/webauthn/enroll';

type Phase = 'checking' | 'unsupported' | 'idle' | 'enrolled' | 'working';

/**
 * Self-contained Settings section: renders nothing while checking or when the
 * platform has no user-verifying authenticator (avoids an empty card). Uses the
 * live VaultKey from the unlocked store to enroll.
 */
export function BiometricToggle() {
  const t = useT();
  const [phase, setPhase] = React.useState<Phase>('checking');
  const [wasEnrolled, setWasEnrolled] = React.useState(false); // working: which action is in flight
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const supported = await isPlatformAuthenticatorMaybeAvailable();
      if (cancelled) return;
      if (!supported) { setPhase('unsupported'); return; }
      const enrolled = await isBiometricEnrolled();
      if (cancelled) return;
      setPhase(enrolled ? 'enrolled' : 'idle');
    })();
    return () => { cancelled = true; };
  }, []);

  async function handleEnable() {
    setError('');
    const key = vaultStore.getState().key;
    if (!key) { setError(t('settings.bioError')); return; }
    setWasEnrolled(false);
    setPhase('working');
    try {
      await enrollBiometric(key);
      setPhase('enrolled');
    } catch (err) {
      setPhase('idle');
      setError(err instanceof PrfUnsupportedError ? t('settings.bioPrfUnsupported') : t('settings.bioError'));
    }
  }

  async function handleDisable() {
    setError('');
    setWasEnrolled(true);
    setPhase('working');
    try {
      await revokeBiometric();
      setPhase('idle');
    } catch {
      setPhase('enrolled');
      setError(t('settings.bioError'));
    }
  }

  if (phase === 'checking' || phase === 'unsupported') return null;

  const enrolled = phase === 'enrolled' || (phase === 'working' && wasEnrolled);

  return (
    <section className="rounded-2xl border border-border bg-card px-5 py-5 flex flex-col gap-5" aria-label={t('settings.bioTitle')}>
      <h2 className="font-heading text-base leading-tight text-foreground">{t('settings.bioTitle')}</h2>

      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">{t('settings.bioDesc')}</p>

        {enrolled ? (
          <>
            <p className="flex items-center gap-1.5 text-sm text-foreground">
              <ShieldCheck aria-hidden className="size-4 text-emerald-500" />
              {t('settings.bioEnabled')}
            </p>
            <Button
              variant="outline"
              className="self-start gap-2 h-11"
              onClick={handleDisable}
              disabled={phase === 'working'}
              aria-busy={phase === 'working'}
            >
              {phase === 'working' ? t('settings.bioDisabling') : t('settings.bioDisable')}
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            className="self-start gap-2 h-11"
            onClick={handleEnable}
            disabled={phase === 'working'}
            aria-busy={phase === 'working'}
          >
            <Fingerprint aria-hidden className="size-4" />
            {phase === 'working' ? t('settings.bioEnabling') : t('settings.bioEnable')}
          </Button>
        )}

        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      </div>
    </section>
  );
}
