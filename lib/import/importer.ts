import type { Subscription } from '@/lib/types';

export interface Importer {
  readonly id: string;
  readonly label: string;
  parse(input: string): Promise<Partial<Subscription>[]>;
}

/** Phase 3 stub — intentionally not wired into the UI. */
export const csvImporter: Importer = {
  id: 'csv',
  label: 'CSV',
  async parse(): Promise<Partial<Subscription>[]> {
    throw new Error('CSV import is not available in Phase 1');
  },
};
