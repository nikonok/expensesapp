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

vi.mock('@/utils/date-utils', () => ({
  getLocalDateString: vi.fn(() => '2026-04-12'),
  parsePeriodFilter: vi.fn(() => ({
    start: new Date('2026-04-01'),
    end: new Date('2026-04-30'),
  })),
}));

const mockShow = vi.fn();
vi.mock('@/components/shared/Toast', () => ({
  useToast: () => ({ show: mockShow }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'settings.export.label': 'Export data',
        'settings.export.button': 'Export',
        'settings.export.complete': 'Export complete. Your file has been downloaded.',
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

// ── Tests ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockExportTransactions.mockResolvedValue(undefined);
});

describe('ExportSettings', () => {
  describe('rendering', () => {
    it('renders the export button', () => {
      renderComponent();
      expect(screen.getByRole('button', { name: /export/i })).toBeTruthy();
    });

    it('button is enabled by default (not loading)', () => {
      renderComponent();
      expect((screen.getByRole('button', { name: /export/i }) as HTMLButtonElement).disabled).toBe(false);
    });
  });

  describe('successful export', () => {
    it('calls exportService.exportTransactions when the button is clicked', async () => {
      renderComponent();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /export/i }));
      });

      expect(mockExportTransactions).toHaveBeenCalledTimes(1);
    });

    it('passes formatted start date, end date, and mainCurrency to the service', async () => {
      renderComponent();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /export/i }));
      });

      // parsePeriodFilter returns { start: 2026-04-01, end: 2026-04-30 }
      // format() produces 'yyyy-MM-dd' strings
      expect(mockExportTransactions).toHaveBeenCalledWith('2026-04-01', '2026-04-30', 'USD');
    });

    it('shows a success toast after successful export', async () => {
      renderComponent();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /export/i }));
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

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /export/i }));
      });

      expect(mockShow).toHaveBeenCalledWith(
        'Something went wrong. Please try again.',
        'error',
      );
    });

    it('does not show a success toast on failure', async () => {
      mockExportTransactions.mockRejectedValue(new Error('Network error'));

      renderComponent();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /export/i }));
      });

      expect(mockShow).not.toHaveBeenCalledWith(
        expect.stringContaining('complete'),
        'success',
      );
    });
  });

  describe('loading state', () => {
    it('disables the button while export is in progress', async () => {
      let resolveExport!: () => void;
      mockExportTransactions.mockReturnValue(
        new Promise<void>((resolve) => {
          resolveExport = resolve;
        }),
      );

      renderComponent();

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: /export/i }));
      });

      // Button should be disabled while the promise is pending
      await waitFor(() => {
        expect((screen.getByRole('button', { name: /export/i }) as HTMLButtonElement).disabled).toBe(true);
      });

      // Clean up — resolve the promise so the component finishes
      await act(async () => {
        resolveExport();
      });
    });

    it('re-enables the button after export completes', async () => {
      renderComponent();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /export/i }));
      });

      expect((screen.getByRole('button', { name: /export/i }) as HTMLButtonElement).disabled).toBe(false);
    });

    it('re-enables the button after a failed export', async () => {
      mockExportTransactions.mockRejectedValue(new Error('oops'));

      renderComponent();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /export/i }));
      });

      expect((screen.getByRole('button', { name: /export/i }) as HTMLButtonElement).disabled).toBe(false);
    });
  });
});
