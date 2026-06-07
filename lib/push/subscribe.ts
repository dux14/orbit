'use client';

import { createClient } from '@/lib/supabase/client';

/** Decode a base64url VAPID public key to the Uint8Array PushManager expects. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export type PushSupport =
  | { supported: true }
  | { supported: false; reason: 'no-sw' | 'no-push' | 'no-permission-api' };

export function detectPushSupport(): PushSupport {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return { supported: false, reason: 'no-sw' };
  }
  if (!('PushManager' in window)) return { supported: false, reason: 'no-push' };
  if (!('Notification' in window)) return { supported: false, reason: 'no-permission-api' };
  return { supported: true };
}

/** Request permission, subscribe via PushManager, and persist the subscription in Supabase. */
export async function enablePush(): Promise<{ ok: true } | { ok: false; reason: string }> {
  const support = detectPushSupport();
  if (!support.supported) return { ok: false, reason: support.reason };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: 'permission-denied' };

  const reg = await navigator.serviceWorker.ready;
  const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapid) return { ok: false, reason: 'missing-vapid-key' };

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapid) as BufferSource,
  });

  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    await sub.unsubscribe();
    return { ok: false, reason: 'malformed-subscription' };
  }

  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) {
    await sub.unsubscribe();
    return { ok: false, reason: 'not-signed-in' };
  }

  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: userId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    },
    { onConflict: 'endpoint' },
  );
  if (error) {
    // Keep the rollback invariant: no server row -> no local subscription.
    await sub.unsubscribe();
    return { ok: false, reason: error.message };
  }
  return { ok: true };
}

/** Unsubscribe locally and delete this device's subscription server-side. */
export async function disablePush(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  const supabase = createClient();
  await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
}
