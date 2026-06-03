"use client";

import * as React from "react";
import type { PaymentMethod } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/use-t";

// ─── Constants ─────────────────────────────────────────────────────────────

export const BRANDS = ["Visa", "Mastercard", "Amex", "Discover", "PayPal", "Other"] as const;
export type Brand = (typeof BRANDS)[number];

const DEFAULT_COLOR = "#b8c8f0";

// ─── Helpers ────────────────────────────────────────────────────────────────

function FieldGroup({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("flex flex-col gap-1.5", className)}>{children}</div>;
}

function ErrorMsg({ id, msg }: { id?: string; msg?: string }) {
  if (!msg) return null;
  return (
    <p
      id={id}
      role="alert"
      aria-live="polite"
      className="text-xs text-destructive"
    >
      {msg}
    </p>
  );
}

// ─── Props ──────────────────────────────────────────────────────────────────

export interface PaymentMethodFormProps {
  onSubmit: (pm: PaymentMethod) => void;
  onCancel: () => void;
  initial?: PaymentMethod;
}

interface FormErrors {
  label?: string;
  last4?: string;
}

// ─── PaymentMethodForm ──────────────────────────────────────────────────────

/**
 * Presentational form for creating / editing a PaymentMethod.
 *
 * PCI-SAFE: contains NO field for full card number, CVV, or expiry.
 * Only label, brand, last4 (4 digits), and a colour picker.
 */
export function PaymentMethodForm({
  onSubmit,
  onCancel,
  initial,
}: PaymentMethodFormProps) {
  const t = useT();
  const [label, setLabel] = React.useState(initial?.label ?? "");
  const [brand, setBrand] = React.useState<string>(initial?.brand ?? "Visa");
  const [last4, setLast4] = React.useState(initial?.last4 ?? "");
  const [color, setColor] = React.useState(initial?.color ?? DEFAULT_COLOR);
  const [errors, setErrors] = React.useState<FormErrors>({});
  const [touched, setTouched] = React.useState<Record<string, boolean>>({});

  // Inline validation on blur
  function validateField(field: "label" | "last4", value: string): string | undefined {
    if (field === "label") {
      return value.trim() === "" ? t('pmform.cardLabelRequired') : undefined;
    }
    if (field === "last4") {
      if (value.trim() === "") return t('pmform.last4Required');
      if (!/^\d{4}$/.test(value.trim())) return t('pmform.last4Invalid');
      return undefined;
    }
  }

  function handleBlur(field: "label" | "last4", value: string) {
    setTouched((t) => ({ ...t, [field]: true }));
    const err = validateField(field, value);
    setErrors((e) => ({ ...e, [field]: err }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs: FormErrors = {
      label: validateField("label", label),
      last4: validateField("last4", last4),
    };
    if (errs.label || errs.last4) {
      setErrors(errs);
      setTouched({ label: true, last4: true });
      return;
    }
    setErrors({});

    const pm: PaymentMethod = {
      id: initial?.id ?? "",
      label: label.trim(),
      brand,
      last4: last4.trim(),
      color,
    };
    onSubmit(pm);
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="flex flex-col gap-4 p-1"
      aria-label={t('pmform.ariaLabel')}
    >
      {/* ── Label ─────────────────────────────────────── */}
      <FieldGroup>
        <Label htmlFor="pm-label">
          {t('pmform.cardLabel')} <span aria-hidden>*</span>
        </Label>
        <Input
          id="pm-label"
          type="text"
          placeholder={t('pmform.cardLabelPlaceholder')}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => handleBlur("label", label)}
          aria-required="true"
          aria-describedby={errors.label ? "pm-label-err" : undefined}
          className={cn(touched.label && errors.label && "border-destructive")}
        />
        <ErrorMsg id="pm-label-err" msg={touched.label ? errors.label : undefined} />
      </FieldGroup>

      {/* ── Brand ─────────────────────────────────────── */}
      <FieldGroup>
        <Label htmlFor="pm-brand">{t('pmform.brand')}</Label>
        <select
          id="pm-brand"
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {BRANDS.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </FieldGroup>

      {/* ── Last 4 digits ────────────────────────────── */}
      <FieldGroup>
        <Label htmlFor="pm-last4">
          {t('pmform.last4')} <span aria-hidden>*</span>
        </Label>
        <Input
          id="pm-last4"
          type="text"
          inputMode="numeric"
          pattern="\d{4}"
          maxLength={4}
          placeholder="1234"
          value={last4}
          onChange={(e) => {
            // Allow only digits
            const val = e.target.value.replace(/\D/g, "").slice(0, 4);
            setLast4(val);
            // Clear error as user types if already touched
            if (touched.last4) {
              const err = validateField("last4", val);
              setErrors((errs) => ({ ...errs, last4: err }));
            }
          }}
          onBlur={() => handleBlur("last4", last4)}
          aria-required="true"
          aria-describedby="pm-last4-help pm-last4-err"
          className={cn(touched.last4 && errors.last4 && "border-destructive")}
        />
        <p id="pm-last4-help" className="text-xs text-muted-foreground">
          {t('pmform.last4Help')}
        </p>
        <ErrorMsg id="pm-last4-err" msg={touched.last4 ? errors.last4 : undefined} />
      </FieldGroup>

      {/* ── Color ─────────────────────────────────────── */}
      <FieldGroup>
        <Label htmlFor="pm-color">{t('pmform.colour')}</Label>
        <div className="flex items-center gap-3">
          <input
            id="pm-color"
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-8 w-12 cursor-pointer rounded-md border border-input bg-transparent p-0.5 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
            aria-label={t('pmform.colourAriaLabel')}
          />
          <span className="text-xs text-muted-foreground font-mono">{color}</span>
        </div>
      </FieldGroup>

      {/* ── Actions ───────────────────────────────────── */}
      <div className="flex gap-2 justify-end pt-1">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('pmform.cancel')}
        </Button>
        <Button type="submit">
          {initial ? t('pmform.save') : t('pmform.addCard')}
        </Button>
      </div>
    </form>
  );
}
