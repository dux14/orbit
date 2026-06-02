import { LayoutDashboard, ListChecks, CreditCard, Settings } from "lucide-react";

export const NAV_ITEMS = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
  },
  {
    href: "/subscriptions",
    label: "Subscriptions",
    icon: ListChecks,
  },
  {
    href: "/payment-methods",
    label: "Cards",
    icon: CreditCard,
  },
  {
    href: "/settings",
    label: "Settings",
    icon: Settings,
  },
] as const;
