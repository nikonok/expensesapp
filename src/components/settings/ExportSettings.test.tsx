/* @vitest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────

// Hoist mock function so it is available inside the vi.mock() factory closure
const { mockExportTransactions } = vi.hoisted(() => ({
  mockExportTransactions: vi.fn(),
}));

vi.mock('@/services/export.service', () => ({
  exportService: { exportTransactions: mockExportTransactions },
}));

vi.mock('@/stores/settings-store', () => ({
  useSettingsStore: vi.fn((sel: (s: { mainCurrency: string }) => unknown) =>
    sel({ mainCurrency: 'USD' }),
  ),
}));

vi.mock(import('@/utils/date-utils'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getLocalDateString: vi.fn(() => '2026-04-12'),
    parsePeriodFilter: vi.fn(() => ({
      start: new Date('2026-04-01'),
      end: new Date('2026-04-30'),
    })),
  };
});

const mockShow = vi.fn();
vi.mock('@/components/shared/Toast', () => ({
  useToast: () => ({ show: mockShow }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'settings.export.label': 'Export data',
        'settings.export.complete': 'Export complete. Your file has been downloaded.',
        'settings.export.error': 'Export failed. Please check your storage and try again.',
        'settings.export.sheetTitle': 'Export to XLSX',
        'settings.export.cta': 'Export',
        'settings.export.exporting': 'Exporting…',
        'settings.export.inProgress': 'Export in progress, please wait…',
        'errors.generic': 'Something went wrong. Please try again.',
      };
      return translations[key] ?? key;
    },
  }),
}));

// PeriodFilter is a UI sub-component — stub it out to avoid full render
vi.mock('../shared/PeriodFilter', () => ({
  default: () => <div data-testid="period-filter" />,
}));

// ── Subject under test ─────────────────────────────────────────────────────

import { ExportSettings } from './ExportSettings';

// ── Helpers ────────────────────────────────────────────────────────────────

function renderComponent() {
  return render(<ExportSettings />);
}

/** Opens the export bottom sheet by clicking the row trigger button. */
async function openSheet() {
  const trigger = screen.getByRole('button', { name: /export data/i });
  await act(async () => {
    fireEvent.click(trigger);
  });
  // Wait for the sheet's portal + animation frames to render the CTA button
  await waitFor(() => {
    expect(screen.getByRole('button', { name: /^export$/i })).toBeTruthy();
  });
}

/** Returns the Export CTA button inside the sheet (matches both idle and loading states). */
function getExportCta() {
  // The button label changes to "Exporting…" during loading, so match
  // the dialog container and pick the only non-trigger button inside it.
  const dialog = screen.queryByRole('dialog');
  if (dialog) {
    const btn = dialog.querySelector('button');
    if (btn) return btn;
  }
  return screen.getByRole('button', { name: /^export$/i });
}

// ── Tests ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockExportTransactions.mockResolvedValue(undefined);
});

describe('ExportSettings', () => {
  describe('rendering', () => {
    it('renders the row trigger button', () => {
      renderComponent();
      expect(screen.getByRole('button', { name: /export data/i })).toBeTruthy();
    });

    it('renders the Export CTA inside the sheet after opening', async () => {
      renderComponent();
      await openSheet();
      expect(getExportCta()).toBeTruthy();
    });

    it('Export CTA is enabled by default (not loading)', async () => {
      renderComponent();
      await openSheet();
      expect((getExportCta() as HTMLButtonElement).disabled).toBe(false);
    });
  });

  describe('successful export', () => {
    it('calls exportService.exportTransactions when the CTA is clicked', async () => {
      renderComponent();
      await openSheet();

      await act(async () => {
        fireEvent.click(getExportCta());
      });

      expect(mockExportTransactions).toHaveBeenCalledTimes(1);
    });

    it('passes formatted start date, end date, and mainCurrency to the service', async () => {
      renderComponent();
      await openSheet();

      await act(async () => {
        fireEvent.click(getExportCta());
      });

      // parsePeriodFilter returns { start: 2026-04-01, end: 2026-04-30 }
      // format() produces 'yyyy-MM-dd' strings
      expect(mockExportTransactions).toHaveBeenCalledWith('2026-04-01', '2026-04-30', 'USD');
    });

    it('shows a success toast after successful export', async () => {
      renderComponent();
      await openSheet();

      await act(async () => {
        fireEvent.click(getExportCta());
      });

      expect(mockShow).toHaveBeenCalledWith(
        'Export complete. Your file has been downloaded.',
        'success',
      );
    });
  });

  describe('failed export', () => {
    it('shows an error toast when exportTransactions rejects', async () => {
      mockExportTransactions.mockRejectedValue(new Error('Download failed'));

      renderComponent();
      await openSheet();

      await act(async () => {
        fireEvent.click(getExportCta());
      });

      expect(mockShow).toHaveBeenCalledWith(
        'Export failed. Please check your storage and try again.',
        'error',
      );
    });

    it('does not show a success toast on failure', async () => {
      mockExportTransactions.mockRejectedValue(new Error('Network error'));

      renderComponent();
      await openSheet();

      await act(async () => {
        fireEvent.click(getExportCta());
      });

      expect(mockShow).not.toHaveBeenCalledWith(
        expect.stringContaining('complete'),
        'success',
      );
    });
  });

  describe('loading state', () => {
    it('disables the CTA while export is in progress', async () => {
      let resolveExport!: () => void;
      mockExportTransactions.mockReturnValue(
        new Promise<void>((resolve) => {
          resolveExport = resolve;
        }),
      );

      renderComponent();
      await openSheet();

      act(() => {
        fireEvent.click(getExportCta());
      });

      // Button should be disabled while the promise is pending
      await waitFor(() => {
        expect((getExportCta() as HTMLButtonElement).disabled).toBe(true);
      });

      // Clean up — resolve the promise so the component finishes
      await act(async () => {
        resolveExport();
      });
    });

    it('re-enables the CTA after export completes', async () => {
      renderComponent();
      await openSheet();

      await act(async () => {
        fireEvent.click(getExportCta());
      });

      expect((getExportCta() as HTMLButtonElement).disabled).toBe(false);
    });

    it('re-enables the CTA after a failed export', async () => {
      mockExportTransactions.mockRejectedValue(new Error('oops'));

      renderComponent();
      await openSheet();

      await act(async () => {
        fireEvent.click(getExportCta());
      });

      expect((getExportCta() as HTMLButtonElement).disabled).toBe(false);
    });
  });
});
