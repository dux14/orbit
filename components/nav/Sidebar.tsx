"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { OrbitLogo } from "@/components/orbit/OrbitLogo";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { NAV_ITEMS } from "./nav-items";
import { useT } from "@/lib/i18n/use-t";
import type { DictKey } from "@/lib/i18n/dict";

/**
 * Sidebar — fixed left navigation for desktop (>= md).
 * Hidden on < md via Tailwind.
 * Contains: Orbit logo + name, nav links, bottom ThemeToggle.
 */
export function Sidebar() {
  const pathname = usePathname();
  const t = useT();

  return (
    <aside
      className="hidden md:flex flex-col w-56 shrink-0 fixed inset-y-0 left-0 z-30 border-r border-border bg-sidebar"
      aria-label="Sidebar navigation"
    >
      {/* Logo / brand */}
      <div className="flex items-center gap-2.5 px-4 h-14 border-b border-sidebar-border">
        <OrbitLogo size={28} aria-hidden="true" />
        <span className="font-heading text-lg leading-none tracking-tight text-sidebar-foreground select-none">
          Orbit
        </span>
      </div>

      {/* Nav links */}
      <nav aria-label="Main navigation" className="flex-1 overflow-y-auto px-2 py-3">
        <ul role="list" className="flex flex-col gap-0.5">
          {NAV_ITEMS.map(({ href, labelKey, icon: Icon }) => {
            const isActive =
              pathname === href || pathname.startsWith(href + "/");

            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    // layout
                    "flex items-center gap-3 px-3 py-2 rounded-lg",
                    // typography
                    "text-sm font-medium",
                    // transitions
                    "transition-colors duration-150",
                    // focus ring
                    "outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                    // default
                    "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    // active
                    isActive &&
                      "bg-sidebar-accent text-sidebar-accent-foreground font-semibold"
                  )}
                >
                  <Icon
                    aria-hidden="true"
                    className={cn(
                      "size-4 shrink-0 transition-colors",
                      isActive
                        ? "text-sidebar-primary"
                        : "text-sidebar-foreground/50"
                    )}
                  />
                  {t(labelKey as DictKey)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Bottom controls */}
      <div className="px-3 py-3 border-t border-sidebar-border">
        <ThemeToggle />
      </div>
    </aside>
  );
}
