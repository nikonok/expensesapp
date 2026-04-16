import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import { useSettingsStore } from '../../stores/settings-store';
import {
  createBackup,
  listBackups,
  restoreFromBackup,
  exportToFile,
  importFromFile,
  setAutoBackupSchedule,
} from '../../services/backup.service';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import BottomSheet from '../layout/BottomSheet';
import { useToast } from '../shared/Toast';

const INTERVAL_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: 'Off' },
  { value: 6, label: '6h' },
  { value: 12, label: '12h' },
  { value: 24, label: '24h' },
  { value: 48, label: '48h' },
];

export function BackupSettings() {
  const { t } = useTranslation();
  const { autoBackupIntervalHours, update } = useSettingsStore();
  const { show } = useToast();

  const [intervalOpen, setIntervalOpen] = useState(false);
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const [restoreFileConfirmOpen, setRestoreFileConfirmOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentIntervalLabel =
    INTERVAL_OPTIONS.find((o) => o.value === autoBackupIntervalHours)?.label ?? 'Off';

  async function handleCreateBackup() {
    try {
      await createBackup();
      show(t('settings.backup.created'), 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      show(
        message.includes('quota') || message.includes('storage')
          ? t('errors.quotaExceeded')
          : t('errors.generic'),
        'error',
      );
    }
  }

  async function handleIntervalSelect(value: number | null) {
    try {
      await update('autoBackupIntervalHours', value);
      setAutoBackupSchedule(value);
      setIntervalOpen(false);
    } catch {
      show(t('errors.generic'), 'error');
    }
  }

  async function handleRestoreConfirm() {
    setRestoreConfirmOpen(false);
    try {
      const backups = await listBackups();
      if (backups.length === 0) {
        show(t('settings.backup.noBackup'), 'error');
        return;
      }
      await restoreFromBackup(backups[0].id!);
      // _restoreData() dispatches 'backup-restored' event → App.tsx calls window.location.reload()
    } catch (err) {
      console.error('[BackupSettings] restoreFromBackup failed:', err);
      show(err instanceof Error ? err.message : t('errors.generic'), 'error');
    }
  }

  async function handleExportToFile() {
    try {
      await exportToFile();
      show(t('settings.backup.exported'), 'success');
    } catch (err) {
      console.error('[BackupSettings] exportToFile failed:', err);
      show(t('errors.generic'), 'error');
    }
  }

  function handleRestoreFromFileClick() {
    fileInputRef.current?.click();
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ''; // reset so same file can be re-selected
    setPendingFile(file);
    setRestoreFileConfirmOpen(true);
  }

  async function handleRestoreFileConfirm() {
    setRestoreFileConfirmOpen(false);
    if (!pendingFile) return;
    try {
      await importFromFile(pendingFile);
      // _restoreData() dispatches 'backup-restored' event → App.tsx calls window.location.reload()
    } catch (err) {
      console.error('[BackupSettings] importFromFile failed:', err);
      show(err instanceof Error ? err.message : t('errors.invalidFile'), 'error');
    } finally {
      setPendingFile(null);
    }
  }

  return (
    <div>
      {/* Create backup */}
      <button
        onClick={handleCreateBackup}
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
          {t('settings.backup.create')}
        </span>
        <ChevronRight size={16} strokeWidth={2} style={{ color: 'var(--color-text-secondary)' }} />
      </button>

      {/* Auto-backup interval */}
      <button
        onClick={() => setIntervalOpen(true)}
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
          {t('settings.backup.schedule')}
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
          {currentIntervalLabel}
          <ChevronRight size={16} strokeWidth={2} style={{ color: 'var(--color-text-secondary)' }} />
        </span>
      </button>

      {/* Export to file */}
      <button
        onClick={handleExportToFile}
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
          {t('settings.backup.export')}
        </span>
        <ChevronRight size={16} strokeWidth={2} style={{ color: 'var(--color-text-secondary)' }} />
      </button>

      {/* Restore from backup */}
      <button
        onClick={() => setRestoreConfirmOpen(true)}
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
          {t('settings.backup.restore')}
        </span>
        <ChevronRight size={16} strokeWidth={2} style={{ color: 'var(--color-text-secondary)' }} />
      </button>

      {/* Restore from file */}
      <button
        onClick={handleRestoreFromFileClick}
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
          {t('settings.backup.restoreFile')}
        </span>
        <ChevronRight size={16} strokeWidth={2} style={{ color: 'var(--color-text-secondary)' }} />
      </button>

      {/* Interval picker sheet */}
      <BottomSheet
        isOpen={intervalOpen}
        onClose={() => setIntervalOpen(false)}
        title={t('settings.backup.schedule')}
      >
        <div
          role="radiogroup"
          aria-label={t('settings.backup.schedule')}
          style={{ paddingInline: 'var(--space-4)', paddingBottom: 'var(--space-6)' }}
        >
          {INTERVAL_OPTIONS.map((opt) => {
            const isSelected = autoBackupIntervalHours === opt.value;
            return (
              <button
                key={String(opt.value)}
                role="radio"
                aria-checked={isSelected}
                onClick={() => handleIntervalSelect(opt.value)}
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
                {opt.label}
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

      {/* Restore confirm dialog */}
      <ConfirmDialog
        isOpen={restoreConfirmOpen}
        title={t('settings.backup.restore')}
        body={t('settings.backup.restoreConfirm')}
        confirmLabel="Restore"
        onConfirm={handleRestoreConfirm}
        onCancel={() => setRestoreConfirmOpen(false)}
        variant="destructive"
      />

      {/* Restore from file confirm dialog */}
      <ConfirmDialog
        isOpen={restoreFileConfirmOpen}
        title={t('settings.backup.restoreFile')}
        body={t('settings.backup.restoreFileConfirm')}
        confirmLabel="Restore"
        onConfirm={handleRestoreFileConfirm}
        onCancel={() => { setRestoreFileConfirmOpen(false); setPendingFile(null); }}
        variant="destructive"
      />

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
      />
    </div>
  );
}
