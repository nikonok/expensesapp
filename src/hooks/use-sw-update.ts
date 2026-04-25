import { useState, useEffect } from 'react';
import { getUpdateAvailable, onUpdateAvailableChange, triggerUpdate, dismissUpdate } from '../sw-register';

export function useSwUpdate() {
  const [updateAvailable, setUpdateAvailable] = useState(getUpdateAvailable());
  useEffect(() => {
    return onUpdateAvailableChange(setUpdateAvailable);
  }, []);
  return { updateAvailable, update: triggerUpdate, dismiss: dismissUpdate };
}
