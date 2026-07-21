/* @vitest-environment jsdom */
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const { clearMock, transactionMock } = vi.hoisted(() => ({
  clearMock: vi.fn().mockResolvedValue(undefined),
  transactionMock: vi.fn(async (_mode: string, _tables: unknown[], fn: () => Promise<void>) => {
    await fn();
  }),
}));

vi.mock("@/db/database", () => ({
  db: {
    transaction: (...args: [string, unknown[], () => Promise<void>]) => transactionMock(...args),
    accounts: { clear: clearMock },
    categories: { clear: clearMock },
    transactions: { clear: clearMock },
    budgets: { clear: clearMock },
    settings: { clear: clearMock },
  },
}));

import { OnboardingCompletePopup } from "./OnboardingCompletePopup";
import { useUIStore } from "@/stores/ui-store";
import { DEFAULTS, useSettingsStore } from "@/stores/settings-store";

describe("OnboardingCompletePopup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUIStore.setState({ showOnboardingCompletePopup: true });
    useSettingsStore.setState({
      mainCurrency: "EUR",
      hasCompletedOnboarding: true,
      hapticFeedbackEnabled: true,
      pushSubscriptionId: "sub-123",
    });
  });

  it("renders nothing when show is false", () => {
    useUIStore.setState({ showOnboardingCompletePopup: false });
    const { container } = render(<OnboardingCompletePopup />);
    expect(container.innerHTML).toBe("");
  });

  it("resets every settings-store key back to DEFAULTS on cancel", async () => {
    render(<OnboardingCompletePopup />);

    fireEvent.click(screen.getByText("onboarding.complete.cancel"));

    await waitFor(() => {
      expect(useSettingsStore.getState().mainCurrency).toBe(DEFAULTS.mainCurrency);
    });
    expect(useSettingsStore.getState().hasCompletedOnboarding).toBe(
      DEFAULTS.hasCompletedOnboarding,
    );
    expect(useSettingsStore.getState().hapticFeedbackEnabled).toBe(DEFAULTS.hapticFeedbackEnabled);
    expect(useSettingsStore.getState().pushSubscriptionId).toBe(DEFAULTS.pushSubscriptionId);
  });

  it("clears the domain Dexie tables on cancel", async () => {
    render(<OnboardingCompletePopup />);

    fireEvent.click(screen.getByText("onboarding.complete.cancel"));

    await waitFor(() => {
      expect(clearMock).toHaveBeenCalled();
    });
  });

  it("closes the popup after cancel completes", async () => {
    render(<OnboardingCompletePopup />);

    fireEvent.click(screen.getByText("onboarding.complete.cancel"));

    await waitFor(() => {
      expect(useUIStore.getState().showOnboardingCompletePopup).toBe(false);
    });
  });
});
