import { useState, useEffect } from 'react';
import { getCanInstall, onCanInstallChange, triggerInstall, dismissInstall } from '../sw-register';

export function useInstallPrompt() {
  const [canInstall, setCanInstall] = useState(getCanInstall());
  useEffect(() => {
    return onCanInstallChange(setCanInstall);
  }, []);
  return { canInstall, install: triggerInstall, dismiss: dismissInstall };
}
