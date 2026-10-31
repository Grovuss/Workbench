import type { Progress } from '../types';

export const progressPercent = (p?: Progress) => (p?.total ? Math.floor((p.done / p.total) * 100) : null);

interface Props {
  /** 0–100, or null/undefined for an indeterminate bar. */
  value?: number | null;
  size?: 'sm' | 'md';
  label?: string;
}

/** Brand progress bar: yellow fill with moving workbench-style hazard stripes. */
export default function ProgressBar({ value, size = 'md', label }: Props) {
  const indeterminate = value == null;
  return (
    <div
      className={`progress progress-${size}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : value}
      data-indeterminate={indeterminate || undefined}
    >
      <div className="progress-fill" style={indeterminate ? undefined : { width: `${value}%` }} />
    </div>
  );
}
