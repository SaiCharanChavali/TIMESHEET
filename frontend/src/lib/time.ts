// Shift times are stored as 24-hour "HH:mm" for reliable calculations, but always shown in 12-hour format.

export function parseShiftTime(value: string) {
  const [hours, minute] = value.split(':');
  const h = Number(hours);
  return { hour: String(h % 12 || 12), minute, period: h < 12 ? 'am' : 'pm' };
}

export function toShiftTime(hour: string, minute: string, period: string) {
  const h = (Number(hour) % 12) + (period === 'pm' ? 12 : 0);
  return `${String(h).padStart(2, '0')}:${minute}`;
}

export function formatShiftTime(value: string) {
  const { hour, minute, period } = parseShiftTime(value);
  return `${hour}:${minute} ${period}`;
}

export const formatDuration = (minutes: number) => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;

// Calendar days are parsed as UTC and shown as UTC, so that they never shift by a day.
export const formatDay = (day: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-IN', { ...options, timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));

export const formatTime = (iso: string | null | undefined, timeZone: string) =>
  iso ? new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone }).format(new Date(iso)) : '—';

export function addDays(day: string, amount: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

// A moment as "HH:mm" at the office, the form that shift and correction times are sent in.
export const toOfficeTime = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(new Date(iso));

// A moment with its date, such as "4 Nov, 6:15 pm", at the office.
export const formatDateTime = (iso: string | null | undefined, timeZone: string) =>
  iso ? new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone }).format(new Date(iso)) : '—';
