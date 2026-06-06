import type { Subscription, Credential, PaymentMethod } from "@/lib/types";

export interface DraftCard {
  label: string;
  brand: string;
  last4: string;
  color: string;
}

/** Minimal slice of the vault store this helper needs (keeps it unit-testable). */
export interface VaultActions {
  upsertCredential: (c: Credential) => Promise<string>;
  upsertPaymentMethod: (pm: PaymentMethod) => Promise<string>;
  upsertSubscription: (sub: Subscription) => Promise<void>;
}

interface DraftCreds {
  email?: string;
  password?: string;
}

/**
 * Persists a subscription that may carry an inline-created credential and/or
 * an inline-created payment method. ORDER MATTERS:
 *   1. credential (if any)  → assign credentialId
 *   2. payment method (if any) → assign the NEW paymentMethodId
 *   3. subscription
 * All three write the same encrypted VaultData blob — zero crypto changes.
 */
export async function saveSubscriptionWithDraftCard(
  actions: VaultActions,
  sub: Subscription,
  creds: DraftCreds | undefined,
  draftCard: DraftCard | undefined,
): Promise<void> {
  const next: Subscription = { ...sub };

  if (creds && (creds.email || creds.password)) {
    next.credentialId = await actions.upsertCredential({
      id: next.credentialId ?? "",
      username: creds.email ?? "",
      password: creds.password ?? "",
    });
  }

  if (draftCard && draftCard.label.trim() && /^\d{4}$/.test(draftCard.last4)) {
    // Create the card FIRST, capture its generated id, then link it.
    next.paymentMethodId = await actions.upsertPaymentMethod({
      id: "",
      label: draftCard.label.trim(),
      brand: draftCard.brand,
      last4: draftCard.last4,
      color: draftCard.color,
    });
  }

  await actions.upsertSubscription(next);
}
