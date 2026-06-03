"use client";

import * as React from "react";
import type { Subscription, PaymentMethod } from "@/lib/types";
import { daysUntilRenewal } from "@/lib/domain/renewals";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OrbitLogo } from "@/components/orbit/OrbitLogo";
import { cn } from "@/lib/utils";
import {
  PlusIcon,
  SearchIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import { useT } from "@/lib/i18n/use-t";

/** ─── Types ──────────────────────────────────────────────────────────── */
export type SortKey = "renewal" | "amount" | "alpha";

export interface SubscriptionListProps {
  subscriptions: Subscription[];
  paymentMethods?: PaymentMethod[];
  onAdd: () => void;
  onEdit: (sub: Subscription) => void;
  onView: (sub: Subscription) => void;
}

/** ─── Category color map (matches OrbitLogo pastel palette) ─────────── */
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
  Other: "#e0e0e0",
};

function categoryColor(cat: string): string {
  return CATEGORY_COLORS[cat] ?? "#e0e0e0";
}

/** ─── Renewal badge ─────────────────────────────────────────────────── */
function RenewalBadge({ sub }: { sub: Subscription }) {
  const t = useT();
  if (sub.status === "canceled") {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        {t('subs.statusCanceled')}
      </Badge>
    );
  }
  if (sub.status === "paused") {
    return (
      <Badge variant="secondary" className="text-muted-foreground">
        {t('subs.statusPaused')}
      </Badge>
    );
  }

  const days = daysUntilRenewal(sub.nextRenewalDate, new Date());

  if (days < 0) {
    return (
      <Badge className="bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400">
        {t('subs.renewalOverdue')}
      </Badge>
    );
  }
  if (days === 0) {
    return (
      <Badge className="bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400">
        {t('subs.renewalToday')}
      </Badge>
    );
  }
  if (days <= 7) {
    return (
      <Badge className="bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400">
        {days}d
      </Badge>
    );
  }
  if (sub.status === "trial") {
    return (
      <Badge variant="secondary">
        {t('subs.statusTrial')} · {days}d
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      {days}d
    </Badge>
  );
}

/** ─── Service avatar fallback ──────────────────────────────────────── */
function ServiceAvatar({ sub }: { sub: Subscription }) {
  const color = categoryColor(sub.category);
  const initials = sub.serviceName
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div
      className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-sm font-semibold text-gray-700 dark:text-gray-200"
      style={{ background: color + "55" }}
      aria-hidden="true"
    >
      {initials || "?"}
    </div>
  );
}

/** ─── Subscription card ─────────────────────────────────────────────── */
function SubscriptionCard({
  sub,
  onClick,
}: {
  sub: Subscription;
  onClick: () => void;
}) {
  const isCanceledOrPaused = sub.status === "canceled" || sub.status === "paused";

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group w-full flex items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3",
        "hover:border-primary/40 hover:bg-accent/30 active:scale-[0.98]",
        "transition-all duration-150 cursor-pointer outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring/60",
        isCanceledOrPaused && "opacity-60"
      )}
      aria-label={`${sub.serviceName} — ${sub.amount} ${sub.currency}`}
    >
      <ServiceAvatar sub={sub} />

      <div className="flex-1 min-w-0 text-left">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-medium text-sm text-foreground truncate">
            {sub.serviceName}
          </span>
          <span className="text-sm font-semibold text-foreground tabular-nums flex-shrink-0">
            {sub.currency} {sub.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
        <div className="flex items-center justify-between gap-1 mt-0.5">
          <span className="text-xs text-muted-foreground truncate">
            {sub.category || sub.billingCycle}
          </span>
          <RenewalBadge sub={sub} />
        </div>
      </div>
    </button>
  );
}

/** ─── Empty state ──────────────────────────────────────────────────── */
function EmptyState({
  filtered,
  onAdd,
}: {
  filtered: boolean;
  onAdd: () => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-col items-center justify-center gap-6 py-20 text-center">
      <div className="relative">
        <div className="absolute inset-0 rounded-full bg-primary/10 blur-2xl scale-150 opacity-60" />
        <OrbitLogo size={72} className="relative drop-shadow-sm" />
      </div>
      {filtered ? (
        <>
          <div className="space-y-1">
            <p className="text-base font-medium text-foreground">{t('subs.emptyNoMatchTitle')}</p>
            <p className="text-sm text-muted-foreground">{t('subs.emptyNoMatchBody')}</p>
          </div>
        </>
      ) : (
        <>
          <div className="space-y-1">
            <p className="font-heading text-xl text-foreground">{t('subs.emptyTitle')}</p>
            <p className="text-sm text-muted-foreground max-w-xs">
              {t('subs.emptyBody')}
            </p>
          </div>
          <Button onClick={onAdd} className="gap-1.5">
            <PlusIcon className="size-4" />
            {t('subs.emptyAddBtn')}
          </Button>
        </>
      )}
    </div>
  );
}

/** ─── SubscriptionList ───────────────────────────────────────────────── */
export function SubscriptionList({
  subscriptions,
  onAdd,
  onView,
}: SubscriptionListProps) {
  const t = useT();
  const [search, setSearch] = React.useState("");
  const [filterStatus, setFilterStatus] = React.useState("");
  const [filterCategory, setFilterCategory] = React.useState("");
  const [filterCurrency, setFilterCurrency] = React.useState("");
  const [sort, setSort] = React.useState<SortKey>("renewal");
  const [showFilters, setShowFilters] = React.useState(false);

  // Derived values for filter options
  const allCategories = React.useMemo(
    () => [...new Set(subscriptions.map((s) => s.category).filter(Boolean))].sort(),
    [subscriptions]
  );
  const allCurrencies = React.useMemo(
    () => [...new Set(subscriptions.map((s) => s.currency))].sort(),
    [subscriptions]
  );

  // Filter + sort
  const filtered = React.useMemo(() => {
    let list = subscriptions;

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((s) => s.serviceName.toLowerCase().includes(q));
    }
    if (filterStatus) {
      list = list.filter((s) => s.status === filterStatus);
    }
    if (filterCategory) {
      list = list.filter((s) => s.category === filterCategory);
    }
    if (filterCurrency) {
      list = list.filter((s) => s.currency === filterCurrency);
    }

    const now = new Date();
    if (sort === "renewal") {
      list = [...list].sort((a, b) => {
        const da = daysUntilRenewal(a.nextRenewalDate, now);
        const db = daysUntilRenewal(b.nextRenewalDate, now);
        return da - db;
      });
    } else if (sort === "amount") {
      list = [...list].sort((a, b) => b.amount - a.amount);
    } else {
      list = [...list].sort((a, b) =>
        a.serviceName.localeCompare(b.serviceName)
      );
    }

    return list;
  }, [subscriptions, search, filterStatus, filterCategory, filterCurrency, sort]);

  const isFiltered =
    !!search.trim() || !!filterStatus || !!filterCategory || !!filterCurrency;

  const selectCls =
    "h-8 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50";

  return (
    <div className="flex flex-col gap-4">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-heading text-2xl md:text-3xl text-foreground leading-tight">
          {t('subs.title')}
        </h1>
        <Button onClick={onAdd} size="sm" className="gap-1.5 hidden md:inline-flex">
          <PlusIcon className="size-4" />
          {t('subs.add')}
        </Button>
      </div>

      {/* ── Search + filter row ─────────────────────────────── */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <Input
            type="search"
            placeholder={t('subs.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9"
            aria-label={t('subs.searchLabel')}
          />
        </div>
        <Button
          variant={showFilters || isFiltered ? "secondary" : "outline"}
          size="icon"
          onClick={() => setShowFilters((p) => !p)}
          aria-label={t('subs.filterLabel')}
          className="h-9 w-9 flex-shrink-0"
        >
          <SlidersHorizontalIcon className="size-4" />
        </Button>
      </div>

      {/* ── Filter panel ────────────────────────────────────── */}
      {showFilters && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 rounded-xl bg-muted/50 border border-border">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">{t('subs.filterStatus')}</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className={selectCls}
              aria-label={t('subs.filterStatus')}
            >
              <option value="">{t('subs.filterAll')}</option>
              <option value="active">{t('subs.statusActive')}</option>
              <option value="trial">{t('subs.statusTrial')}</option>
              <option value="paused">{t('subs.statusPaused')}</option>
              <option value="canceled">{t('subs.statusCanceled')}</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">{t('subs.filterCategory')}</label>
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className={selectCls}
              aria-label={t('subs.filterCategory')}
            >
              <option value="">{t('subs.filterAll')}</option>
              {allCategories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">{t('subs.filterCurrency')}</label>
            <select
              value={filterCurrency}
              onChange={(e) => setFilterCurrency(e.target.value)}
              className={selectCls}
              aria-label={t('subs.filterCurrency')}
            >
              <option value="">{t('subs.filterAll')}</option>
              {allCurrencies.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">{t('subs.filterSortBy')}</label>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className={selectCls}
              aria-label={t('subs.filterSortBy')}
            >
              <option value="renewal">{t('subs.sortRenewal')}</option>
              <option value="amount">{t('subs.sortAmount')}</option>
              <option value="alpha">{t('subs.sortAlpha')}</option>
            </select>
          </div>
        </div>
      )}

      {/* ── List ─────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <EmptyState filtered={isFiltered} onAdd={onAdd} />
      ) : (
        <div className="flex flex-col gap-2" role="list" aria-label={t('subs.ariaList')}>
          {filtered.map((sub) => (
            <div key={sub.id} role="listitem">
              <SubscriptionCard sub={sub} onClick={() => onView(sub)} />
            </div>
          ))}
        </div>
      )}

      {/* ── Mobile FAB ──────────────────────────────────────── */}
      <button
        type="button"
        onClick={onAdd}
        aria-label={t('subs.mobileAddLabel')}
        className={cn(
          "fixed bottom-20 right-4 md:hidden z-20",
          "size-14 rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30",
          "flex items-center justify-center",
          "transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        )}
      >
        <PlusIcon className="size-6" />
      </button>
    </div>
  );
}
