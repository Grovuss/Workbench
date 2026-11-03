import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { SupportTicket } from './types';

/** Whether reporting is set up in this build, and how many replies haven't been read. */
export function useSupport() {
  const [enabled, setEnabled] = useState(false);
  const [unread, setUnread] = useState(0);

  const count = useCallback((tickets: SupportTicket[]) => setUnread(tickets.reduce((n, t) => n + t.unread, 0)), []);

  useEffect(() => {
    let active = true;
    api.system
      .info()
      .then((info) => {
        if (!active || !info.support) return;
        setEnabled(true);
        api.support.list().then(count).catch(() => {});
      })
      .catch(() => {});
    const off = api.game.onEvent((event) => {
      if (event.type === 'support-changed') api.support.list().then(count).catch(() => {});
    });
    return () => {
      active = false;
      off();
    };
  }, [count]);

  return { enabled, unread, onTicketsChange: count };
}
