/**
 * Minimal en/es string dictionary for Orbit.
 * No heavy i18n library — just a typed map + useT() hook.
 * Keys are dot-separated namespaces. Add new keys incrementally.
 */

export type Locale = 'en' | 'es';

const en = {
  // ── Navigation ────────────────────────────────────────────────────────────
  'nav.dashboard':        'Dashboard',
  'nav.subscriptions':    'Subscriptions',
  'nav.cards':            'Cards',
  'nav.settings':         'Settings',

  // ── Onboarding ────────────────────────────────────────────────────────────
  'onboarding.title':             'Welcome to Orbit',
  'onboarding.subtitle':          'Create a master password to encrypt your vault.',
  'onboarding.warning':           'There is no way to recover your master password.',
  'onboarding.warningBody':       'If you forget it, your data is permanently lost. Everything is encrypted on this device only — Orbit never sends your data anywhere.',
  'onboarding.passwordLabel':     'Master password',
  'onboarding.passwordPlaceholder': 'Choose a strong password',
  'onboarding.confirmLabel':      'Confirm password',
  'onboarding.confirmPlaceholder': 'Re-enter your password',
  'onboarding.passwordHint':      'Min 8 chars · uppercase · numbers · symbols',
  'onboarding.passwordTooShort':  'Must be at least 8 characters',
  'onboarding.passwordsMatch':    'Passwords match',
  'onboarding.passwordsMismatch': 'Passwords do not match',
  'onboarding.submit':            'Create vault',
  'onboarding.submitting':        'Creating vault…',
  'onboarding.strengthWeak':      'Weak',
  'onboarding.strengthFair':      'Fair',
  'onboarding.strengthGood':      'Good',
  'onboarding.strengthStrong':    'Strong',

  // ── Unlock ────────────────────────────────────────────────────────────────
  'unlock.title':             'Unlock Orbit',
  'unlock.subtitle':          'Enter your master password to decrypt your vault.',
  'unlock.passwordLabel':     'Master password',
  'unlock.passwordPlaceholder': 'Enter your master password',
  'unlock.submit':            'Unlock vault',
  'unlock.submitting':        'Unlocking…',
  'unlock.error':             'Incorrect master password',
  'unlock.showPassword':      'Show password',
  'unlock.hidePassword':      'Hide password',

  // ── Settings ──────────────────────────────────────────────────────────────
  'settings.title':               'Settings',
  'settings.preferences':         'Preferences',
  'settings.primaryCurrency':     'Primary currency',
  'settings.primaryCurrencyHelp': 'Used for dashboard totals and FX conversion',
  'settings.theme':               'Theme',
  'settings.themeLight':          'Light',
  'settings.themeDark':           'Dark',
  'settings.themeSystem':         'System',
  'settings.locale':              'Language',
  'settings.localeEn':            'English',
  'settings.localeEs':            'Spanish',
  'settings.reminderLeadDays':    'Reminder lead days',
  'settings.reminderLeadDaysHelp': 'Notify you this many days before a renewal',
  'settings.autoLockMinutes':     'Auto-lock (minutes)',
  'settings.autoLockMinutesHelp': 'Lock vault after this many minutes of inactivity',

  'settings.backup':              'Backup & Restore',
  'settings.exportBackup':        'Export encrypted backup',
  'settings.exportBackupHelp':    'Download a .orbit file with your encrypted vault data',
  'settings.exportButton':        'Download backup',
  'settings.exportExporting':     'Exporting…',
  'settings.importBackup':        'Import backup',
  'settings.importBackupHelp':    'Restore from a .orbit backup file',
  'settings.importButton':        'Choose .orbit file',
  'settings.importDialogTitle':   'Enter master password',
  'settings.importDialogDesc':    'Enter the master password used to create this backup.',
  'settings.importPasswordLabel': 'Master password',
  'settings.importPasswordPlaceholder': 'Password for this backup',
  'settings.importConfirm':       'Restore backup',
  'settings.importRestoring':     'Restoring…',
  'settings.importCancel':        'Cancel',
  'settings.importSuccess':       'Backup restored — please unlock again.',
  'settings.importWrongPassword': 'Incorrect password for this backup.',
  'settings.importError':         'Failed to restore backup.',

  'settings.danger':              'Danger zone',
  'settings.wipeVault':           'Wipe vault',
  'settings.wipeVaultHelp':       'Permanently delete all data on this device',
  'settings.wipeButton':          'Wipe everything',
  'settings.wipeDialogTitle':     'Wipe vault?',
  'settings.wipeDialogDesc':      'This permanently deletes everything on this device. There is no recovery.',
  'settings.wipeConfirm':         'Yes, wipe everything',
  'settings.wipeWiping':          'Wiping…',
  'settings.wipeCancel':          'Cancel',
} as const;

const es = {
  // ── Navigation ────────────────────────────────────────────────────────────
  'nav.dashboard':        'Panel',
  'nav.subscriptions':    'Suscripciones',
  'nav.cards':            'Tarjetas',
  'nav.settings':         'Ajustes',

  // ── Onboarding ────────────────────────────────────────────────────────────
  'onboarding.title':             'Bienvenido a Orbit',
  'onboarding.subtitle':          'Crea una contraseña maestra para cifrar tu bóveda.',
  'onboarding.warning':           'No hay forma de recuperar tu contraseña maestra.',
  'onboarding.warningBody':       'Si la olvidas, tus datos se perderán permanentemente. Todo está cifrado solo en este dispositivo — Orbit nunca envía tus datos a ningún lugar.',
  'onboarding.passwordLabel':     'Contraseña maestra',
  'onboarding.passwordPlaceholder': 'Elige una contraseña segura',
  'onboarding.confirmLabel':      'Confirmar contraseña',
  'onboarding.confirmPlaceholder': 'Reingresa tu contraseña',
  'onboarding.passwordHint':      'Mín. 8 caracteres · mayúsculas · números · símbolos',
  'onboarding.passwordTooShort':  'Debe tener al menos 8 caracteres',
  'onboarding.passwordsMatch':    'Las contraseñas coinciden',
  'onboarding.passwordsMismatch': 'Las contraseñas no coinciden',
  'onboarding.submit':            'Crear bóveda',
  'onboarding.submitting':        'Creando bóveda…',
  'onboarding.strengthWeak':      'Débil',
  'onboarding.strengthFair':      'Regular',
  'onboarding.strengthGood':      'Buena',
  'onboarding.strengthStrong':    'Fuerte',

  // ── Unlock ────────────────────────────────────────────────────────────────
  'unlock.title':             'Desbloquear Orbit',
  'unlock.subtitle':          'Ingresa tu contraseña maestra para descifrar tu bóveda.',
  'unlock.passwordLabel':     'Contraseña maestra',
  'unlock.passwordPlaceholder': 'Ingresa tu contraseña maestra',
  'unlock.submit':            'Desbloquear bóveda',
  'unlock.submitting':        'Desbloqueando…',
  'unlock.error':             'Contraseña maestra incorrecta',
  'unlock.showPassword':      'Mostrar contraseña',
  'unlock.hidePassword':      'Ocultar contraseña',

  // ── Settings ──────────────────────────────────────────────────────────────
  'settings.title':               'Ajustes',
  'settings.preferences':         'Preferencias',
  'settings.primaryCurrency':     'Moneda principal',
  'settings.primaryCurrencyHelp': 'Usada en totales del panel y conversión de divisas',
  'settings.theme':               'Tema',
  'settings.themeLight':          'Claro',
  'settings.themeDark':           'Oscuro',
  'settings.themeSystem':         'Sistema',
  'settings.locale':              'Idioma',
  'settings.localeEn':            'Inglés',
  'settings.localeEs':            'Español',
  'settings.reminderLeadDays':    'Días de aviso de renovación',
  'settings.reminderLeadDaysHelp': 'Te notifica este número de días antes de una renovación',
  'settings.autoLockMinutes':     'Bloqueo automático (minutos)',
  'settings.autoLockMinutesHelp': 'Bloquea la bóveda tras este tiempo de inactividad',

  'settings.backup':              'Respaldo y restauración',
  'settings.exportBackup':        'Exportar respaldo cifrado',
  'settings.exportBackupHelp':    'Descarga un archivo .orbit con tus datos cifrados',
  'settings.exportButton':        'Descargar respaldo',
  'settings.exportExporting':     'Exportando…',
  'settings.importBackup':        'Importar respaldo',
  'settings.importBackupHelp':    'Restaurar desde un archivo .orbit',
  'settings.importButton':        'Seleccionar archivo .orbit',
  'settings.importDialogTitle':   'Ingresa la contraseña maestra',
  'settings.importDialogDesc':    'Ingresa la contraseña maestra usada para crear este respaldo.',
  'settings.importPasswordLabel': 'Contraseña maestra',
  'settings.importPasswordPlaceholder': 'Contraseña de este respaldo',
  'settings.importConfirm':       'Restaurar respaldo',
  'settings.importRestoring':     'Restaurando…',
  'settings.importCancel':        'Cancelar',
  'settings.importSuccess':       'Respaldo restaurado — vuelve a desbloquear.',
  'settings.importWrongPassword': 'Contraseña incorrecta para este respaldo.',
  'settings.importError':         'Error al restaurar el respaldo.',

  'settings.danger':              'Zona de peligro',
  'settings.wipeVault':           'Borrar bóveda',
  'settings.wipeVaultHelp':       'Elimina permanentemente todos los datos en este dispositivo',
  'settings.wipeButton':          'Borrar todo',
  'settings.wipeDialogTitle':     '¿Borrar bóveda?',
  'settings.wipeDialogDesc':      'Esto elimina permanentemente todo en este dispositivo. No hay recuperación.',
  'settings.wipeConfirm':         'Sí, borrar todo',
  'settings.wipeWiping':          'Borrando…',
  'settings.wipeCancel':          'Cancelar',
} as const;

export type DictKey = keyof typeof en;

// Cast es to the looser type so translated strings don't need to match en's exact literals.
export const DICT: Record<Locale, Record<DictKey, string>> = {
  en: en as Record<DictKey, string>,
  es: es as Record<DictKey, string>,
};
