/**
 * DRAG Workspace formatters for storage sizes and relative sync timestamps.
 */

export function formatBytes(bytes?: number | null): string | null {
  if (bytes === null || bytes === undefined || bytes < 0) return null;
  if (bytes >= 1e14 || bytes === Number.MAX_SAFE_INTEGER) return "∞";
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

export function formatLimit(val?: number | null): string {
  if (val === null || val === undefined) return "∞";
  if (val >= 1e14 || val === Number.MAX_SAFE_INTEGER) return "∞";
  return val.toLocaleString();
}


export function formatRelativeSyncTime(timestamp?: string | Date | null): string | null {
  if (!timestamp) return null;
  const date = typeof timestamp === "string" ? new Date(timestamp) : timestamp;
  const time = date.getTime();
  if (Number.isNaN(time)) return null;

  const now = Date.now();
  const diffMs = now - time;
  if (diffMs < 60 * 1000) return "Synced just now";

  const diffMinutes = Math.floor(diffMs / (60 * 1000));
  if (diffMinutes < 60) {
    return diffMinutes === 1 ? "Synced 1 minute ago" : `Synced ${diffMinutes} minutes ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return diffHours === 1 ? "Synced 1 hour ago" : `Synced ${diffHours} hours ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "Synced yesterday";
  return `Synced ${diffDays} days ago`;
}
