"use client";

import * as React from "react";
import { useStore } from "zustand";
import { vaultStore } from "@/lib/store/vault-store";
import type { PaymentMethod } from "@/lib/types";
import { PaymentMethodForm } from "@/components/payment/PaymentMethodForm";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { PlusIcon, PencilIcon, Trash2Icon, CreditCardIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Card tile ──────────────────────────────────────────────────────────────

interface CardTileProps {
  pm: PaymentMethod;
  onEdit: () => void;
  onDelete: () => void;
}

function CardTile({ pm, onEdit, onDelete }: CardTileProps) {
  return (
    <div
      className="group relative flex items-center gap-4 rounded-2xl border border-border bg-card px-4 py-3.5 transition-shadow hover:shadow-sm focus-within:ring-2 focus-within:ring-ring/40"
      role="listitem"
    >
      {/* Colour swatch */}
      <span
        className="size-10 shrink-0 rounded-xl border border-black/10"
        style={{ background: pm.color }}
        aria-hidden="true"
      />

      {/* Card info */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground leading-snug">
          {pm.label}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          <span className="font-medium">{pm.brand}</span>
          {" · "}
          <span aria-label={`ending in ${pm.last4}`}>
            {"•••• "}
            {pm.last4}
          </span>
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onEdit}
          aria-label={`Edit ${pm.label}`}
          className="cursor-pointer"
        >
          <PencilIcon className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onDelete}
          aria-label={`Delete ${pm.label}`}
          className="cursor-pointer text-destructive hover:text-destructive hover:bg-destructive/10"
        >
          <Trash2Icon className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ─── Empty state ────────────────────────────────────────────────────────────

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-muted">
        <CreditCardIcon className="size-7 text-muted-foreground" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">No cards saved yet</p>
        <p className="text-xs text-muted-foreground max-w-xs">
          Add a card alias to track which subscriptions use it.
          Only the last 4 digits are stored — no full card number.
        </p>
      </div>
      <Button onClick={onAdd} size="sm" className="cursor-pointer">
        <PlusIcon />
        Add card
      </Button>
    </div>
  );
}

// ─── Delete confirmation dialog ─────────────────────────────────────────────

interface DeleteDialogProps {
  pm: PaymentMethod | null;
  onConfirm: () => void;
  onCancel: () => void;
}

function DeleteDialog({ pm, onConfirm, onCancel }: DeleteDialogProps) {
  return (
    <Dialog open={pm !== null} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent aria-describedby="delete-card-desc">
        <DialogHeader>
          <DialogTitle>Delete card?</DialogTitle>
          <DialogDescription id="delete-card-desc">
            Remove <span className="font-medium">{pm?.label}</span>{" "}
            ({pm?.brand} ···· {pm?.last4})? Any subscriptions linked to this card will
            lose the reference.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} className="cursor-pointer">
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} className="cursor-pointer">
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function PaymentMethodsPage() {
  // Store
  const paymentMethods = useStore(vaultStore, (s) => s.data?.paymentMethods ?? []);
  const upsertPaymentMethod = useStore(vaultStore, (s) => s.upsertPaymentMethod);
  const deletePaymentMethod = useStore(vaultStore, (s) => s.deletePaymentMethod);

  // Form sheet state
  const [formOpen, setFormOpen] = React.useState(false);
  const [editPm, setEditPm] = React.useState<PaymentMethod | undefined>();

  // Delete dialog state
  const [deletePm, setDeletePm] = React.useState<PaymentMethod | null>(null);

  function handleAdd() {
    setEditPm(undefined);
    setFormOpen(true);
  }

  function handleEdit(pm: PaymentMethod) {
    setEditPm(pm);
    setFormOpen(true);
  }

  async function handleFormSubmit(pm: PaymentMethod) {
    await upsertPaymentMethod(pm);
    setFormOpen(false);
    setEditPm(undefined);
  }

  async function handleDeleteConfirm() {
    if (deletePm) {
      await deletePaymentMethod(deletePm.id);
      setDeletePm(null);
    }
  }

  return (
    <>
      {/* ── Header ───────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-heading text-3xl text-foreground">Cards</h1>
        {paymentMethods.length > 0 && (
          <Button size="sm" onClick={handleAdd} className="cursor-pointer">
            <PlusIcon />
            Add card
          </Button>
        )}
      </div>

      {/* ── Card list ─────────────────────────────────── */}
      {paymentMethods.length === 0 ? (
        <EmptyState onAdd={handleAdd} />
      ) : (
        <div
          role="list"
          aria-label="Saved payment cards"
          className="flex flex-col gap-3"
        >
          {paymentMethods.map((pm) => (
            <CardTile
              key={pm.id}
              pm={pm}
              onEdit={() => handleEdit(pm)}
              onDelete={() => setDeletePm(pm)}
            />
          ))}
        </div>
      )}

      {/* ── Add / Edit sheet ──────────────────────────── */}
      <Sheet open={formOpen} onOpenChange={setFormOpen}>
        <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-2xl">
          <SheetHeader className="pb-2">
            <SheetTitle>
              {editPm ? "Edit card" : "Add card"}
            </SheetTitle>
          </SheetHeader>
          <PaymentMethodForm
            key={editPm?.id ?? "new"}
            initial={editPm}
            onSubmit={handleFormSubmit}
            onCancel={() => {
              setFormOpen(false);
              setEditPm(undefined);
            }}
          />
        </SheetContent>
      </Sheet>

      {/* ── Delete confirmation ───────────────────────── */}
      <DeleteDialog
        pm={deletePm}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeletePm(null)}
      />
    </>
  );
}
