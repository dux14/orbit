"use client";

import * as React from "react";
import type { Subscription, Credential, PaymentMethod } from "@/lib/types";
import { daysUntilRenewal } from "@/lib/domain/renewals";
import { copyWithAutoClear } from "@/lib/services/clipboard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  CopyIcon,
  CheckIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { categoryColor } from "@/lib/constants/category-colors";
import { useT } from "@/lib/i18n/use-t";

/** ─── Types ──────────────────────────────────────────────────────────── */
export interface SubscriptionDetailProps {
  subscription: Subscription;
  credentials: Credential[];
  paymentMethods: PaymentMethod[];
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}

/** ─── Copy button with confirmation ─────────────────────────────────── */
function CopyButton({
  value,
  label,
  isSecret,
}: {
  value: string;
  label: string;
  isSecret?: boolean;
}) {
  const t = useT();
  const [copied, setCopied] = React.useState(false);
  const [showHint, setShowHint] = React.useState(false);

  async function handleCopy() {
    if (isSecret) {
      await copyWithAutoClear(value);
      setShowHint(true);
      setTimeout(() => setShowHint(false), 22000);
    } else {
      await navigator.clipboard.writeText(value);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex items-center gap-1.5">
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={handleCopy}
        aria-label={t('detail.copyLabel', { label })}
        title={t('detail.copyLabel', { label })}
        className="text-muted-foreground hover:text-foreground"
      >
        {copied ? (
          <CheckIcon className="size-3.5 text-green-500" />
        ) : (
          <CopyIcon className="size-3.5" />
        )}
      </Button>
      {showHint && (
        <span
          className="text-[10px] text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          {t('detail.clearsIn')}
        </span>
      )}
    </div>
  );
}

/** ─── Field row ─────────────────────────────────────────────────────── */
function DetailRow({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </span>
      <div className="text-sm text-foreground">{children}</div>
    </div>
  );
}

/** ─── Status badge color ─────────────────────────────────────────────── */
function StatusBadge({ status }: { status: Subscription["status"] }) {
  const t = useT();
  if (status === "active") return <Badge className="bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400">{t('subs.statusActive')}</Badge>;
  if (status === "trial") return <Badge variant="secondary">{t('subs.statusTrial')}</Badge>;
  if (status === "paused") return <Badge variant="outline">{t('subs.statusPaused')}</Badge>;
  return <Badge className="bg-red-100 text-red-600 border-red-200 dark:bg-red-900/20 dark:text-red-400">{t('subs.statusCanceled')}</Badge>;
}

/** ─── SubscriptionDetail ─────────────────────────────────────────────── */
export function SubscriptionDetail({
  subscription: sub,
  credentials,
  paymentMethods,
  onEdit,
  onDelete,
}: SubscriptionDetailProps) {
  const t = useT();
  const [showPassword, setShowPassword] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const credential = credentials.find((c) => c.id === sub.credentialId);
  const paymentMethod = paymentMethods.find((pm) => pm.id === sub.paymentMethodId);
  const days = daysUntilRenewal(sub.nextRenewalDate, new Date());

  const renewalLabel =
    sub.status === "canceled"
      ? t('detail.renewalCanceled')
      : sub.status === "paused"
      ? t('detail.renewalPaused')
      : days < 0
      ? t('detail.renewalOverdue')
      : days === 0
      ? t('detail.renewalToday')
      : t(days !== 1 ? 'detail.renewsInPlural' : 'detail.renewsIn', { n: days });

  // Category initial avatar
  const initials = sub.serviceName
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="flex flex-col gap-5 pb-4">
      {/* ── Hero header ─────────────────────────────────── */}
      <div className="flex items-start gap-3 pt-1">
        <div
          className="w-12 h-12 rounded-2xl flex items-center justify-center text-lg font-semibold text-gray-700 dark:text-gray-200 flex-shrink-0"
          style={{
            background: sub.category
              ? categoryColor(sub.category) + "55"
              : "oklch(0.90 0.045 268 / 0.3)",
          }}
          aria-hidden="true"
        >
          {initials || "?"}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="font-heading text-lg leading-tight text-foreground truncate">
              {sub.serviceName}
            </h2>
            <StatusBadge status={sub.status} />
          </div>
          {sub.category && (
            <p className="text-xs text-muted-foreground mt-0.5">{sub.category}</p>
          )}
        </div>
        <div className="flex gap-1 flex-shrink-0">
          <Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label={t('detail.editLabel')}>
            <PencilIcon className="size-4" />
          </Button>
          {!confirmDelete ? (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setConfirmDelete(true)}
              aria-label={t('detail.deleteLabel')}
              className="text-destructive hover:text-destructive"
            >
              <Trash2Icon className="size-4" />
            </Button>
          ) : (
            <div className="flex items-center gap-1">
              <span className="text-xs text-destructive font-medium">{t('detail.deleteConfirmLabel')}</span>
              <Button
                variant="destructive"
                size="xs"
                onClick={onDelete}
              >
                {t('detail.deleteConfirmYes')}
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setConfirmDelete(false)}
              >
                {t('detail.deleteConfirmNo')}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* ── Amount + billing ───────────────────────────────── */}
      <div className="flex items-end gap-1 -my-1">
        <span className="font-heading text-3xl font-semibold text-foreground tabular-nums">
          {sub.currency}&nbsp;{sub.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
        </span>
        <span className="text-sm text-muted-foreground mb-1">
          /{sub.billingCycle === "custom" ? `${sub.customCycleDays}d` : sub.billingCycle}
        </span>
      </div>

      {/* ── Renewal info ────────────────────────────────────── */}
      <div className="rounded-xl bg-muted/50 border border-border px-3.5 py-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
            {t('detail.nextRenewal')}
          </p>
          <p className="text-sm font-semibold text-foreground mt-0.5">
            {sub.nextRenewalDate}
          </p>
        </div>
        <Badge
          className={cn(
            days < 0
              ? "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400"
              : days <= 7
              ? "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400"
              : "bg-secondary text-secondary-foreground"
          )}
        >
          {renewalLabel}
        </Badge>
      </div>

      {/* ── Details grid ────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        {sub.plan && (
          <DetailRow label={t('detail.plan')}>{sub.plan}</DetailRow>
        )}
        {sub.accountEmail && (
          <DetailRow label={t('detail.accountEmail')}>
            <div className="flex items-center gap-1 min-w-0">
              <span className="truncate">{sub.accountEmail}</span>
              <CopyButton value={sub.accountEmail} label={t('detail.accountEmail')} />
            </div>
          </DetailRow>
        )}
        {paymentMethod && (
          <DetailRow label={t('detail.paymentMethod')}>
            <span className="truncate">
              {paymentMethod.label} ····{paymentMethod.last4}
            </span>
          </DetailRow>
        )}
        {sub.url && (
          <DetailRow label={t('detail.website')}>
            <a
              href={sub.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-primary hover:underline underline-offset-2 truncate"
            >
              {t('detail.openSite')}
              <ExternalLinkIcon className="size-3.5 flex-shrink-0" />
            </a>
          </DetailRow>
        )}
      </div>

      {/* ── Notes ────────────────────────────────────────────── */}
      {sub.notes && (
        <DetailRow label={t('detail.notes')}>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{sub.notes}</p>
        </DetailRow>
      )}

      {/* ── Credentials section ───────────────────────────────── */}
      {credential && (
        <div className="rounded-xl border border-dashed border-border p-3.5 flex flex-col gap-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {t('detail.credentials')}
          </p>

          {/* Username */}
          <DetailRow label={t('detail.username')}>
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="truncate flex-1">{credential.username}</span>
              <CopyButton value={credential.username} label={t('detail.username')} />
            </div>
          </DetailRow>

          {/* Password (hidden by default) */}
          <DetailRow label={t('detail.password')}>
            <div className="flex items-center gap-1.5 min-w-0">
              <code
                className="flex-1 text-sm font-mono tracking-wider min-w-0 truncate select-all"
                aria-label={showPassword ? "Password visible" : "Password hidden"}
              >
                {showPassword ? credential.password : "••••••••"}
              </code>
              <div className="flex items-center gap-1 flex-shrink-0">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Reveal password"}
                  title={showPassword ? "Hide password" : "Reveal password"}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? (
                    <EyeOffIcon className="size-3.5" />
                  ) : (
                    <EyeIcon className="size-3.5" />
                  )}
                </Button>
                <CopyButton value={credential.password} label={t('detail.password')} isSecret />
              </div>
            </div>
          </DetailRow>
        </div>
      )}

      {/* ── Metadata ─────────────────────────────────────────── */}
      <div className="text-[11px] text-muted-foreground space-y-0.5 border-t border-border pt-3">
        <p>{t('detail.created')} {new Date(sub.createdAt).toLocaleDateString()}</p>
        <p>{t('detail.updated')} {new Date(sub.updatedAt).toLocaleDateString()}</p>
      </div>
    </div>
  );
}
