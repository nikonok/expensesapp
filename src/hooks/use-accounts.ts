import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import type { Account } from '../db/models';

export function useAccounts(includeTrashed = false): Account[] {
  return (
    useLiveQuery(async () => {
      if (includeTrashed) {
        return db.accounts.toArray();
      }
      return db.accounts.filter((a) => !a.isTrashed).toArray();
    }, [includeTrashed]) ?? []
  );
}

export function useAccount(id: number): Account | undefined {
  return useLiveQuery(() => db.accounts.get(id), [id]);
}
