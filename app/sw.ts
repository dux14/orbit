/// <reference lib="webworker" />

import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
  fallbacks: {
    entries: [
      {
        url: "/~offline",
        matcher({ request }) {
          return request.destination === "document";
        },
      },
    ],
  },
});

// ── Web Push (S10): opt-in cloud reminders ────────────────────────────────
// Payload shape (set by supabase/functions/send-reminders): { title, body, url }
// NEVER contains amounts, emails, card data, passwords or notes.
self.addEventListener("push", (event: PushEvent) => {
  const data = (() => {
    try {
      return event.data?.json() as { title?: string; body?: string; url?: string };
    } catch {
      return { body: event.data?.text() };
    }
  })();

  const title = data?.title ?? "Orbit";
  const options: NotificationOptions = {
    body: data?.body ?? "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: data?.url ?? "/subscriptions" },
    tag: "orbit-reminder",
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string })?.url ?? "/subscriptions";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if ("focus" in client) {
            (client as WindowClient).navigate(url);
            return (client as WindowClient).focus();
          }
        }
        return self.clients.openWindow(url);
      }),
  );
});

serwist.addEventListeners();
