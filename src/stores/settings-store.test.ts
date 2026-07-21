// @vitest-environment node
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/database";
import { DEFAULTS, useSettingsStore } from "./settings-store";

beforeEach(async () => {
  await db.settings.clear();
  useSettingsStore.setState({ ...DEFAULTS, isLoaded: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useSettingsStore.load", () => {
  it("hydrates state from db.settings on success", async () => {
    await db.settings.put({ key: "mainCurrency", value: "EUR" });

    await useSettingsStore.getState().load();

    expect(useSettingsStore.getState().mainCurrency).toBe("EUR");
    expect(useSettingsStore.getState().isLoaded).toBe(true);
  });

  it("rethrows when the db read fails, leaving isLoaded false", async () => {
    const spy = vi
      .spyOn(db.settings, "toArray")
      .mockRejectedValueOnce(new Error("IndexedDB read failure"));

    await expect(useSettingsStore.getState().load()).rejects.toThrow("IndexedDB read failure");
    expect(useSettingsStore.getState().isLoaded).toBe(false);

    spy.mockRestore();
  });

  it("is a no-op if already loaded", async () => {
    useSettingsStore.setState({ isLoaded: true, mainCurrency: "PLN" });
    await useSettingsStore.getState().load();
    expect(useSettingsStore.getState().mainCurrency).toBe("PLN");
  });
});

describe("useSettingsStore.update", () => {
  it("persists a valid value for a key with a settingSchema", async () => {
    await useSettingsStore.getState().update("mainCurrency", "EUR");

    expect(useSettingsStore.getState().mainCurrency).toBe("EUR");
    const setting = await db.settings.get("mainCurrency");
    expect(setting?.value).toBe("EUR");
  });

  it("rejects an invalid value for a key with a settingSchema and does not persist", async () => {
    await useSettingsStore.getState().update("mainCurrency", "US");

    expect(useSettingsStore.getState().mainCurrency).toBe(DEFAULTS.mainCurrency);
    const setting = await db.settings.get("mainCurrency");
    expect(setting).toBeUndefined();
  });

  it("rejects a wrong-type value for a boolean setting", async () => {
    await useSettingsStore.getState().update("notificationEnabled", "true");

    expect(useSettingsStore.getState().notificationEnabled).toBe(DEFAULTS.notificationEnabled);
    const setting = await db.settings.get("notificationEnabled");
    expect(setting).toBeUndefined();
  });

  it("still persists a key with no settingSchema (unchanged behavior)", async () => {
    await useSettingsStore.getState().update("lastUsedAccountId", 42);

    expect(useSettingsStore.getState().lastUsedAccountId).toBe(42);
    const setting = await db.settings.get("lastUsedAccountId");
    expect(setting?.value).toBe(42);
  });

  it("ignores unknown setting keys", async () => {
    await useSettingsStore.getState().update("notARealKey", "value");
    const setting = await db.settings.get("notARealKey");
    expect(setting).toBeUndefined();
  });
});
