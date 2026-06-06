"use client";

import * as React from "react";
import { BellIcon, BellOffIcon } from "lucide-react";
import { requestPermission, isNotificationSupported } from "@/lib/services/reminders";
import { useT } from "@/lib/i18n/use-t";

type PermState = NotificationPermission | "unknown";

export function ReminderPermission() {
  const t = useT();
  const [perm, setPerm] = React.useState<PermState>("unknown");

  // Read current permission on mount (client only). The mount-effect setState is
  // the standard SSR-safe pattern here: a lazy initializer would read
  // Notification.permission during hydration and mismatch the server render.
  React.useEffect(() => {
    if (!isNotificationSupported()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPerm("denied"); // unsupported — treat same as denied for UI purposes
      return;
    }
    setPerm(Notification.permission);
  }, []);

  // Don't render anything when unsupported or already decided
  if (perm === "unknown" || perm === "granted" || !isNotificationSupported()) return null;

  if (perm === "denied") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <BellOffIcon className="size-3.5 flex-shrink-0" aria-hidden="true" />
        {t('reminders.blocked')}
      </p>
    );
  }

  // perm === "default"
  async function handleEnable() {
    const result = await requestPermission();
    setPerm(result);
  }

  return (
    <button
      type="button"
      onClick={handleEnable}
      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={t('reminders.enable')}
    >
      <BellIcon className="size-3.5 flex-shrink-0" aria-hidden="true" />
      {t('reminders.enable')}
    </button>
  );
}
