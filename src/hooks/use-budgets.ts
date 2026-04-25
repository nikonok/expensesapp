import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/database";
import type { Budget } from "../db/models";

export function useBudgets(month: string): Budget[] {
  return useLiveQuery(() => db.budgets.where("month").equals(month).toArray(), [month]) ?? [];
}
