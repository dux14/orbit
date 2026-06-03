"use client";

import * as React from "react";
import Link from "next/link";
import { useStore } from "zustand";
import { vaultStore } from "@/lib/store/vault-store";
import { settingsStore } from "@/lib/store/settings-store";
import { useDashboard } from "@/lib/store/use-dashboard";
import { daysUntilRenewal } from "@/lib/domain/renewals";
import { OrbitLogo } from "@/components/orbit/OrbitLogo";
import { OrbitViz } from "@/components/orbit/OrbitViz";
import { Badge } from "@/components/ui/badge";
import { AlertCircleIcon, PlusIcon, TrendingUpIcon, CalendarIcon } from "lucide-react";
import { notifyDueRenewals } from "@/lib/services/reminders";
import { ReminderPermission } from "@/components/reminders/ReminderPermission";
import { useT } from "@/lib/i18n/use-t";

// ─── Currency formatting ────────────────────────────────────────────────────────
function fmtCurrency(amount: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

// ─── Color maps (shared between breakdown chart and orbit legend) ──────────────
const CATEGORY_COLORS: Record<string, string> = {
  Streaming: "#f4a0b0",
  "News/Media": "#ffd6a0",
  Productivity: "#b8f0c8",
  Tools: "#d4b8f0",
  Cloud: "#a0d4f4",
  Finance: "#f4c0a0",
  Health: "#a0e8d8",
  Social: "#f0b8d4",
  Gaming: "#c8d4ff",
  Other: "#e0d4f0",
};

const CHART_FALLBACK_COLORS = [
  "#d4b8f0",
  "#a0d4f4",
  "#b8f0c8",
  "#ffd6a0",
  "#f4a0b0",
  "#a0e8d8",
  "#f4c0a0",
  "#c8d4ff",
  "#f0b8d4",
];

// ─── FX error banner ───────────────────────────────────────────────────────────
function FxErrorBanner({ message }: { message: string }) {
  const t = useT();
  return (
    <div
      role="alert"
      aria-live="polite"
      className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-300"
    >
      <AlertCircleIcon className="mt-0.5 size-4 flex-shrink-0" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <span className="font-medium">{t('dashboard.fxUnavailable')}</span>
        {" "}
        {t('dashboard.fxUnavailableSuffix')}{" "}
        <Link
          href="/settings"
          className="underline underline-offset-2 hover:no-underline font-medium"
        >
          {t('dashboard.fxSetManual')}
        </Link>
        {message && (
          <span className="block mt-0.5 text-xs opacity-70 truncate">{message}</span>
        )}
      </div>
    </div>
  );
}

// ─── Renewal day badge ─────────────────────────────────────────────────────────
function DayBadge({ days }: { days: number }) {
  const t = useT();
  if (days === 0)
    return (
      <Badge className="bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400">
        {t('dashboard.renewsToday')}
      </Badge>
    );
  if (days <= 3)
    return (
      <Badge className="bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400">
        {days}d
      </Badge>
    );
  if (days <= 7)
    return (
      <Badge className="bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400">
        {days}d
      </Badge>
    );
  return (
    <Badge variant="outline" className="text-muted-foreground">
      {days}d
    </Badge>
  );
}

// ─── Horizontal bar chart row ──────────────────────────────────────────────────
function BarRow({
  label,
  amount,
  maxAmount,
  currency,
  locale,
  color,
}: {
  label: string;
  amount: number;
  maxAmount: number;
  currency: string;
  locale: string;
  color: string;
}) {
  const pct = maxAmount > 0 ? Math.max((amount / maxAmount) * 100, 2) : 2;
  return (
    <div className="flex items-center gap-3 group">
      <span
        className="w-28 flex-shrink-0 text-xs text-muted-foreground truncate text-right"
        title={label}
      >
        {label}
      </span>
      <div
        className="flex-1 h-5 rounded-full bg-muted overflow-hidden"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label}: ${fmtCurrency(amount, currency, locale)}`}
      >
        <div
          className="h-full rounded-full motion-safe:transition-all motion-safe:duration-700"
          style={{
            width: `${pct}%`,
            background: color,
          }}
        />
      </div>
      <span className="w-20 flex-shrink-0 text-xs font-medium tabular-nums text-right text-foreground/80">
        {fmtCurrency(amount, currency, locale)}
      </span>
    </div>
  );
}

// ─── Breakdown card ────────────────────────────────────────────────────────────
function breakdownColor(label: string, index: number): string {
  return CATEGORY_COLORS[label] ?? CHART_FALLBACK_COLORS[index % CHART_FALLBACK_COLORS.length];
}

function BreakdownCard({
  title,
  data,
  currency,
  locale,
  emptyLabel,
}: {
  title: string;
  data: { label: string; amount: number }[];
  currency: string;
  locale: string;
  emptyLabel?: string;
}) {
  const t = useT();
  const maxAmount = Math.max(...data.map((d) => d.amount), 1);
  return (
    <section
      className="rounded-2xl border border-border bg-card p-5 flex flex-col gap-4"
      aria-label={title}
    >
      <h2 className="font-heading text-base text-foreground leading-tight">{title}</h2>
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyLabel ?? t('dashboard.noData')}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {data.map((row, i) => (
            <BarRow
              key={row.label}
              label={row.label}
              amount={row.amount}
              maxAmount={maxAmount}
              currency={currency}
              locale={locale}
              color={breakdownColor(row.label, i)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Hero total card ───────────────────────────────────────────────────────────
function HeroCard({
  monthly,
  annual,
  currency,
  locale,
}: {
  monthly: number;
  annual: number;
  currency: string;
  locale: string;
}) {
  const t = useT();
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-card px-6 py-7 flex flex-col gap-1">
      {/* Decorative radial glow */}
      <div
        className="pointer-events-none absolute -top-8 -right-8 size-40 rounded-full bg-primary/10 blur-3xl"
        aria-hidden="true"
      />
      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
        {t('dashboard.monthlySpend')}
      </p>
      <p
        className="font-heading text-4xl md:text-5xl font-bold text-foreground tabular-nums leading-none"
        aria-label={`${t('dashboard.monthlySpend')}: ${fmtCurrency(monthly, currency, locale)}`}
      >
        {fmtCurrency(monthly, currency, locale)}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <TrendingUpIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground/90 tabular-nums">
            {fmtCurrency(annual, currency, locale)}
          </span>{" "}
          {t('dashboard.perYear')}
        </p>
      </div>
    </div>
  );
}

// ─── Upcoming renewals ─────────────────────────────────────────────────────────
function UpcomingRenewals({
  upcoming,
  currency,
  locale,
}: {
  upcoming: ReturnType<typeof useDashboard>["upcoming"];
  currency: string;
  locale: string;
}) {
  const t = useT();
  const today = new Date();
  const shown = upcoming.slice(0, 8);

  return (
    <section
      className="rounded-2xl border border-border bg-card p-5 flex flex-col gap-4"
      aria-label={t('dashboard.upcomingRenewals')}
    >
      <div className="flex items-center gap-2">
        <CalendarIcon className="size-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="font-heading text-base text-foreground leading-tight">
          {t('dashboard.upcomingRenewals')}
        </h2>
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('dashboard.noUpcomingRenewals')}</p>
      ) : (
        <ol className="flex flex-col divide-y divide-border" aria-label={t('dashboard.upcomingRenewals')}>
          {shown.map((sub) => {
            const days = daysUntilRenewal(sub.nextRenewalDate, today);
            return (
              <li
                key={sub.id}
                className="flex items-center justify-between gap-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">
                    {sub.serviceName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {sub.amount.toLocaleString(locale, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{" "}
                    {sub.currency} · {sub.billingCycle}
                  </p>
                </div>
                <DayBadge days={days} />
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

// ─── Empty state ───────────────────────────────────────────────────────────────
function EmptyState() {
  const t = useT();
  return (
    <div className="flex flex-col items-center justify-center gap-6 py-20 text-center">
      <div className="relative">
        <div className="absolute inset-0 rounded-full bg-primary/10 blur-3xl scale-150 opacity-60" />
        <OrbitLogo size={96} className="relative drop-shadow-sm" />
      </div>
      <div className="space-y-1.5">
        <h2 className="font-heading text-2xl text-foreground">{t('dashboard.emptyTitle')}</h2>
        <p className="text-sm text-muted-foreground max-w-xs">
          {t('dashboard.emptyBody')}
        </p>
      </div>
      <Link
        href="/subscriptions"
        className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/80 transition-colors"
      >
        <PlusIcon className="size-4" />
        {t('dashboard.emptyAddBtn')}
      </Link>
    </div>
  );
}

// ─── Main dashboard ────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const subscriptions = useStore(vaultStore, (s) => s.data?.subscriptions ?? []);
  const paymentMethods = useStore(vaultStore, (s) => s.data?.paymentMethods ?? []);
  const settings = useStore(settingsStore, (s) => s.settings);
  const {
    monthlyTotal,
    annualTotal,
    byCategory,
    byPaymentMethod,
    upcoming,
    fxError,
  } = useDashboard();

  // Load settings once
  React.useEffect(() => {
    settingsStore.getState().loadSettings();
  }, []);

  // Fire browser notifications for due renewals (deduped per day)
  React.useEffect(() => {
    if (subscriptions.length === 0) return;
    notifyDueRenewals(subscriptions, settings.reminderLeadDays);
  }, [subscriptions, settings.reminderLeadDays]);

  const t = useT();
  const { primaryCurrency, locale } = settings;

  // Resolve payment method IDs → labels
  const noCardLabel = t('dashboard.noCard');
  const pmLabelMap = React.useMemo(() => {
    const m: Record<string, string> = { none: noCardLabel };
    for (const pm of paymentMethods) m[pm.id] = `${pm.brand} ····${pm.last4}`;
    return m;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentMethods, noCardLabel]);

  // Sort breakdowns descending by value
  const categoryRows = React.useMemo(
    () =>
      Object.entries(byCategory)
        .map(([label, amount]) => ({ label, amount }))
        .sort((a, b) => b.amount - a.amount),
    [byCategory]
  );

  const paymentRows = React.useMemo(
    () =>
      Object.entries(byPaymentMethod)
        .map(([id, amount]) => ({ label: pmLabelMap[id] ?? id, amount }))
        .sort((a, b) => b.amount - a.amount),
    [byPaymentMethod, pmLabelMap]
  );

  // Use FX from the store (accessed via hook's returned context)
  const [fx, setFx] = React.useState<import("@/lib/types").FxRatesCache | null>(null);
  React.useEffect(() => {
    import("@/lib/services/fx-service")
      .then(({ getFxRates }) => getFxRates(primaryCurrency))
      .then(setFx)
      .catch(() => setFx(null));
  }, [primaryCurrency]);

  const isEmpty = subscriptions.length === 0;

  return (
    <div className="flex flex-col gap-5">
      {/* Page heading */}
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-heading text-2xl md:text-3xl text-foreground leading-tight">
          {t('dashboard.title')}
        </h1>
        {!isEmpty && (
          <Link
            href="/subscriptions"
            className="hidden md:inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-border bg-background text-sm font-medium hover:bg-muted transition-colors"
          >
            <PlusIcon className="size-3.5" />
            {t('dashboard.add')}
          </Link>
        )}
      </div>

      {/* FX error banner */}
      {fxError && <FxErrorBanner message={fxError} />}

      {/* Empty state */}
      {isEmpty ? (
        <EmptyState />
      ) : (
        <div className="flex flex-col gap-5">
          {/* ── Hero totals ──────────────────────────────────────── */}
          <HeroCard
            monthly={monthlyTotal}
            annual={annualTotal}
            currency={primaryCurrency}
            locale={locale}
          />

          {/* ── Orbit visualization ──────────────────────────────── */}
          <section
            className="rounded-2xl border border-border bg-card p-5 flex flex-col items-center gap-3"
            aria-label={t('dashboard.yourOrbit')}
          >
            <div className="flex items-center justify-between w-full">
              <h2 className="font-heading text-base text-foreground leading-tight">
                {t('dashboard.yourOrbit')}
              </h2>
              <span className="text-xs text-muted-foreground">
                {subscriptions.filter(s => s.status === "active" || s.status === "trial").length} {t('dashboard.active')}
              </span>
            </div>
            <OrbitViz
              subscriptions={subscriptions}
              primaryCurrency={primaryCurrency}
              fx={fx}
              size={260}
              className="max-w-full"
            />
            {/* Legend */}
            <div className="flex flex-wrap justify-center gap-2 mt-1">
              {categoryRows.slice(0, 6).map((row) => (
                <div key={row.label} className="flex items-center gap-1.5">
                  <span
                    className="size-2.5 rounded-full flex-shrink-0"
                    style={{
                      background:
                        CATEGORY_COLORS[row.label] ??
                        CHART_FALLBACK_COLORS[categoryRows.indexOf(row) % CHART_FALLBACK_COLORS.length],
                    }}
                    aria-hidden="true"
                  />
                  <span className="text-xs text-muted-foreground">{row.label}</span>
                </div>
              ))}
            </div>
          </section>

          {/* ── Breakdowns ───────────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <BreakdownCard
              title={t('dashboard.byCategory')}
              data={categoryRows}
              currency={primaryCurrency}
              locale={locale}
              emptyLabel={t('dashboard.noCategoryData')}
            />
            <BreakdownCard
              title={t('dashboard.byPaymentMethod')}
              data={paymentRows}
              currency={primaryCurrency}
              locale={locale}
              emptyLabel={t('dashboard.noPaymentData')}
            />
          </div>

          {/* ── Upcoming renewals ─────────────────────────────────── */}
          <UpcomingRenewals
            upcoming={upcoming}
            currency={primaryCurrency}
            locale={locale}
          />

          {/* ── Reminder permission affordance ────────────────────── */}
          <div className="flex justify-end px-1">
            <ReminderPermission />
          </div>
        </div>
      )}
    </div>
  );
}

