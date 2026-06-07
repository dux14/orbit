// app/link/page.tsx
'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n/use-t';
import type { DictKey } from '@/lib/i18n/dict';
import { createLinkService } from '@/lib/linking/link-controller';
import { LinkError, type LinkState } from '@/lib/linking/types';
import { LinkPasswordForm } from '@/components/linking/link-password-form';
import { LinkChoiceDialog } from '@/components/linking/link-choice-dialog';

const errorKey = (code: string): DictKey =>
  code === 'wrong-password' ? 'link.wrongPassword'
  : code === 'offline' ? 'link.offline'
  : code === 'no-session' ? 'link.noSession'
  : 'link.unknownError';

export default function LinkPage() {
  const t = useT();
  const router = useRouter();
  const [state, setState] = useState<LinkState>({ phase: 'detecting', situation: null, remote: null, error: null });

  // 1. Detectar la situación al montar.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const svc = await createLinkService();
      if (!svc) { router.replace('/dashboard'); return; }
      try {
        const c = await svc.detect();
        if (cancelled) return;
        if (c.situation === 'remote-only') {
          setState({ phase: 'need-password', situation: c.situation, remote: c.remote, error: null });
        } else if (c.situation === 'both-different') {
          setState({ phase: 'choice', situation: c.situation, remote: c.remote, error: null });
        } else if (c.situation === 'local-only') {
          await svc.linkLocalVault();
          router.replace('/dashboard');
        } else {
          // both-same / no-remote-no-local → nada que vincular aquí
          router.replace('/dashboard');
        }
      } catch (e) {
        if (cancelled) return;
        const code = e instanceof LinkError ? e.code : 'unknown';
        setState((s) => ({ ...s, phase: 'error', error: code }));
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  // 2. Dispositivo nuevo: enviar password.
  const handlePassword = useCallback(async (password: string) => {
    setState((s) => ({ ...s, phase: 'resolving', error: null }));
    const svc = await createLinkService();
    if (!svc) { setState((s) => ({ ...s, phase: 'error', error: 'no-session' })); return; }
    try {
      await svc.linkNewDevice(password);
      router.replace('/dashboard');
    } catch (e) {
      const code = e instanceof LinkError ? e.code : 'unknown';
      setState((s) => ({ ...s, phase: 'need-password', error: code }));
    }
  }, [router]);

  // 3. Elección destructiva (vaults distintos).
  // Conservar remoto = descartar local y bajar el remoto: pedir su password
  // (linkNewDevice sobrescribe meta/blob locales con los remotos).
  const keepRemote = useCallback(() => {
    setState((s) => ({ ...s, phase: 'need-password', error: null }));
  }, []);

  // Conservar local = sobrescribir la fila remota: push con la versión remota como base
  // (upsert_vault exige p_expected_version = versión vigente para avanzar).
  const keepLocal = useCallback(async () => {
    setState((s) => ({ ...s, phase: 'resolving', error: null }));
    const svc = await createLinkService();
    if (!svc || !state.remote) { router.replace('/dashboard'); return; }
    try {
      await svc.linkLocalVault(state.remote.version);
      router.replace('/dashboard');
    } catch {
      setState((s) => ({ ...s, phase: 'error', error: 'unknown' }));
    }
  }, [router, state.remote]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6">
      {state.phase === 'detecting' && <p className="text-center text-sm text-muted-foreground">{t('link.detecting')}</p>}

      {state.phase === 'need-password' && (
        <>
          <div className="flex flex-col gap-2">
            <h1 className="font-heading text-xl">{t('link.newDeviceTitle')}</h1>
            <p className="text-sm text-muted-foreground">{t('link.newDeviceBody')}</p>
          </div>
          <LinkPasswordForm onSubmit={handlePassword} error={state.error ? t(errorKey(state.error)) : null} submitting={false} />
        </>
      )}

      {state.phase === 'resolving' && <p className="text-center text-sm text-muted-foreground">{t('link.submitting')}</p>}

      {state.phase === 'error' && (
        <p className="text-center text-sm text-destructive" role="alert">{t(errorKey(state.error ?? 'unknown'))}</p>
      )}

      <LinkChoiceDialog
        open={state.phase === 'choice'}
        onKeepLocal={() => void keepLocal()}
        onKeepRemote={keepRemote}
        onCancel={() => router.replace('/dashboard')}
      />
    </main>
  );
}
