import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import { useSettingsStore } from '@/stores/settings-store';
import { logger } from '@/services/log.service';
import { db } from '@/db/database';
import { useToast } from '@/components/shared/Toast';
import BottomSheet from '@/components/layout/BottomSheet';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';

const LEVEL_OPTIONS: { value: 'all' | 'errors'; labelKey: string }[] = [
  { value: 'all', labelKey: 'settings.log.levels.all' },
  { value: 'errors', labelKey: 'settings.log.levels.errors' },
];

export function LogSettings() {
  const { t } = useTranslation();
  const logLevel = useSettingsStore((s) => s.logLevel);
  const { update } = useSettingsStore();
  const { show } = useToast();

  const [levelOpen, setLevelOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  const currentLevelLabel = t(LEVEL_OPTIONS.find(o => o.value === logLevel)!.labelKey);

  async function handleExportLogs() {
    setIsExporting(true);
    try {
      await logger.exportLogs();
      show(t('settings.log.exported'), 'success');
    } catch {
      show(t('errors.generic'), 'error');
    } finally {
      setIsExporting(false);
    }
  }

  async function handleClearConfirm() {
    setClearConfirmOpen(false);
    try {
      await db.logs.clear();
      show(t('settings.log.cleared'), 'success');
    } catch {
      show(t('errors.generic'), 'error');
    }
  }

  return (
    <div>
      {/* Log level picker */}
      <button
        onClick={() => setLevelOpen(true)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          minHeight: '52px',
          width: '100%',
          padding: '0 var(--space-4)',
          background: 'none',
          border: 'none',
          borderBottom: '1px solid var(--color-border)',
          cursor: 'pointer',
          color: 'var(--color-text)',
        }}
      >
        <span
          style={{
            fontFamily: '"DM Sans", sans-serif',
            fontWeight: 500,
            fontSize: 'var(--text-body)',
          }}
        >
          {t('settings.log.level')}
        </span>
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            fontFamily: '"DM Sans", sans-serif',
            fontSize: 'var(--text-body)',
            color: 'var(--color-text-secondary)',
          }}
        >
          {currentLevelLabel}
          <ChevronRight size={16} strokeWidth={2} style={{ color: 'var(--color-text-secondary)' }} />
        </span>
      </button>

      {/* Export logs */}
      <button
        onClick={handleExportLogs}
        disabled={isExporting}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          minHeight: '52px',
          width: '100%',
          padding: '0 var(--space-4)',
          background: 'none',
          border: 'none',
          borderBottom: '1px solid var(--color-border)',
          cursor: isExporting ? 'not-allowed' : 'pointer',
          opacity: isExporting ? 0.6 : 1,
          color: 'var(--color-text)',
        }}
      >
        <span
          style={{
            fontFamily: '"DM Sans", sans-serif',
            fontWeight: 500,
            fontSize: 'var(--text-body)',
          }}
        >
          {t('settings.log.export')}
        </span>
        <ChevronRight size={16} strokeWidth={2} style={{ color: 'var(--color-text-secondary)' }} />
      </button>

      {/* Clear logs */}
      <button
        onClick={() => setClearConfirmOpen(true)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          minHeight: '52px',
          width: '100%',
          padding: '0 var(--space-4)',
          background: 'none',
          border: 'none',
          borderBottom: '1px solid var(--color-border)',
          cursor: 'pointer',
          color: 'var(--color-text)',
        }}
      >
        <span
          style={{
            fontFamily: '"DM Sans", sans-serif',
            fontWeight: 500,
            fontSize: 'var(--text-body)',
          }}
        >
          {t('settings.log.clear')}
        </span>
        <ChevronRight size={16} strokeWidth={2} style={{ color: 'var(--color-text-secondary)' }} />
      </button>

      {/* Level picker sheet */}
      <BottomSheet
        isOpen={levelOpen}
        onClose={() => setLevelOpen(false)}
        title={t('settings.log.level')}
      >
        <div
          role="radiogroup"
          aria-label={t('settings.log.level')}
          style={{ paddingInline: 'var(--space-4)', paddingBottom: 'var(--space-6)' }}
        >
          {LEVEL_OPTIONS.map((opt) => {
            const isSelected = logLevel === opt.value;
            return (
              <button
                key={opt.value}
                role="radio"
                aria-checked={isSelected}
                onClick={() => {
                  update('logLevel', opt.value);
                  setLevelOpen(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  minHeight: '52px',
                  width: '100%',
                  padding: '0 var(--space-1)',
                  background: 'none',
                  border: 'none',
                  borderBottom: '1px solid var(--color-border)',
                  cursor: 'pointer',
                  fontFamily: '"DM Sans", sans-serif',
                  fontWeight: 500,
                  fontSize: 'var(--text-body)',
                  color: isSelected ? 'var(--color-primary)' : 'var(--color-text)',
                  textAlign: 'left',
                }}
              >
                {t(opt.labelKey)}
                {isSelected && (
                  <span
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: 'var(--color-primary)',
                      flexShrink: 0,
                      boxShadow: '0 0 6px var(--color-primary)',
                    }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </BottomSheet>

      {/* Clear confirm dialog */}
      <ConfirmDialog
        isOpen={clearConfirmOpen}
        title={t('settings.log.clear')}
        body={t('settings.log.clearConfirm')}
        confirmLabel={t('common.delete')}
        onConfirm={handleClearConfirm}
        onCancel={() => setClearConfirmOpen(false)}
        variant="destructive"
      />
    </div>
  );
}
