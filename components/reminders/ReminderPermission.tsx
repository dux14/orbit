"use client";

import * as React from "react";
import { BellIcon, BellOffIcon } from "lucide-react";
import { requestPermission, isNotificationSupported } from "@/lib/services/reminders";

type PermState = NotificationPermission | "unknown";

export function ReminderPermission() {
  const [perm, setPerm] = React.useState<PermState>("unknown");

  // Read current permission on mount (client only)
  React.useEffect(() => {
    if (!isNotificationSupported()) {
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
        Notifications blocked — enable them in your browser settings.
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
      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      aria-label="Enable renewal reminders"
    >
      <BellIcon className="size-3.5 flex-shrink-0" aria-hidden="true" />
      Enable renewal reminders
    </button>
  );
}
