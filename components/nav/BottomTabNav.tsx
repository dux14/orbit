"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "./nav-items";
import { useT } from "@/lib/i18n/use-t";
import type { DictKey } from "@/lib/i18n/dict";

/**
 * BottomTabNav — fixed bottom navigation for mobile (< md).
 * Hidden on md+ via Tailwind. Shows icon + label per tab.
 * Marks the active route with aria-current="page" and visual highlight.
 */
export function BottomTabNav() {
  const pathname = usePathname();
  const t = useT();

  return (
    <nav
      aria-label="Main navigation"
      className="fixed bottom-0 left-0 right-0 z-40 flex md:hidden border-t border-border bg-background/95 backdrop-blur-sm supports-[backdrop-filter]:bg-background/80"
    >
      {NAV_ITEMS.map(({ href, labelKey, icon: Icon }) => {
        const isActive = pathname === href || pathname.startsWith(href + "/");

        return (
          <Link
            key={href}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              // layout
              "flex flex-1 flex-col items-center justify-center gap-1 py-2 min-h-[3.5rem]",
              // typography
              "text-[10px] font-medium leading-tight",
              // transitions
              "transition-colors duration-150",
              // focus ring — keyboard navigable
              "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset rounded-sm",
              // default state
              "text-muted-foreground",
              // active state
              isActive && "text-primary"
            )}
          >
            <span
              className={cn(
                "flex items-center justify-center size-8 rounded-xl transition-colors duration-150",
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground"
              )}
            >
              <Icon
                aria-hidden="true"
                className={cn("size-[1.125rem]", isActive && "stroke-[2.25]")}
              />
            </span>
            <span>{t(labelKey as DictKey)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
