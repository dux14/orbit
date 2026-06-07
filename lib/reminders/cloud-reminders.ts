'use client';

import { createClient } from '@/lib/supabase/client';
import { buildReminderIndex } from './reminder-window';
import type { Subscription } from '@/lib/types';

/** Push the minimal plaintext index to public.reminders. Idempotent: replace-all per user. */
export async function syncReminderIndex(subs: Subscription[], leadDays: number): Promise<void> {
  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error('not-signed-in');

  const index = buildReminderIndex(subs, leadDays);

  // Replace-all: delete the user's existing rows, then insert the fresh index.
  // Keeps the server index a faithful, minimal mirror without stale entries.
  const del = await supabase.from('reminders').delete().eq('user_id', userId);
  if (del.error) throw del.error;

  if (index.length > 0) {
    const rows = index.map((e) => ({ ...e, user_id: userId }));
    const ins = await supabase.from('reminders').insert(rows);
    if (ins.error) throw ins.error;
  }
}

/** OFF path: delete EVERY reminder row for the user. Verifiable server-side deletion. */
export async function clearReminderIndex(): Promise<void> {
  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return;
  const { error } = await supabase.from('reminders').delete().eq('user_id', userId);
  if (error) throw error;
}
