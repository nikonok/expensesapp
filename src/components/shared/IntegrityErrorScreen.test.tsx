/* @vitest-environment jsdom */
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockShow = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock("../../services/backup.service", () => ({
  listBackups: vi.fn(),
  restoreFromBackup: vi.fn(),
  importFromFile: vi.fn(),
}));

vi.mock("./Toast", () => ({
  useToast: () => ({ show: mockShow }),
}));

vi.mock("./ConfirmDialog", () => ({
  ConfirmDialog: ({ isOpen, onConfirm, onCancel, confirmLabel }: any) =>
    isOpen ? (
      <div>
        <button onClick={onConfirm}>{confirmLabel ?? "Confirm"}</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    ) : null,
}));

vi.mock("../../db/database", () => ({
  DB_NAME: "expenses-app-db",
}));

const deleteDbMock = vi.fn();
vi.mock("dexie", () => ({
  default: { delete: (...args: unknown[]) => deleteDbMock(...args) },
}));

import { IntegrityErrorScreen } from "./IntegrityErrorScreen";
import * as backupService from "../../services/backup.service";

const BTN_RESTORE = "settings.backup.restore";
const BTN_DELETE_DB = "errors.deleteDatabase";

describe("IntegrityErrorScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, reload: vi.fn() },
    });
  });

  it("does not show the last-resort delete-database action initially", () => {
    render(<IntegrityErrorScreen />);
    expect(screen.queryByRole("button", { name: BTN_DELETE_DB })).toBeNull();
  });

  it("shows the last-resort delete-database action after a restore-from-backup attempt fails", async () => {
    (backupService.listBackups as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 1 }]);
    (backupService.restoreFromBackup as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("boom"),
    );

    render(<IntegrityErrorScreen />);
    fireEvent.click(screen.getByRole("button", { name: BTN_RESTORE }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: BTN_DELETE_DB })).not.toBeNull();
    });
  });

  it("shows the last-resort delete-database action when no backup is found", async () => {
    (backupService.listBackups as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    render(<IntegrityErrorScreen />);
    fireEvent.click(screen.getByRole("button", { name: BTN_RESTORE }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: BTN_DELETE_DB })).not.toBeNull();
    });
  });

  it("deletes the database and reloads when the destructive action is confirmed", async () => {
    (backupService.listBackups as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    deleteDbMock.mockResolvedValue(undefined);

    render(<IntegrityErrorScreen />);
    fireEvent.click(screen.getByRole("button", { name: BTN_RESTORE }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: BTN_DELETE_DB })).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: BTN_DELETE_DB }));
    // Confirm within the (mocked) ConfirmDialog — the dialog's confirm button
    // shares the same label as the trigger button, so it's the last match.
    const matches = screen.getAllByRole("button", { name: BTN_DELETE_DB });
    fireEvent.click(matches[matches.length - 1]);

    await waitFor(() => {
      expect(deleteDbMock).toHaveBeenCalledWith("expenses-app-db");
      expect(window.location.reload).toHaveBeenCalledOnce();
    });
  });
});
