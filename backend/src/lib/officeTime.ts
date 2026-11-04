import { env } from './env.js';

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: env.OFFICE_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

// The calendar day ("YYYY-MM-DD") and minute of the day at the office, wherever the server runs.
export function officeTime(at: Date) {
  const parts = Object.fromEntries(formatter.formatToParts(at).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

// The exact moment of a time of day at the office. Works by measuring the office's offset from UTC at that moment.
export function officeDateTime(day: string, hhmm: string) {
  const asUtc = new Date(`${day}T${hhmm}:00.000Z`);
  const seen = officeTime(asUtc);
  const dayDiff = (dayToDb(seen.date).getTime() - dayToDb(day).getTime()) / 60000;
  const offsetMinutes = dayDiff + seen.minutes - timeToMinutes(hhmm);
  return new Date(asUtc.getTime() - offsetMinutes * 60000);
}

// Date columns are stored as midnight UTC, so that a day never shifts when converted.
export const dayToDb = (day: string) => new Date(`${day}T00:00:00.000Z`);
export const dbToDay = (date: Date) => date.toISOString().slice(0, 10);

export function addDays(day: string, amount: number) {
  const date = dayToDb(day);
  date.setUTCDate(date.getUTCDate() + amount);
  return dbToDay(date);
}

// 0 = Sunday ... 6 = Saturday, matching Shift.weeklyOffDays.
export const weekday = (day: string) => dayToDb(day).getUTCDay();

export const timeToMinutes = (hhmm: string) => {
  const [hours, minutes] = hhmm.split(':').map(Number);
  return hours * 60 + minutes;
};
