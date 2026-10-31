import { AlertCircle, X } from 'lucide-react';
import type { Toast } from '../useToasts';

interface Props {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}

export default function Toasts({ toasts, onDismiss }: Props) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <AlertCircle size={18} className="toast-icon" />
          <p>{t.message}</p>
          <button className="icon-btn" aria-label="Dismiss" onClick={() => onDismiss(t.id)}>
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
