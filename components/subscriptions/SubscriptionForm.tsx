"use client";

import * as React from "react";
import type { Subscription, PaymentMethod, BillingCycle, SubscriptionStatus } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/use-t";
import type { DictKey } from "@/lib/i18n/dict";
import { Collapsible } from "@base-ui/react/collapsible";
import { ChevronDownIcon } from "lucide-react";
import { PaymentMethodPicker, type NewCardDraft } from "./PaymentMethodPicker";

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
  newCard?: string;
}

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY", "CHF", "MXN", "BRL", "COP"];
const BILLING_CYCLE_VALUES: BillingCycle[] = ["monthly", "annual", "custom"];
const STATUS_VALUES: SubscriptionStatus[] = ["active", "trial", "paused", "canceled"];

const BILLING_CYCLE_KEYS: Record<BillingCycle, DictKey> = {
  monthly: "subform.billingMonthly",
  annual: "subform.billingAnnual",
  custom: "subform.billingCustom",
};
const STATUS_KEYS: Record<SubscriptionStatus, DictKey> = {
  active: "subform.statusActive",
  trial: "subform.statusTrial",
  paused: "subform.statusPaused",
  canceled: "subform.statusCanceled",
};
const CATEGORIES = [
  "Streaming", "Productivity", "Finance", "Health", "News/Media",
  "Gaming", "Cloud", "Social", "Tools", "Other",
];

/** ─── Field components (inline for test isolation) ──────────────────── */
function FieldGroup({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-1.5", className)}>{children}</div>;
}

function ErrorMsg({ id, msg }: { id?: string; msg?: string }) {
  if (!msg) return null;
  return (
    <p id={id} role="alert" className="text-xs text-destructive" aria-live="polite">
      {msg}
    </p>
  );
}

function AccordionSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Collapsible.Root defaultOpen={false} className="rounded-xl border border-border">
      <Collapsible.Trigger
        className="group flex min-h-[44px] w-full items-center justify-between gap-2 px-3.5 py-2.5 text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-xl"
      >
        {title}
        <ChevronDownIcon
          aria-hidden="true"
          className="size-4 text-muted-foreground transition-transform duration-200 group-data-[panel-open]:rotate-180"
        />
      </Collapsible.Trigger>
      <Collapsible.Panel className="overflow-hidden">
        <div className="flex flex-col gap-4 px-3.5 pb-3.5 pt-1">{children}</div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

/** ─── SubscriptionForm ──────────────────────────────────────────────── */
export function SubscriptionForm({
  onSubmit,
  onCancel,
  initial,
  paymentMethods = [],
}: SubscriptionFormProps) {
  const t = useT();
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

  // New card drafted inline via PaymentMethodPicker (null = none)
  const [newCard, setNewCard] = React.useState<NewCardDraft | null>(null);

  // Validation
  const [errors, setErrors] = React.useState<FormErrors>({});

  function validate(): FormErrors {
    const errs: FormErrors = {};
    if (!serviceName.trim()) errs.serviceName = t('subform.serviceNameRequired');
    if (!amount.trim() || isNaN(Number(amount))) errs.amount = t('subform.amountRequired');
    if (!nextRenewalDate) errs.nextRenewalDate = t('subform.nextRenewalRequired');
    // An open but incomplete new-card draft would be silently dropped — block instead.
    if (newCard && !(newCard.label.trim() && /^\d{4}$/.test(newCard.last4))) {
      errs.newCard = t('subform.newCardIncomplete');
    }
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
      // Attach ephemeral data for the page to process
      ...(credEmail || credPassword
        ? { _credEmail: credEmail, _credPassword: credPassword } as unknown as object
        : {}),
      ...(newCard && newCard.label.trim() && /^\d{4}$/.test(newCard.last4)
        ? { _newPaymentMethod: newCard } as unknown as object
        : {}),
    };

    onSubmit(sub);
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="flex flex-col gap-4 p-1"
      aria-label={t('subform.ariaLabel')}
    >
      {/* ── Essential block (always visible) ──────────── */}
      <FieldGroup>
        <Label htmlFor="sub-serviceName">
          {t('subform.serviceName')} <span aria-hidden>*</span>
        </Label>
        <Input
          id="sub-serviceName"
          type="text"
          placeholder={t('subform.serviceNamePlaceholder')}
          value={serviceName}
          onChange={(e) => setServiceName(e.target.value)}
          aria-required="true"
          aria-describedby={errors.serviceName ? "sub-serviceName-err" : undefined}
          aria-invalid={errors.serviceName ? true : undefined}
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
            {t('subform.amount')} <span aria-hidden>*</span>
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
            aria-describedby={errors.amount ? "sub-amount-err" : undefined}
            aria-invalid={errors.amount ? true : undefined}
            className={cn(errors.amount && "border-destructive")}
          />
          <ErrorMsg id="sub-amount-err" msg={errors.amount} />
        </FieldGroup>

        <FieldGroup>
          <Label htmlFor="sub-currency">{t('subform.currency')}</Label>
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
          <Label htmlFor="sub-billing">{t('subform.billingCycle')}</Label>
          <select
            id="sub-billing"
            value={billingCycle}
            onChange={(e) => setBillingCycle(e.target.value as BillingCycle)}
            className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {BILLING_CYCLE_VALUES.map((value) => (
              <option key={value} value={value}>
                {t(BILLING_CYCLE_KEYS[value])}
              </option>
            ))}
          </select>
        </FieldGroup>

        {billingCycle === "custom" && (
          <FieldGroup>
            <Label htmlFor="sub-cycleDays">{t('subform.cycleDays')}</Label>
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
          {t('subform.nextRenewal')} <span aria-hidden>*</span>
        </Label>
        <Input
          id="sub-nextRenewal"
          type="date"
          value={nextRenewalDate}
          onChange={(e) => setNextRenewalDate(e.target.value)}
          aria-required="true"
          aria-describedby={errors.nextRenewalDate ? "sub-nextRenewal-err" : undefined}
          aria-invalid={errors.nextRenewalDate ? true : undefined}
          className={cn(errors.nextRenewalDate && "border-destructive")}
        />
        <ErrorMsg id="sub-nextRenewal-err" msg={errors.nextRenewalDate} />
      </FieldGroup>

      {/* ── Payment method picker ─────────────────────── */}
      <PaymentMethodPicker
        paymentMethods={paymentMethods}
        value={paymentMethodId}
        onChange={setPaymentMethodId}
        onNewCardChange={setNewCard}
      />
      <ErrorMsg id="sub-newcard-err" msg={errors.newCard} />

      {/* ── Account & plan ────────────────────────────── */}
      <AccordionSection title={t('subform.sectionAccountPlan')}>
        <FieldGroup>
          <Label htmlFor="sub-accountEmail">{t('subform.accountEmail')}</Label>
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
          <Label htmlFor="sub-plan">{t('subform.plan')}</Label>
          <Input
            id="sub-plan"
            type="text"
            placeholder={t('subform.planPlaceholder')}
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
          />
        </FieldGroup>

        <FieldGroup>
          <Label htmlFor="sub-url">{t('subform.url')}</Label>
          <Input
            id="sub-url"
            type="url"
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </FieldGroup>
      </AccordionSection>

      {/* ── Credentials ───────────────────────────────── */}
      <AccordionSection title={t('subform.sectionCredentials')}>
        <FieldGroup>
          <Label htmlFor="sub-cred-email">{t('subform.credEmail')}</Label>
          <Input
            id="sub-cred-email"
            type="email"
            placeholder={t('subform.credEmailPlaceholder')}
            value={credEmail}
            onChange={(e) => setCredEmail(e.target.value)}
            autoComplete="username"
          />
        </FieldGroup>
        <FieldGroup>
          <Label htmlFor="sub-cred-password">{t('subform.credPassword')}</Label>
          <Input
            id="sub-cred-password"
            type="password"
            placeholder="••••••••"
            value={credPassword}
            onChange={(e) => setCredPassword(e.target.value)}
            autoComplete="new-password"
          />
        </FieldGroup>
      </AccordionSection>

      {/* ── Notes & status ────────────────────────────── */}
      <AccordionSection title={t('subform.sectionNotesStatus')}>
        <div className="grid grid-cols-2 gap-3">
          <FieldGroup>
            <Label htmlFor="sub-status">{t('subform.status')}</Label>
            <select
              id="sub-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as SubscriptionStatus)}
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {STATUS_VALUES.map((value) => (
                <option key={value} value={value}>
                  {t(STATUS_KEYS[value])}
                </option>
              ))}
            </select>
          </FieldGroup>

          <FieldGroup>
            <Label htmlFor="sub-category">{t('subform.category')}</Label>
            <select
              id="sub-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <option value="">{t('subform.categorySelect')}</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </FieldGroup>
        </div>

        <FieldGroup>
          <Label htmlFor="sub-notes">{t('subform.notes')}</Label>
          <textarea
            id="sub-notes"
            rows={2}
            placeholder={t('subform.notesPlaceholder')}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 resize-none placeholder:text-muted-foreground"
          />
        </FieldGroup>
      </AccordionSection>

      {/* ── Actions ────────────────────────────────────── */}
      <div className="flex gap-2 justify-end pt-1">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('subform.cancel')}
        </Button>
        <Button type="submit">
          {t('subform.save')}
        </Button>
      </div>
    </form>
  );
}
