import { db } from '@/db/database';
import { useSettingsStore } from '@/stores/settings-store';
import type { Log, LogLevel } from '@/db/models';

const buffer: Log[] = [];
let isFlushing = false;
let flushScheduled = false;

const MAX_BUFFER = 500;
const RETENTION_MS = 24 * 60 * 60 * 1000;

function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  queueMicrotask(async () => {
    flushScheduled = false;
    await _flush();
  });
}

async function _flush(): Promise<void> {
  if (isFlushing || buffer.length === 0) return;
  const batch = buffer.splice(0);
  isFlushing = true;
  try {
    await db.logs.bulkAdd(batch);
  } catch (err) {
    if (import.meta.env.DEV) console.error('[log-service] flush failed', err);
  } finally {
    isFlushing = false;
    if (buffer.length > 0) scheduleFlush();
  }
}

function serializeContext(
  ctx: Record<string, unknown> | Error | undefined,
): Record<string, unknown> | null {
  if (!ctx) return null;
  if (ctx instanceof Error) return { name: ctx.name, message: ctx.message, stack: ctx.stack };
  try {
    JSON.stringify(ctx); // test for circular refs
    return { ...ctx };
  } catch {
    return { error: 'context not serializable' };
  }
}

function log(level: LogLevel, message: string, context?: Record<string, unknown> | Error): void {
  const { logLevel } = useSettingsStore.getState();
  if (logLevel === 'errors' && level !== 'ERROR') return;
  const entry: Log = {
    timestamp: new Date().toISOString(),
    level,
    message,
    context: serializeContext(context),
  };
  if (buffer.length >= MAX_BUFFER) buffer.shift();
  buffer.push(entry);
  scheduleFlush();
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown> | Error) =>
    log('DEBUG', message, context),
  info: (message: string, context?: Record<string, unknown> | Error) =>
    log('INFO', message, context),
  warn: (message: string, context?: Record<string, unknown> | Error) =>
    log('WARN', message, context),
  error: (message: string, context?: Record<string, unknown> | Error) =>
    log('ERROR', message, context),

  async trimOldLogs(): Promise<number> {
    const cutoff = new Date(Date.now() - RETENTION_MS).toISOString();
    return db.logs.where('timestamp').below(cutoff).delete();
  },

  async exportLogs(): Promise<void> {
    await _flush();
    await this.trimOldLogs();
    const logs = await db.logs.orderBy('timestamp').toArray();
    const lines = logs.map(l => {
      const ctx = l.context ? ' ' + JSON.stringify(l.context) : '';
      return `[${l.timestamp}] ${l.level} ${l.message}${ctx}`;
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `expenses-logs-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  _flush,
};
