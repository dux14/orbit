"use client";

import * as React from "react";
import type { PaymentMethod } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/use-t";
import { BRANDS } from "@/components/payment/PaymentMethodForm";
import type { DraftCard } from "@/lib/services/save-subscription";

/** Fixed palette of card swatches (no native colour input, per spec §3.4). */
export const CARD_PALETTE = [
  "#b8c8f0", // periwinkle
  "#f0b8d8", // rose
  "#c8b8f0", // lilac
  "#b8f0d8", // mint
  "#f0d8b8", // sand
  "#f0b8b8", // coral
  "#b8e0f0", // sky
  "#d8d8e0", // slate
] as const;

/** Same shape the save service persists — single source of truth. */
export type NewCardDraft = DraftCard;

const EMPTY_DRAFT: NewCardDraft = {
  label: "",
  brand: "Visa",
  last4: "",
  color: CARD_PALETTE[0],
};

export interface PaymentMethodPickerProps {
  paymentMethods: PaymentMethod[];
  /** Currently selected existing-card id ("" = none). */
  value: string;
  onChange: (id: string) => void;
  /** Emits the in-progress new-card draft, or null when the new-card form is closed. */
  onNewCardChange: (draft: NewCardDraft | null) => void;
}

/**
 * PaymentMethodPicker — horizontal chips of saved cards + a "+ New card" chip
 * that expands an inline mini-form. Purely controlled: it never persists.
 * The parent form decides whether to call upsertPaymentMethod on submit.
 */
export function PaymentMethodPicker({
  paymentMethods,
  value,
  onChange,
  onNewCardChange,
}: PaymentMethodPickerProps) {
  const t = useT();
  const [creating, setCreating] = React.useState(false);
  const [draft, setDraft] = React.useState<NewCardDraft>(EMPTY_DRAFT);
  // A partially-typed last4 would be silently dropped on submit — warn inline.
  const last4Incomplete = draft.last4.length > 0 && draft.last4.length < 4;

  function updateDraft(patch: Partial<NewCardDraft>) {
    const next = { ...draft, ...patch };
    setDraft(next);
    onNewCardChange(next);
  }

  function openNewCard() {
    onChange(""); // deselect existing card; the new card wins
    setCreating(true);
    onNewCardChange(draft);
  }

  function closeNewCard() {
    setCreating(false);
    setDraft(EMPTY_DRAFT);
    onNewCardChange(null);
  }

  function selectExisting(id: string) {
    if (creating) closeNewCard();
    onChange(id);
  }

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium text-foreground">
        {t("subform.cardSectionLabel")}
      </legend>

      {/* Chips — radiogroup semantics for keyboard + SR */}
      <div
        role="radiogroup"
        aria-label={t("subform.cardChooseAria")}
        className="flex flex-wrap gap-2"
      >
        {/* None */}
        <button
          type="button"
          role="radio"
          aria-checked={value === "" && !creating}
          onClick={() => selectExisting("")}
          className={cn(
            "min-h-[44px] inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition-colors",
            value === "" && !creating
              ? "border-ring bg-accent text-accent-foreground"
              : "border-input text-muted-foreground hover:bg-accent/50",
          )}
        >
          {t("subform.cardNone")}
        </button>

        {/* Existing cards */}
        {paymentMethods.map((pm) => {
          const selected = value === pm.id && !creating;
          return (
            <button
              key={pm.id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${pm.label} ${pm.brand} ${pm.last4}`}
              onClick={() => selectExisting(pm.id)}
              className={cn(
                "min-h-[44px] inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition-colors",
                selected
                  ? "border-ring bg-accent text-accent-foreground"
                  : "border-input hover:bg-accent/50",
              )}
            >
              <span
                className="size-4 shrink-0 rounded-full border border-black/10"
                style={{ background: pm.color }}
                aria-hidden="true"
              />
              <span className="font-medium">{pm.brand}</span>
              <span className="text-muted-foreground">··{pm.last4}</span>
            </button>
          );
        })}

        {/* New card */}
        <button
          type="button"
          role="radio"
          aria-checked={creating}
          onClick={openNewCard}
          className={cn(
            "min-h-[44px] inline-flex items-center gap-2 rounded-full border border-dashed px-3 py-2 text-sm transition-colors",
            creating
              ? "border-ring bg-accent text-accent-foreground"
              : "border-input text-muted-foreground hover:bg-accent/50",
          )}
        >
          {t("subform.cardNew")}
        </button>
      </div>

      {/* Inline mini-form */}
      {creating && (
        <div className="mt-1 flex flex-col gap-3 rounded-xl border border-dashed border-border p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              {t("subform.cardNewLegend")}
            </span>
            <button
              type="button"
              onClick={closeNewCard}
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              {t("subform.newCardRemove")}
            </button>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="newcard-label">{t("subform.newCardLabel")}</Label>
            <Input
              id="newcard-label"
              type="text"
              placeholder={t("subform.newCardLabelPlaceholder")}
              value={draft.label}
              onChange={(e) => updateDraft({ label: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="newcard-brand">{t("subform.newCardBrand")}</Label>
              <select
                id="newcard-brand"
                value={draft.brand}
                onChange={(e) => updateDraft({ brand: e.target.value })}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {BRANDS.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="newcard-last4">{t("subform.newCardLast4")}</Label>
              <Input
                id="newcard-last4"
                type="text"
                inputMode="numeric"
                pattern="\d{4}"
                maxLength={4}
                placeholder="1234"
                value={draft.last4}
                onChange={(e) =>
                  updateDraft({ last4: e.target.value.replace(/\D/g, "").slice(0, 4) })
                }
                aria-describedby={last4Incomplete ? "newcard-last4-err" : undefined}
                aria-invalid={last4Incomplete ? true : undefined}
                className={cn(last4Incomplete && "border-destructive")}
              />
              {last4Incomplete && (
                <p
                  id="newcard-last4-err"
                  role="alert"
                  aria-live="polite"
                  className="text-xs text-destructive"
                >
                  {t("subform.newCardLast4Invalid")}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label id="newcard-color-label">{t("subform.newCardColor")}</Label>
            <div
              role="radiogroup"
              aria-labelledby="newcard-color-label"
              className="flex flex-wrap gap-2"
            >
              {CARD_PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={draft.color === c}
                  aria-label={`${t("subform.newCardColorAria")} ${c}`}
                  onClick={() => updateDraft({ color: c })}
                  className={cn(
                    "size-9 rounded-full border-2 transition-transform",
                    draft.color === c ? "border-ring scale-110" : "border-black/10",
                  )}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </fieldset>
  );
}
