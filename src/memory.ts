export const formatGb = (mb: number) => `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB`;

/** Highest memory slider value: total RAM minus 1 GB headroom for the OS, in 512 MB steps. */
export const maxMemoryMb = (totalMb: number) => Math.max(1024, Math.floor((totalMb - 1024) / 512) * 512);
