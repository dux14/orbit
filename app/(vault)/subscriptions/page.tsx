"use client";

import * as React from "react";
import { useStore } from "zustand";
import { vaultStore } from "@/lib/store/vault-store";
import type { Subscription } from "@/lib/types";
import { SubscriptionList } from "@/components/subscriptions/SubscriptionList";
import { SubscriptionForm } from "@/components/subscriptions/SubscriptionForm";
import { SubscriptionDetail } from "@/components/subscriptions/SubscriptionDetail";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useT } from "@/lib/i18n/use-t";

/** Ephemeral credential fields attached by SubscriptionForm */
type SubWithCreds = Subscription & { _credEmail?: string; _credPassword?: string };

export default function SubscriptionsPage() {
  const t = useT();
  // Store selectors
  const subscriptions = useStore(vaultStore, (s) => s.data?.subscriptions ?? []);
  const paymentMethods = useStore(vaultStore, (s) => s.data?.paymentMethods ?? []);
  const credentials = useStore(vaultStore, (s) => s.data?.credentials ?? []);
  const upsertSubscription = useStore(vaultStore, (s) => s.upsertSubscription);
  const deleteSubscription = useStore(vaultStore, (s) => s.deleteSubscription);
  const upsertCredential = useStore(vaultStore, (s) => s.upsertCredential);

  // UI state
  const [formOpen, setFormOpen] = React.useState(false);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [editSub, setEditSub] = React.useState<Subscription | undefined>();
  const [viewSub, setViewSub] = React.useState<Subscription | undefined>();

  /** Open the form for a new subscription */
  function handleAdd() {
    setEditSub(undefined);
    setFormOpen(true);
  }

  /** Open the form pre-filled for editing */
  function handleEdit(sub: Subscription) {
    setDetailOpen(false);
    setEditSub(sub);
    setFormOpen(true);
  }

  /** Open the detail panel for viewing */
  function handleView(sub: Subscription) {
    setViewSub(sub);
    setDetailOpen(true);
  }

  /** Handle form submission (create or update) */
  async function handleFormSubmit(raw: Subscription) {
    const sub = raw as SubWithCreds;
    const credEmail = sub._credEmail;
    const credPassword = sub._credPassword;

    // Strip ephemeral fields from the subscription object
    const clean: Subscription = { ...sub };
    delete (clean as SubWithCreds)._credEmail;
    delete (clean as SubWithCreds)._credPassword;

    // If credential fields are filled, create/upsert credential first
    if (credEmail || credPassword) {
      const credId = await upsertCredential({
        id: clean.credentialId ?? "",
        username: credEmail ?? "",
        password: credPassword ?? "",
      });
      clean.credentialId = credId;
    }

    await upsertSubscription(clean);
    setFormOpen(false);
    setEditSub(undefined);
  }

  /** Handle delete from detail view */
  async function handleDelete(id: string) {
    await deleteSubscription(id);
    setDetailOpen(false);
    setViewSub(undefined);
  }

  // Keep viewSub fresh after edits
  const freshViewSub = viewSub
    ? subscriptions.find((s) => s.id === viewSub.id) ?? viewSub
    : undefined;

  return (
    <>
      <SubscriptionList
        subscriptions={subscriptions}
        paymentMethods={paymentMethods}
        onAdd={handleAdd}
        onEdit={handleEdit}
        onView={handleView}
      />

      {/* ── Add / Edit form sheet ─────────────────────────── */}
      <Sheet open={formOpen} onOpenChange={setFormOpen}>
        <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-2xl">
          <SheetHeader className="pb-2">
            <SheetTitle>
              {editSub ? t('subs.sheetEdit') : t('subs.sheetAdd')}
            </SheetTitle>
          </SheetHeader>
          <SubscriptionForm
            key={editSub?.id ?? "new"}
            initial={editSub}
            paymentMethods={paymentMethods}
            onSubmit={handleFormSubmit}
            onCancel={() => {
              setFormOpen(false);
              setEditSub(undefined);
            }}
          />
        </SheetContent>
      </Sheet>

      {/* ── Detail sheet ─────────────────────────────────── */}
      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-2xl">
          <SheetHeader className="pb-2">
            <SheetTitle>
              {freshViewSub?.serviceName ?? t('subs.sheetDetailFallback')}
            </SheetTitle>
            <SheetDescription className="sr-only">
              {t('subs.sheetDetailDesc')}
            </SheetDescription>
          </SheetHeader>
          {freshViewSub && (
            <SubscriptionDetail
              subscription={freshViewSub}
              credentials={credentials}
              paymentMethods={paymentMethods}
              onEdit={() => handleEdit(freshViewSub)}
              onDelete={() => handleDelete(freshViewSub.id)}
              onClose={() => setDetailOpen(false)}
            />
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
