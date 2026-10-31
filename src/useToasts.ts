import { useCallback, useState } from 'react';

export interface Toast {
  id: number;
  message: string;
}

let nextId = 1;

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismissToast = useCallback((id: number) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback(
    (message: string) => {
      const id = nextId++;
      setToasts((ts) => [...ts.slice(-3), { id, message }]);
      setTimeout(() => dismissToast(id), 8000);
    },
    [dismissToast],
  );

  return { toasts, pushToast, dismissToast };
}
