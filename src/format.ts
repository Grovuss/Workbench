export const formatGb = (mb: number) => `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB`;

/** Highest memory slider value: total RAM minus 1 GB headroom for the OS, in 512 MB steps. */
export const maxMemoryMb = (totalMb: number) => Math.max(1024, Math.floor((totalMb - 1024) / 512) * 512);

export function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

/** 1234567 → "1.2M", for download and follower counts. */
export const formatCount = (n: number) => compact.format(n);
