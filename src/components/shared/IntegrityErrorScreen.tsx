import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listBackups, restoreFromBackup, importFromFile } from '../../services/backup.service';
import { ConfirmDialog } from './ConfirmDialog';
import { useToast } from './Toast';

export function IntegrityErrorScreen() {
  const { t } = useTranslation();
  const { show } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [fileConfirmOpen, setFileConfirmOpen] = useState(false);

  async function handleRestoreFromBackup() {
    setIsLoading(true);
    try {
      const backups = await listBackups();
      if (backups.length === 0) {
        show(t('settings.backup.noBackup'), 'error');
        return;
      }
      await restoreFromBackup(backups[0].id!);
      window.location.reload();
    } catch {
      show(t('errors.restoreFailed'), 'error');
    } finally {
      setIsLoading(false);
    }
  }

  function handleRestoreFromFileClick() {
    fileInputRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset input so the same file can be re-selected if needed
    e.target.value = '';
    setPendingFile(file);
    setFileConfirmOpen(true);
  }

  async function handleFileConfirm() {
    setFileConfirmOpen(false);
    if (!pendingFile) return;
    setIsLoading(true);
    try {
      await importFromFile(pendingFile);
      window.location.reload();
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      show(message || t('errors.invalidFile'), 'error');
    } finally {
      setIsLoading(false);
      setPendingFile(null);
    }
  }

  function handleFileCancel() {
    setFileConfirmOpen(false);
    setPendingFile(null);
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 'var(--z-dialog)' as React.CSSProperties['zIndex'],
        background: 'var(--color-bg)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-6)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '480px',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-6)',
        }}
      >
        {/* Error indicator */}
        <div
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '50%',
            background: 'var(--color-expense-dim)',
            border: '1px solid var(--color-expense)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            alignSelf: 'center',
            boxShadow: '0 0 16px var(--color-expense)',
          }}
        >
          <span
            style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontWeight: 600,
              fontSize: 'var(--text-subheading)',
              color: 'var(--color-expense)',
            }}
          >
            !
          </span>
        </div>

        {/* Heading */}
        <h1
          style={{
            margin: 0,
            fontFamily: '"Syne", sans-serif',
            fontWeight: 700,
            fontSize: 'var(--text-heading)',
            color: 'var(--color-text)',
            textAlign: 'center',
          }}
        >
          {t('errors.integrityTitle')}
        </h1>

        {/* Body text */}
        <p
          style={{
            margin: 0,
            fontFamily: '"DM Sans", sans-serif',
            fontWeight: 400,
            fontSize: 'var(--text-body)',
            color: 'var(--color-text-secondary)',
            textAlign: 'center',
            lineHeight: 1.5,
          }}
        >
          {t('errors.integrityBody')}
        </p>

        {/* Action buttons */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)',
          }}
        >
          {/* Restore from backup */}
          <button
            onClick={handleRestoreFromBackup}
            disabled={isLoading}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '52px',
              width: '100%',
              padding: '0 var(--space-4)',
              background: 'var(--color-primary-dim)',
              border: '1px solid var(--color-primary)',
              borderRadius: 'var(--space-2)',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              opacity: isLoading ? 0.5 : 1,
              color: 'var(--color-primary)',
              fontFamily: '"DM Sans", sans-serif',
              fontWeight: 500,
              fontSize: 'var(--text-body)',
            }}
          >
            {t('settings.backup.restore')}
          </button>

          {/* Restore from file */}
          <button
            onClick={handleRestoreFromFileClick}
            disabled={isLoading}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '52px',
              width: '100%',
              padding: '0 var(--space-4)',
              background: 'none',
              border: '1px solid var(--color-border-strong)',
              borderRadius: 'var(--space-2)',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              opacity: isLoading ? 0.5 : 1,
              color: 'var(--color-text)',
              fontFamily: '"DM Sans", sans-serif',
              fontWeight: 500,
              fontSize: 'var(--text-body)',
            }}
          >
            {t('settings.backup.restoreFile')}
          </button>
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* Confirm dialog for file restore */}
      <ConfirmDialog
        isOpen={fileConfirmOpen}
        title={t('settings.backup.restoreFile')}
        body={t('settings.backup.restoreFileConfirm')}
        confirmLabel={t('common.restore')}
        onConfirm={handleFileConfirm}
        onCancel={handleFileCancel}
        variant="destructive"
      />
    </div>
  );
}
