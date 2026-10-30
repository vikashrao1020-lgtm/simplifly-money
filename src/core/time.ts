const IST_OFFSET_MS = 330 * 60 * 1000;

export function monthKey(iso: string): string {
  const date = new Date(Date.parse(iso) + IST_OFFSET_MS);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(key: string): string {
  const [year, month] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, 1));
  return new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

export function dateTimeIST(iso: string): string {
  const date = new Date(Date.parse(iso) + IST_OFFSET_MS);
  const day = date.getUTCDate();
  const month = new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' }).format(date);
  let hour = date.getUTCHours();
  const minute = String(date.getUTCMinutes()).padStart(2, '0');
  const suffix = hour >= 12 ? 'pm' : 'am';
  hour = hour % 12 || 12;
  return `${day} ${month}, ${hour}:${minute} ${suffix}`;
}

export function timeOnlyIST(iso: string): string {
  return dateTimeIST(iso).split(', ')[1] ?? '';
}

export function relativeSyncedAt(iso: string | null): string {
  if (!iso) return 'Not synced yet';
  const elapsed = Math.max(0, Date.now() - Date.parse(iso));
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'Updated just now';
  if (minutes < 60) return `Updated ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours} hr ago`;
  return `Updated ${dateTimeIST(iso)}`;
}
