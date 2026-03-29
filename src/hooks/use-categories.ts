import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import type { Category, CategoryType } from '../db/models';

export function useCategories(
  type?: CategoryType,
  includeTrashed = false,
): Category[] {
  return (
    useLiveQuery(async () => {
      let collection = db.categories.orderBy('displayOrder');

      const all = await collection.toArray();

      return all.filter((c) => {
        if (!includeTrashed && c.isTrashed) return false;
        if (type && c.type !== type) return false;
        return true;
      });
    }, [type, includeTrashed]) ?? []
  );
}

export function useCategory(id: number): Category | undefined {
  return useLiveQuery(() => db.categories.get(id), [id]);
}
