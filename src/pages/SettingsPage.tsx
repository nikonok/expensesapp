import { ToastProvider } from '../components/shared/Toast';
import { SettingsView } from '../components/settings/SettingsView';

export default function SettingsPage() {
  return (
    <ToastProvider>
      <SettingsView />
    </ToastProvider>
  );
}
