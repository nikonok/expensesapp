/* @vitest-environment jsdom */
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) => {
      if (k === "settings.accountDeletion.countdown_one")
        return `Account will be deleted in ${opts?.count} day`;
      if (k === "settings.accountDeletion.countdown_other")
        return `Account will be deleted in ${opts?.count} days`;
      // i18next pluralisation: vitest env has no i18n runtime, mock key lookup manually
      if (k.startsWith("settings.accountDeletion.countdown"))
        return `Account will be deleted in ${opts?.count} days`;
      return k;
    },
  }),
}));

const mockShow = vi.fn();
vi.mock("@/components/shared/Toast", () => ({
  useToast: () => ({ show: mockShow }),
}));

vi.mock("@/components/shared/ConfirmDialog", () => ({
  ConfirmDialog: ({
    isOpen,
    onConfirm,
    onCancel,
    confirmLabel,
  }: {
    isOpen: boolean;
    onConfirm: () => void;
    onCancel: () => void;
    confirmLabel: string;
  }) =>
    isOpen ? (
      <div>
        <button onClick={onConfirm}>{confirmLabel}</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    ) : null,
}));

const mockRequestDeletion = vi.fn();
const mockCancelDeletion = vi.fn();

vi.mock("@/services/account/delete-client", () => ({
  requestDeletion: (...args: unknown[]) => mockRequestDeletion(...args),
  cancelDeletion: (...args: unknown[]) => mockCancelDeletion(...args),
}));

// Default: user has no pending deletion
const mockUser = vi.fn(() => null as { deleteAfter?: string | null } | null);

vi.mock("@/services/auth/session", () => ({
  useAuthStore: (sel?: (s: { user: { deleteAfter?: string | null } | null }) => unknown) => {
    const state = { user: mockUser() };
    return typeof sel === "function" ? sel(state) : state;
  },
}));

import { AccountDeletion } from "./AccountDeletion";

describe("AccountDeletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser.mockReturnValue(null);
  });

  it("renders the delete account button by default", () => {
    render(<AccountDeletion />);
    expect(screen.getByRole("button", { name: "settings.accountDeletion.label" })).toBeTruthy();
  });

  it("opens confirm dialog with checkbox on button click", () => {
    render(<AccountDeletion />);
    fireEvent.click(screen.getByRole("button", { name: "settings.accountDeletion.label" }));
    expect(screen.getByRole("checkbox")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "settings.accountDeletion.confirmAction" }),
    ).toBeTruthy();
  });

  it("confirm button is disabled until checkbox is checked", () => {
    render(<AccountDeletion />);
    fireEvent.click(screen.getByRole("button", { name: "settings.accountDeletion.label" }));

    const confirmBtn = screen.getByRole("button", {
      name: "settings.accountDeletion.confirmAction",
    });
    expect((confirmBtn as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("checkbox"));
    expect((confirmBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it("calls requestDeletion and shows countdown after confirm", async () => {
    const deleteAfter = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    mockRequestDeletion.mockResolvedValueOnce({ deleteAfter });

    render(<AccountDeletion />);
    fireEvent.click(screen.getByRole("button", { name: "settings.accountDeletion.label" }));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "settings.accountDeletion.confirmAction" }));

    await waitFor(() => {
      expect(mockRequestDeletion).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(screen.getByText(/Account will be deleted in/)).toBeTruthy();
    });
  });

  it("shows cancel deletion button in countdown state and calls cancelDeletion", async () => {
    const deleteAfter = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    mockRequestDeletion.mockResolvedValueOnce({ deleteAfter });
    mockCancelDeletion.mockResolvedValueOnce(undefined);

    render(<AccountDeletion />);
    fireEvent.click(screen.getByRole("button", { name: "settings.accountDeletion.label" }));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "settings.accountDeletion.confirmAction" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "settings.accountDeletion.cancelDeletion" }),
      ).toBeTruthy();
    });

    fireEvent.click(
      screen.getByRole("button", { name: "settings.accountDeletion.cancelDeletion" }),
    );

    await waitFor(() => {
      expect(mockCancelDeletion).toHaveBeenCalledTimes(1);
    });

    // Back to delete button
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "settings.accountDeletion.label" })).toBeTruthy();
    });
  });

  it("seeds countdown state from user.deleteAfter on initial render", () => {
    const deleteAfter = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    mockUser.mockReturnValue({ deleteAfter });

    render(<AccountDeletion />);

    expect(screen.getByText(/Account will be deleted in/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "settings.accountDeletion.label" })).toBeNull();
  });

  it("shows error toast when requestDeletion fails", async () => {
    mockRequestDeletion.mockRejectedValueOnce(new Error("Network error"));

    render(<AccountDeletion />);
    fireEvent.click(screen.getByRole("button", { name: "settings.accountDeletion.label" }));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "settings.accountDeletion.confirmAction" }));

    await waitFor(() => {
      expect(mockShow).toHaveBeenCalledWith("errors.generic", "error");
    });
  });
});
