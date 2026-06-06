import { OrbitLogo } from "@/components/orbit/OrbitLogo";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { Sidebar } from "./Sidebar";
import { BottomTabNav } from "./BottomTabNav";

interface AppShellProps {
  children: React.ReactNode;
}

/**
 * AppShell — wraps all (vault) routes.
 *
 * Layout:
 *  - Desktop (>= md): fixed left Sidebar (w-56) + scrollable main content area
 *  - Mobile (< md):   fixed top header + fixed BottomTabNav; main compensates
 *                     with pt/pb = bar height + safe-area inset (see globals.css)
 *
 * AppShell is a Server Component; Sidebar and BottomTabNav are "use client"
 * because they need usePathname().
 */
export function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-dvh flex">
      {/* Skip to main content — keyboard / screen-reader convenience */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-lg focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:ring-2 focus:ring-ring focus:outline-none"
      >
        Skip to main content
      </a>

      {/* Desktop sidebar — hidden on mobile */}
      <Sidebar />

      {/* Main content — offset left on desktop for sidebar, pad bottom on mobile for tab bar */}
      <main
        id="main-content"
        tabIndex={-1}
        aria-label="Main content"
        className="flex-1 min-w-0 md:ml-56 flex flex-col min-h-dvh pt-[var(--app-header-total)] md:pt-0 pb-[var(--app-tabbar-total)] md:pb-0 outline-none"
      >
        {/* Mobile header — visible only on < md */}
        <header className="fixed md:hidden inset-x-0 top-0 z-30 flex items-center justify-between px-4 h-[var(--app-header-total)] pt-[var(--safe-top)] border-b border-border bg-background/95 backdrop-blur-sm supports-[backdrop-filter]:bg-background/80">
          <div className="flex items-center gap-2">
            <OrbitLogo size={26} aria-hidden="true" />
            <span className="font-heading text-lg leading-none tracking-tight">
              Orbit
            </span>
          </div>
          <ThemeToggle />
        </header>

        {/* Page content */}
        <div className="flex-1 p-4 md:p-6 lg:p-8">{children}</div>
      </main>

      {/* Mobile bottom tabs — hidden on desktop */}
      <BottomTabNav />
    </div>
  );
}
