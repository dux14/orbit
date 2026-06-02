import { LayoutDashboard, ListChecks, CreditCard, Settings } from "lucide-react";
import type { DictKey } from "@/lib/i18n/dict";

export const NAV_ITEMS: {
  href: string;
  labelKey: DictKey;
  icon: React.ElementType;
}[] = [
  {
    href: "/dashboard",
    labelKey: "nav.dashboard",
    icon: LayoutDashboard,
  },
  {
    href: "/subscriptions",
    labelKey: "nav.subscriptions",
    icon: ListChecks,
  },
  {
    href: "/payment-methods",
    labelKey: "nav.cards",
    icon: CreditCard,
  },
  {
    href: "/settings",
    labelKey: "nav.settings",
    icon: Settings,
  },
] as const;
