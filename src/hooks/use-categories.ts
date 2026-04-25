import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/database";
import type { Category, CategoryType } from "../db/models";

export function useCategories(type?: CategoryType, includeTrashed = false): Category[] {
  return (
    useLiveQuery(async () => {
      const query = type ? db.categories.where("type").equals(type) : db.categories.toCollection();
      const results = await query.sortBy("displayOrder");
      return includeTrashed ? results : results.filter((c) => !c.isTrashed);
    }, [type, includeTrashed]) ?? []
  );
}

export function useCategory(id: number): Category | undefined {
  return useLiveQuery(() => db.categories.get(id), [id]);
}
