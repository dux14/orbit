// lib/linking/link-controller.ts
import { isSyncEnabled } from '@/lib/sync/sync-controller';
import { SyncRepository } from '@/lib/sync/sync-repository';
import { LinkService } from './link-service';

/** Crea el LinkService cableado a Supabase, o null si sync off / sin sesión. */
export async function createLinkService(): Promise<LinkService | null> {
  if (!isSyncEnabled()) return null;
  const { createClient } = await import('@/lib/supabase/client');
  const client = createClient();
  const { data } = await client.auth.getSession();
  const userId = data.session?.user?.id;
  if (!userId) return null;
  const repo = new SyncRepository(client, userId);
  return new LinkService(repo);
}
