import { useEffect, useState } from 'react';
import { api } from './api';
import type { UpdateStatus } from './types';

/** Where the self-updater is: checking, downloading, ready to install… null until known. */
export function useUpdateStatus() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  useEffect(() => {
    api.updates.status().then(setStatus).catch(() => {});
    return api.game.onEvent((event) => {
      if (event.type !== 'update') return;
      const { type: _type, ...next } = event;
      setStatus(next);
    });
  }, []);
  return [status, setStatus] as const;
}
