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
 *  - Mobile (< md):   full-width main + fixed BottomTabNav (pb for safe spacing)
 *
 * AppShell is a Server Component; Sidebar and BottomTabNav are "use client"
 * because they need usePathname().
 */
export function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-dvh flex">
      {/* Desktop sidebar — hidden on mobile */}
      <Sidebar />

      {/* Main content — offset left on desktop for sidebar, pad bottom on mobile for tab bar */}
      <main
        id="main-content"
        tabIndex={-1}
        className="flex-1 md:ml-56 flex flex-col min-h-dvh pb-[3.75rem] md:pb-0 outline-none"
      >
        {/* Mobile header — visible only on < md */}
        <header className="flex md:hidden items-center justify-between px-4 h-14 border-b border-border bg-background/95 backdrop-blur-sm supports-[backdrop-filter]:bg-background/80 sticky top-0 z-20">
          <div className="flex items-center gap-2">
            <OrbitLogo size={26} />
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
