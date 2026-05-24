import { apiFetch } from "../auth/client";
import { db } from "@/db/database";
import { logger } from "@/services/log.service";

export async function sendLogsToSupport(): Promise<void> {
  // Flush in-memory buffer to the DB before reading
  await logger._flush();

  const logs = await db.logs.orderBy("timestamp").toArray();
  const lines = logs.map((l) => {
    const ctx = l.context ? " " + JSON.stringify(l.context) : "";
    return `[${l.timestamp}] ${l.level} ${l.message}${ctx}`;
  });

  await apiFetch<void>("/api/v1/logs/send", {
    method: "POST",
    body: JSON.stringify({ userConsent: true, logs: lines }),
  });
}
