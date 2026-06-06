'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Download,
  Upload,
  Trash2,
  Sun,
  Moon,
  Monitor,
  ChevronDown,
  Eye,
  EyeOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { settingsStore, useSettingsStore } from '@/lib/store/settings-store';
import { useAuthStore } from '@/lib/store/auth-store';
import { SyncStatus } from '@/components/sync/sync-status';
import { vaultStore } from '@/lib/store/vault-store';
import { repository } from '@/lib/db/repository';
import {
  exportBackup,
  downloadBackup,
  readBackupFile,
  importBackup,
} from '@/lib/services/backup';
import { useTheme } from '@/components/theme/ThemeProvider';
import { useT } from '@/lib/i18n/use-t';
import type { Theme } from '@/lib/types';
import { cn } from '@/lib/utils';

// ─── Common ISO 4217 currencies ────────────────────────────────────────────────
const CURRENCIES = [
  'USD', 'EUR', 'GBP', 'JPY', 'MXN', 'CAD', 'AUD', 'BRL',
  'CHF', 'CNY', 'INR', 'KRW', 'SGD', 'SEK', 'NOK', 'DKK',
  'NZD', 'ZAR', 'ARS', 'CLP', 'COP', 'PEN', 'HKD', 'TWD',
] as const;

// ─── Section wrapper ────────────────────────────────────────────────────────────
function Section({
  title,
  children,
  danger,
}: {
  title: string;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <section
      className={cn(
        'rounded-2xl border bg-card px-5 py-5 flex flex-col gap-5',
        danger
          ? 'border-destructive/30 bg-destructive/[0.03] dark:bg-destructive/[0.06]'
          : 'border-border'
      )}
      aria-label={title}
    >
      <h2
        className={cn(
          'font-heading text-base leading-tight',
          danger ? 'text-destructive' : 'text-foreground'
        )}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

// ─── Field row (label + optional help + control) ────────────────────────────────
function FieldRow({
  label,
  help,
  children,
  htmlFor,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-col gap-0.5">
        <Label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
          {label}
        </Label>
        {help && <p className="text-xs text-muted-foreground">{help}</p>}
      </div>
      {children}
    </div>
  );
}

// ─── Theme segmented control ────────────────────────────────────────────────────
function ThemeSegment({
  value,
  current,
  icon: Icon,
  label,
  onClick,
}: {
  value: Theme;
  current: Theme;
  icon: React.ElementType;
  label: string;
  onClick: () => void;
}) {
  const isActive = value === current;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-sm font-medium transition-all duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isActive
          ? 'bg-background shadow-sm border border-border text-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-background/60'
      )}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      <span>{label}</span>
    </button>
  );
}

// ─── Account section (optional sync — flag-gated) ───────────────────────────────
const SYNC_ENABLED = process.env.NEXT_PUBLIC_SYNC_ENABLED === 'true';

function AccountSection() {
  const t = useT();
  const user = useAuthStore((s) => s.user);
  const initialized = useAuthStore((s) => s.initialized);
  const init = useAuthStore((s) => s.init);
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle);
  const signOut = useAuthStore((s) => s.signOut);

  React.useEffect(() => {
    const unsub = init();
    return unsub;
  }, [init]);

  return (
    <section
      className="rounded-2xl border border-border bg-card px-5 py-5 flex flex-col gap-5"
      aria-labelledby="account-heading"
    >
      <h2 id="account-heading" className="font-heading text-base leading-tight text-foreground">
        {t('settings.account')}
      </h2>
      {/* Avoid a flash before the session is hydrated. */}
      {initialized && (
        user ? (
          <div className="flex flex-col gap-2">
            <span className="text-sm text-foreground">
              {t('settings.signedInAs', { email: user.email ?? '' })}
            </span>
            <SyncStatus />
            <Button
              type="button"
              variant="outline"
              className="self-start gap-2 h-10"
              onClick={() => void signOut()}
            >
              {t('settings.signOut')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <span className="text-xs text-muted-foreground">{t('settings.syncDisabledHint')}</span>
            <Button
              type="button"
              variant="outline"
              className="self-start gap-2 h-10"
              onClick={() => void signInWithGoogle()}
            >
              {t('settings.signInGoogle')}
            </Button>
          </div>
        )
      )}
    </section>
  );
}

// ─── Main settings page ─────────────────────────────────────────────────────────
export default function SettingsPage() {
  const t = useT();
  const router = useRouter();
  const { theme: currentTheme, setTheme } = useTheme();

  const settings = useSettingsStore((s) => s.settings);
  const { primaryCurrency, locale, reminderLeadDays, autoLockMinutes } = settings;

  // ── Local state for number inputs (controlled as strings) ──
  const [leadDaysStr, setLeadDaysStr] = React.useState(String(reminderLeadDays));
  const [autoLockStr, setAutoLockStr] = React.useState(String(autoLockMinutes));

  // Keep local string state in sync when store changes from outside
  React.useEffect(() => { setLeadDaysStr(String(reminderLeadDays)); }, [reminderLeadDays]);
  React.useEffect(() => { setAutoLockStr(String(autoLockMinutes)); }, [autoLockMinutes]);

  // ── Export state ──
  const [exporting, setExporting] = React.useState(false);
  const [exportError, setExportError] = React.useState('');

  // ── Import state ──
  const [importFile, setImportFile] = React.useState<import('@/lib/types').BackupFile | null>(null);
  const [importDialogOpen, setImportDialogOpen] = React.useState(false);
  const [importPassword, setImportPassword] = React.useState('');
  const [showImportPw, setShowImportPw] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [importError, setImportError] = React.useState('');
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // ── Wipe state ──
  const [wipeDialogOpen, setWipeDialogOpen] = React.useState(false);
  const [wiping, setWiping] = React.useState(false);

  // ─── Handlers ──────────────────────────────────────────────────────────────

  function handleThemeChange(next: Theme) {
    setTheme(next);
    settingsStore.getState().updateSettings({ theme: next });
  }

  function handleCurrencyChange(val: string | null) {
    if (val) settingsStore.getState().updateSettings({ primaryCurrency: val });
  }

  function handleLocaleChange(val: string | null) {
    if (val === 'en' || val === 'es') {
      settingsStore.getState().updateSettings({ locale: val });
    }
  }

  function commitLeadDays() {
    const n = parseInt(leadDaysStr, 10);
    if (!isNaN(n) && n >= 0) {
      settingsStore.getState().updateSettings({ reminderLeadDays: n });
    } else {
      setLeadDaysStr(String(reminderLeadDays));
    }
  }

  function commitAutoLock() {
    const n = parseInt(autoLockStr, 10);
    if (!isNaN(n) && n >= 1) {
      settingsStore.getState().updateSettings({ autoLockMinutes: n });
    } else {
      setAutoLockStr(String(autoLockMinutes));
    }
  }

  // ── Export backup ──
  async function handleExport() {
    setExporting(true);
    setExportError('');
    try {
      const file = await exportBackup();
      downloadBackup(file);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  // ── Import: file chosen ──
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = await readBackupFile(file);
      setImportFile(parsed);
      setImportPassword('');
      setImportError('');
      setImportDialogOpen(true);
    } catch {
      setImportError(t('settings.importError'));
    }
    // reset file input so the same file can be re-selected
    e.target.value = '';
  }

  // ── Import: confirm with password ──
  async function handleImportConfirm() {
    if (!importFile) return;
    setImporting(true);
    setImportError('');
    try {
      await importBackup(importFile, importPassword);
      // Reload settings from the restored vault
      await settingsStore.getState().loadSettings();
      // Lock vault so user re-authenticates with the restored credentials
      vaultStore.getState().lock();
      setImportDialogOpen(false);
      router.replace('/unlock');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.toLowerCase().includes('password') || msg.toLowerCase().includes('verifier')) {
        setImportError(t('settings.importWrongPassword'));
      } else {
        setImportError(t('settings.importError'));
      }
    } finally {
      setImporting(false);
    }
  }

  // ── Wipe vault ──
  async function handleWipe() {
    setWiping(true);
    try {
      await repository.wipeVault();
      vaultStore.getState().lock();
      router.replace('/onboarding');
    } finally {
      setWiping(false);
      setWipeDialogOpen(false);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-6 max-w-lg">
        {/* ── Page heading ──────────────────────────────────────────── */}
        <h1 className="font-heading text-2xl md:text-3xl text-foreground leading-tight">
          {t('settings.title')}
        </h1>

        {/* ── Preferences ────────────────────────────────────────────── */}
        <Section title={t('settings.preferences')}>
          {/* Primary currency */}
          <FieldRow
            label={t('settings.primaryCurrency')}
            help={t('settings.primaryCurrencyHelp')}
            htmlFor="currency-select"
          >
            <Select value={primaryCurrency} onValueChange={handleCurrencyChange}>
              <SelectTrigger id="currency-select" className="w-full h-10">
                <SelectValue />
                <ChevronDown className="ml-auto size-4 opacity-50 shrink-0" aria-hidden />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>

          {/* Theme */}
          <FieldRow label={t('settings.theme')}>
            <div className="flex gap-1 rounded-xl bg-muted p-1" role="group" aria-label={t('settings.theme')}>
              <ThemeSegment
                value="light"
                current={currentTheme}
                icon={Sun}
                label={t('settings.themeLight')}
                onClick={() => handleThemeChange('light')}
              />
              <ThemeSegment
                value="dark"
                current={currentTheme}
                icon={Moon}
                label={t('settings.themeDark')}
                onClick={() => handleThemeChange('dark')}
              />
              <ThemeSegment
                value="system"
                current={currentTheme}
                icon={Monitor}
                label={t('settings.themeSystem')}
                onClick={() => handleThemeChange('system')}
              />
            </div>
          </FieldRow>

          {/* Locale */}
          <FieldRow label={t('settings.locale')} htmlFor="locale-select">
            <Select value={locale} onValueChange={handleLocaleChange}>
              <SelectTrigger id="locale-select" className="w-full h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">{t('settings.localeEn')}</SelectItem>
                <SelectItem value="es">{t('settings.localeEs')}</SelectItem>
              </SelectContent>
            </Select>
          </FieldRow>

          {/* Reminder lead days */}
          <FieldRow
            label={t('settings.reminderLeadDays')}
            help={t('settings.reminderLeadDaysHelp')}
            htmlFor="lead-days-input"
          >
            <Input
              id="lead-days-input"
              type="number"
              min={0}
              value={leadDaysStr}
              onChange={(e) => setLeadDaysStr(e.target.value)}
              onBlur={commitLeadDays}
              className="h-10 w-28"
              aria-label={t('settings.reminderLeadDays')}
            />
          </FieldRow>

          {/* Auto-lock minutes */}
          <FieldRow
            label={t('settings.autoLockMinutes')}
            help={t('settings.autoLockMinutesHelp')}
            htmlFor="auto-lock-input"
          >
            <Input
              id="auto-lock-input"
              type="number"
              min={1}
              value={autoLockStr}
              onChange={(e) => setAutoLockStr(e.target.value)}
              onBlur={commitAutoLock}
              className="h-10 w-28"
              aria-label={t('settings.autoLockMinutes')}
            />
          </FieldRow>
        </Section>

        {/* ── Backup & Restore ─────────────────────────────────────────── */}
        <Section title={t('settings.backup')}>
          {/* Export */}
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-foreground">{t('settings.exportBackup')}</span>
              <span className="text-xs text-muted-foreground">{t('settings.exportBackupHelp')}</span>
            </div>
            <Button
              variant="outline"
              className="self-start gap-2 h-10"
              onClick={handleExport}
              disabled={exporting}
              aria-busy={exporting}
            >
              <Download aria-hidden className="size-4" />
              {exporting ? t('settings.exportExporting') : t('settings.exportButton')}
            </Button>
            {exportError && (
              <p role="alert" className="text-xs text-destructive">
                {exportError}
              </p>
            )}
          </div>

          <div className="border-t border-border" aria-hidden />

          {/* Import */}
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-foreground">{t('settings.importBackup')}</span>
              <span className="text-xs text-muted-foreground">{t('settings.importBackupHelp')}</span>
            </div>
            {/* Hidden real file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".orbit,application/json"
              className="sr-only"
              aria-hidden
              tabIndex={-1}
              onChange={handleFileChange}
            />
            <Button
              variant="outline"
              className="self-start gap-2 h-10"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload aria-hidden className="size-4" />
              {t('settings.importButton')}
            </Button>
            {importError && !importDialogOpen && (
              <p role="alert" className="text-xs text-destructive">
                {importError}
              </p>
            )}
          </div>
        </Section>

        {/* ── Account (optional sync — flag-gated) ──────────────────────── */}
        {SYNC_ENABLED && <AccountSection />}

        {/* ── Danger zone ──────────────────────────────────────────────── */}
        <Section title={t('settings.danger')} danger>
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-foreground">{t('settings.wipeVault')}</span>
              <span className="text-xs text-muted-foreground">{t('settings.wipeVaultHelp')}</span>
            </div>
            <Button
              variant="destructive"
              className="self-start gap-2 h-10"
              onClick={() => setWipeDialogOpen(true)}
            >
              <Trash2 aria-hidden className="size-4" />
              {t('settings.wipeButton')}
            </Button>
          </div>
        </Section>
      </div>

      {/* ── Import password dialog ──────────────────────────────────────── */}
      <Dialog open={importDialogOpen} onOpenChange={(open) => {
        if (!importing) {
          setImportDialogOpen(open);
          if (!open) {
            setImportPassword('');
            setImportError('');
          }
        }
      }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('settings.importDialogTitle')}</DialogTitle>
            <DialogDescription>{t('settings.importDialogDesc')}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-1">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="import-password">{t('settings.importPasswordLabel')}</Label>
              <div className="relative">
                <Input
                  id="import-password"
                  type={showImportPw ? 'text' : 'password'}
                  autoComplete="current-password"
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                  value={importPassword}
                  onChange={(e) => {
                    setImportPassword(e.target.value);
                    if (importError) setImportError('');
                  }}
                  placeholder={t('settings.importPasswordPlaceholder')}
                  className={cn('h-10 pr-10', importError && 'border-destructive')}
                  aria-invalid={!!importError || undefined}
                  aria-describedby={importError ? 'import-pw-err' : undefined}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && importPassword && !importing) {
                      handleImportConfirm();
                    }
                  }}
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                  onClick={() => setShowImportPw((v) => !v)}
                  aria-label={showImportPw ? t('unlock.hidePassword') : t('unlock.showPassword')}
                >
                  {showImportPw
                    ? <EyeOff size={16} aria-hidden />
                    : <Eye size={16} aria-hidden />}
                </button>
              </div>
              {importError && (
                <p id="import-pw-err" role="alert" aria-live="polite" className="text-xs text-destructive">
                  {importError}
                </p>
              )}
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setImportDialogOpen(false);
                setImportPassword('');
                setImportError('');
              }}
              disabled={importing}
            >
              {t('settings.importCancel')}
            </Button>
            <Button
              onClick={handleImportConfirm}
              disabled={!importPassword || importing}
              aria-busy={importing}
            >
              {importing ? t('settings.importRestoring') : t('settings.importConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Wipe confirm dialog ─────────────────────────────────────────── */}
      <Dialog open={wipeDialogOpen} onOpenChange={(open) => {
        if (!wiping) setWipeDialogOpen(open);
      }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-destructive">{t('settings.wipeDialogTitle')}</DialogTitle>
            <DialogDescription>{t('settings.wipeDialogDesc')}</DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-2 mt-2">
            <Button
              variant="outline"
              onClick={() => setWipeDialogOpen(false)}
              disabled={wiping}
            >
              {t('settings.wipeCancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleWipe}
              disabled={wiping}
              aria-busy={wiping}
            >
              <Trash2 aria-hidden className="size-4 mr-1.5" />
              {wiping ? t('settings.wipeWiping') : t('settings.wipeConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
