"use client";

import * as React from "react";
import type { Subscription, PaymentMethod, BillingCycle, SubscriptionStatus } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** ─── Types ─────────────────────────────────────────────────────────── */
interface SubscriptionFormProps {
  onSubmit: (sub: Subscription) => void;
  onCancel: () => void;
  initial?: Subscription;
  paymentMethods?: PaymentMethod[];
}

interface FormErrors {
  serviceName?: string;
  amount?: string;
  nextRenewalDate?: string;
}

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY", "CHF", "MXN", "BRL", "COP"];
const BILLING_CYCLES: { value: BillingCycle; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "annual", label: "Annual" },
  { value: "custom", label: "Custom" },
];
const STATUSES: { value: SubscriptionStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "trial", label: "Trial" },
  { value: "paused", label: "Paused" },
  { value: "canceled", label: "Canceled" },
];
const CATEGORIES = [
  "Streaming", "Productivity", "Finance", "Health", "News/Media",
  "Gaming", "Cloud", "Social", "Tools", "Other",
];

/** ─── Field components (inline for test isolation) ──────────────────── */
function FieldGroup({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-1.5", className)}>{children}</div>;
}

function ErrorMsg({ msg }: { msg?: string }) {
  if (!msg) return null;
  return (
    <p role="alert" className="text-xs text-destructive" aria-live="polite">
      {msg}
    </p>
  );
}

/** ─── SubscriptionForm ──────────────────────────────────────────────── */
export function SubscriptionForm({
  onSubmit,
  onCancel,
  initial,
  paymentMethods = [],
}: SubscriptionFormProps) {
  // Core fields
  const [serviceName, setServiceName] = React.useState(initial?.serviceName ?? "");
  const [category, setCategory] = React.useState(initial?.category ?? "");
  const [accountEmail, setAccountEmail] = React.useState(initial?.accountEmail ?? "");
  const [plan, setPlan] = React.useState(initial?.plan ?? "");
  const [amount, setAmount] = React.useState(initial?.amount?.toString() ?? "");
  const [currency, setCurrency] = React.useState(initial?.currency ?? "USD");
  const [billingCycle, setBillingCycle] = React.useState<BillingCycle>(initial?.billingCycle ?? "monthly");
  const [customCycleDays, setCustomCycleDays] = React.useState(initial?.customCycleDays?.toString() ?? "");
  const [nextRenewalDate, setNextRenewalDate] = React.useState(initial?.nextRenewalDate ?? "");
  const [status, setStatus] = React.useState<SubscriptionStatus>(initial?.status ?? "active");
  const [paymentMethodId, setPaymentMethodId] = React.useState(initial?.paymentMethodId ?? "");
  const [url, setUrl] = React.useState(initial?.url ?? "");
  const [notes, setNotes] = React.useState(initial?.notes ?? "");

  // Optional credential fields
  const [credEmail, setCredEmail] = React.useState("");
  const [credPassword, setCredPassword] = React.useState("");

  // Validation
  const [errors, setErrors] = React.useState<FormErrors>({});

  function validate(): FormErrors {
    const errs: FormErrors = {};
    if (!serviceName.trim()) errs.serviceName = "Service name is required";
    if (!amount.trim() || isNaN(Number(amount))) errs.amount = "A valid amount is required";
    if (!nextRenewalDate) errs.nextRenewalDate = "Next renewal date is required";
    return errs;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setErrors({});

    const now = new Date().toISOString();
    const sub: Subscription = {
      id: initial?.id ?? "",
      serviceName: serviceName.trim(),
      category: category.trim(),
      accountEmail: accountEmail.trim() || undefined,
      plan: plan.trim() || undefined,
      amount: Number(amount),
      currency,
      billingCycle,
      customCycleDays: billingCycle === "custom" && customCycleDays ? Number(customCycleDays) : undefined,
      nextRenewalDate,
      status,
      paymentMethodId: paymentMethodId || undefined,
      url: url.trim() || undefined,
      notes: notes.trim() || undefined,
      // credential fields are handled by the page — form exposes them via the sub object if filled
      credentialId: initial?.credentialId,
      createdAt: initial?.createdAt ?? now,
      updatedAt: now,
      // Attach ephemeral credential data for the page to process
      ...(credEmail || credPassword
        ? { _credEmail: credEmail, _credPassword: credPassword } as unknown as object
        : {}),
    };

    onSubmit(sub);
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="flex flex-col gap-4 p-1"
      aria-label="Subscription form"
    >
      {/* ── Core info ─────────────────────────────────── */}
      <FieldGroup>
        <Label htmlFor="sub-serviceName">
          Service name <span aria-hidden>*</span>
        </Label>
        <Input
          id="sub-serviceName"
          type="text"
          placeholder="e.g. Netflix"
          value={serviceName}
          onChange={(e) => setServiceName(e.target.value)}
          aria-required="true"
          aria-describedby={errors.serviceName ? "sub-serviceName-err" : undefined}
          className={cn(errors.serviceName && "border-destructive")}
        />
        {errors.serviceName && (
          <p id="sub-serviceName-err" role="alert" className="text-xs text-destructive" aria-live="polite">
            {errors.serviceName}
          </p>
        )}
      </FieldGroup>

      <div className="grid grid-cols-2 gap-3">
        <FieldGroup>
          <Label htmlFor="sub-amount">
            Amount <span aria-hidden>*</span>
          </Label>
          <Input
            id="sub-amount"
            type="number"
            inputMode="decimal"
            placeholder="0.00"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-required="true"
            className={cn(errors.amount && "border-destructive")}
          />
          <ErrorMsg msg={errors.amount} />
        </FieldGroup>

        <FieldGroup>
          <Label htmlFor="sub-currency">Currency</Label>
          <select
            id="sub-currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </FieldGroup>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FieldGroup>
          <Label htmlFor="sub-billing">Billing cycle</Label>
          <select
            id="sub-billing"
            value={billingCycle}
            onChange={(e) => setBillingCycle(e.target.value as BillingCycle)}
            className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {BILLING_CYCLES.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </FieldGroup>

        {billingCycle === "custom" && (
          <FieldGroup>
            <Label htmlFor="sub-cycleDays">Cycle days</Label>
            <Input
              id="sub-cycleDays"
              type="number"
              min="1"
              placeholder="30"
              value={customCycleDays}
              onChange={(e) => setCustomCycleDays(e.target.value)}
            />
          </FieldGroup>
        )}
      </div>

      <FieldGroup>
        <Label htmlFor="sub-nextRenewal">
          Next renewal <span aria-hidden>*</span>
        </Label>
        <Input
          id="sub-nextRenewal"
          type="date"
          value={nextRenewalDate}
          onChange={(e) => setNextRenewalDate(e.target.value)}
          aria-required="true"
          className={cn(errors.nextRenewalDate && "border-destructive")}
        />
        <ErrorMsg msg={errors.nextRenewalDate} />
      </FieldGroup>

      <div className="grid grid-cols-2 gap-3">
        <FieldGroup>
          <Label htmlFor="sub-status">Status</Label>
          <select
            id="sub-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as SubscriptionStatus)}
            className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {STATUSES.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </FieldGroup>

        <FieldGroup>
          <Label htmlFor="sub-category">Category</Label>
          <select
            id="sub-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <option value="">— Select —</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </FieldGroup>
      </div>

      <FieldGroup>
        <Label htmlFor="sub-accountEmail">Account email</Label>
        <Input
          id="sub-accountEmail"
          type="email"
          placeholder="you@example.com"
          value={accountEmail}
          onChange={(e) => setAccountEmail(e.target.value)}
          autoComplete="email"
        />
      </FieldGroup>

      <FieldGroup>
        <Label htmlFor="sub-plan">Plan / tier</Label>
        <Input
          id="sub-plan"
          type="text"
          placeholder="e.g. Standard, Premium"
          value={plan}
          onChange={(e) => setPlan(e.target.value)}
        />
      </FieldGroup>

      {paymentMethods.length > 0 && (
        <FieldGroup>
          <Label htmlFor="sub-pm">Payment method</Label>
          <select
            id="sub-pm"
            value={paymentMethodId}
            onChange={(e) => setPaymentMethodId(e.target.value)}
            className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <option value="">— None —</option>
            {paymentMethods.map((pm) => (
              <option key={pm.id} value={pm.id}>
                {pm.label} ({pm.brand} ····{pm.last4})
              </option>
            ))}
          </select>
        </FieldGroup>
      )}

      <FieldGroup>
        <Label htmlFor="sub-url">Website URL</Label>
        <Input
          id="sub-url"
          type="url"
          placeholder="https://example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </FieldGroup>

      <FieldGroup>
        <Label htmlFor="sub-notes">Notes</Label>
        <textarea
          id="sub-notes"
          rows={2}
          placeholder="Any notes…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 resize-none placeholder:text-muted-foreground"
        />
      </FieldGroup>

      {/* ── Credential section ─────────────────────────── */}
      <fieldset className="rounded-lg border border-dashed border-border p-3 flex flex-col gap-3">
        <legend className="px-1 text-xs font-medium text-muted-foreground">
          Login credentials (optional)
        </legend>
        <FieldGroup>
          <Label htmlFor="sub-cred-email">Email / username</Label>
          <Input
            id="sub-cred-email"
            type="email"
            placeholder="Login email"
            value={credEmail}
            onChange={(e) => setCredEmail(e.target.value)}
            autoComplete="username"
          />
        </FieldGroup>
        <FieldGroup>
          <Label htmlFor="sub-cred-password">Password</Label>
          <Input
            id="sub-cred-password"
            type="password"
            placeholder="••••••••"
            value={credPassword}
            onChange={(e) => setCredPassword(e.target.value)}
            autoComplete="new-password"
          />
        </FieldGroup>
      </fieldset>

      {/* ── Actions ────────────────────────────────────── */}
      <div className="flex gap-2 justify-end pt-1">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">
          Save
        </Button>
      </div>
    </form>
  );
}
