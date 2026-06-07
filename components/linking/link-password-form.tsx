// components/linking/link-password-form.tsx
'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/use-t';

interface Props {
  onSubmit: (password: string) => Promise<void>;
  error: string | null;
  submitting: boolean;
}

export function LinkPasswordForm({ onSubmit, error, submitting }: Props) {
  const t = useT();
  const [password, setPassword] = useState('');
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => { e.preventDefault(); if (password) void onSubmit(password); }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="link-password">{t('link.passwordLabel')}</Label>
        <Input
          id="link-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('link.passwordPlaceholder')}
        />
      </div>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      <Button type="submit" disabled={submitting || !password} className="min-h-11">
        {submitting ? t('link.submitting') : t('link.submit')}
      </Button>
    </form>
  );
}
