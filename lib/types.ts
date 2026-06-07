export type BillingCycle = 'monthly' | 'annual' | 'custom';
export type SubscriptionStatus = 'active' | 'trial' | 'paused' | 'canceled';
export type Theme = 'light' | 'dark' | 'system';
export type Locale = 'es' | 'en';

export interface Subscription {
  id: string;
  serviceName: string;
  category: string;
  logoUrl?: string;
  accountEmail?: string;
  plan?: string;
  amount: number;
  currency: string;            // ISO 4217, e.g. "USD"
  billingCycle: BillingCycle;
  customCycleDays?: number;    // required when billingCycle === 'custom'
  nextRenewalDate: string;     // ISO 8601 date "YYYY-MM-DD"
  status: SubscriptionStatus;
  paymentMethodId?: string;
  url?: string;
  notes?: string;
  credentialId?: string;
  createdAt: string;           // ISO 8601
  updatedAt: string;           // ISO 8601
}

export interface Credential {
  id: string;
  username: string;
  password: string;
}

export interface PaymentMethod {
  id: string;
  label: string;
  brand: string;               // "Visa" | "Mastercard" | "Amex" | ...
  last4: string;               // 4 chars
  color: string;               // hex
}

export interface FxRatesCache {
  base: string;                // ISO 4217
  rates: Record<string, number>;
  fetchedAt: string;           // ISO 8601
  manualOverrides?: Record<string, number>; // "USD>EUR" -> rate
}

export interface Settings {
  primaryCurrency: string;
  theme: Theme;
  locale: Locale;
  reminderLeadDays: number;    // default 3
  autoLockMinutes: number;     // default 5
  cloudReminders: boolean;     // opt-in cloud push reminders (S10); default false
}

export interface KdfParams {
  algo: 'argon2id';
  salt: string;                // base64
  memorySize: number;          // KiB
  iterations: number;
  parallelism: number;
  hashLength: number;          // bytes (32)
}

export interface WrappedKeys {
  /** VaultKey envuelta con KEK_master (Argon2id(password)) vía AES-KW, base64. */
  master: string;
}

export interface VaultMeta {
  schemaVersion: number;          // forma de VaultData (sin cambios)
  kdf: KdfParams;
  verifier: string;               // base64 AES-GCM(VERIFIER_CONSTANT) bajo VaultKey (v1) o KEK_master (v0)
  /** undefined => formato legado v0 (KDF cifra el blob directo). 1 => envelope. */
  envelopeVersion?: number;
  /** Presente solo cuando envelopeVersion >= 1. */
  wrappedKeys?: WrappedKeys;
}

/** Per-device biometric credential row (IndexedDB `bio` table; never in meta/backups). */
export interface BioCredential {
  credentialId: string;           // base64url del rawId del passkey
  prfSalt: string;                // base64 del salt PRF fijo de la app
  wrappedVaultKey: string;        // base64 AES-KW(VaultKey) bajo KEK_bio
  createdAt: string;              // ISO 8601
}

/** Sensitive data — only ever persisted as one encrypted blob. */
export interface VaultData {
  subscriptions: Subscription[];
  credentials: Credential[];
  paymentMethods: PaymentMethod[];
}

/** The .orbit backup file shape. */
export interface BackupFile {
  format: 'orbit-backup';
  schemaVersion: number;
  meta: VaultMeta;
  data: string;                // encrypted VaultData blob (base64 iv+ct)
}
