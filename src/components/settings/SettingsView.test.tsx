/* @vitest-environment jsdom */
import { render, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter } from "react-router";

// Mock all heavy dependencies pulled in by SettingsView and its sub-components
vi.mock("../../db/database", () => ({ db: {} }));
vi.mock("../../hooks/use-accounts", () => ({ useAccounts: () => [] }));
vi.mock("../../hooks/use-transactions", () => ({
  useTransactions: () => [],
  useAllTransactions: () => [],
}));
vi.mock("../../services/backup.service", () => ({
  exportBackup: vi.fn(),
  importBackup: vi.fn(),
  createBackup: vi.fn(),
}));
vi.mock("../../services/export.service", () => ({ exportToXlsx: vi.fn() }));
vi.mock("../../services/exchange-rate.service", () => ({
  exchangeRateService: { fetchRate: vi.fn() },
}));
vi.mock("../shared/Toast", () => ({
  useToast: () => ({ show: vi.fn() }),
}));
vi.mock("../shared/ConfirmDialog", () => ({ ConfirmDialog: () => null }));
vi.mock("../shared/IconPicker", () => ({ getLucideIcon: () => null }));
vi.mock("../shared/ColorPicker", () => ({ ColorPicker: () => null }));
vi.mock("../shared/CurrencyPicker", () => ({ CurrencyPicker: () => null }));
vi.mock("../shared/PeriodFilter", () => ({ default: () => null }));
vi.mock("../shared/ComingSoonStub", () => ({
  ComingSoonStub: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../layout/BottomSheet", () => ({ default: () => null }));
vi.mock("../../hooks/use-install-prompt", () => ({
  useInstallPrompt: () => ({ canInstall: false, install: vi.fn() }),
}));
vi.mock("../../sw-register", () => ({
  getCanInstall: () => false,
  onCanInstallChange: () => () => {},
  triggerInstall: vi.fn(),
  dismissInstall: vi.fn(),
}));

// Sub-component mocks to avoid rendering their full trees
vi.mock("./LanguageSetting", () => ({ LanguageSetting: () => null }));
vi.mock("./ThemeSetting", () => ({ ThemeSetting: () => null }));
vi.mock("./StartupScreenSetting", () => ({ StartupScreenSetting: () => null }));
vi.mock("./NotificationSetting", () => ({ NotificationSetting: () => null }));
vi.mock("./MainCurrencySetting", () => ({ MainCurrencySetting: () => null }));
vi.mock("./BackupSettings", () => ({ BackupSettings: () => null }));
vi.mock("./ExportSettings", () => ({ ExportSettings: () => null }));
vi.mock("./InstallSetting", () => ({ InstallSetting: () => null }));

vi.spyOn(window.history, "pushState").mockImplementation(() => {});
vi.spyOn(window.history, "replaceState").mockImplementation(() => {});

// Mock navigate
const mockNavigate = vi.fn();
vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return { ...actual, useNavigate: () => mockNavigate };
});

// Mock settings store
vi.mock("../../stores/settings-store", () => ({
  useSettingsStore: (sel: (s: { startupScreen: string }) => unknown) =>
    sel({ startupScreen: "transactions" }),
  settingsStore: { getState: () => ({ startupScreen: "transactions" }) },
}));

import React from "react";
import { SettingsView } from "./SettingsView";

describe("SettingsView — back button navigation", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls navigate(-1) when history has a real back entry (idx > 0)", () => {
    Object.defineProperty(window.history, "state", {
      get: () => ({ idx: 2 }),
      configurable: true,
    });

    const { getByLabelText } = render(
      <MemoryRouter>
        <SettingsView />
      </MemoryRouter>,
    );

    const backBtn = getByLabelText(/go back/i);
    fireEvent.click(backBtn);

    expect(mockNavigate).toHaveBeenCalledWith(-1);
  });

  it("navigates to startup screen when at the bottom of the history stack (idx = 0)", () => {
    Object.defineProperty(window.history, "state", {
      get: () => ({ idx: 0 }),
      configurable: true,
    });

    const { getByLabelText } = render(
      <MemoryRouter>
        <SettingsView />
      </MemoryRouter>,
    );

    const backBtn = getByLabelText(/go back/i);
    fireEvent.click(backBtn);

    expect(mockNavigate).toHaveBeenCalledWith("/transactions", { replace: true });
  });

  it("navigates to startup screen when history state is null (PWA shallow stack)", () => {
    Object.defineProperty(window.history, "state", {
      get: () => null,
      configurable: true,
    });

    const { getByLabelText } = render(
      <MemoryRouter>
        <SettingsView />
      </MemoryRouter>,
    );

    const backBtn = getByLabelText(/go back/i);
    fireEvent.click(backBtn);

    expect(mockNavigate).toHaveBeenCalledWith("/transactions", { replace: true });
  });
});
