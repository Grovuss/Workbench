import { useCallback, useState } from 'react';

export type ToastTone = 'error' | 'success';

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

let nextId = 1;

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismissToast = useCallback((id: number) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback(
    (message: string, tone: ToastTone = 'error') => {
      const id = nextId++;
      setToasts((ts) => [...ts.slice(-3), { id, message, tone }]);
      setTimeout(() => dismissToast(id), tone === 'error' ? 8000 : 4000);
    },
    [dismissToast],
  );

  return { toasts, pushToast, dismissToast };
}
