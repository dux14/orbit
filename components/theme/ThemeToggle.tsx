"use client";

import { Moon, Sun, SunMoon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme, type Theme } from "./ThemeProvider";

const CYCLE: Theme[] = ["light", "dark", "system"];

const ICONS = {
  light: Sun,
  dark: Moon,
  system: SunMoon,
} as const;

const LABELS = {
  light: "Light theme",
  dark: "Dark theme",
  system: "System theme",
} as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  function cycle() {
    const next = CYCLE[(CYCLE.indexOf(theme) + 1) % CYCLE.length];
    setTheme(next);
  }

  const Icon = ICONS[theme];

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={cycle}
      aria-label={`Current theme: ${LABELS[theme]}. Click to cycle theme.`}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}
