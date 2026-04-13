import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/database';
import { checkDatabaseIntegrity } from './integrity.service';

describe('checkDatabaseIntegrity', () => {
  it('returns { ok: true } when all tables are empty but readable', async () => {
    const result = await checkDatabaseIntegrity();
    expect(result).toEqual({ ok: true });
  });

  it('returns { ok: true } when tables contain data', async () => {
    await db.accounts.add({
      name: 'Test Account',
      type: 'REGULAR',
      color: 'oklch(0.7 0.2 180)',
      icon: 'wallet',
      currency: 'USD',
      description: '',
      balance: 1000,
      startingBalance: 1000,
      includeInTotal: true,
      isTrashed: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const result = await checkDatabaseIntegrity();
    expect(result).toEqual({ ok: true });

    await db.accounts.clear();
  });

  it('returns { ok: false } with an error string when a table read throws', async () => {
    const fakeCollection = {
      toArray: () => Promise.reject(new Error('IndexedDB read failure')),
    };
    const spy = vi.spyOn(db.accounts, 'limit').mockReturnValue(fakeCollection as never);

    const result = await checkDatabaseIntegrity();

    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe('string');
    expect(result.error!.length).toBeGreaterThan(0);

    spy.mockRestore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
