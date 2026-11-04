import type { AttendanceStatus } from '../generated/prisma/client.js';
import { officeTime, timeToMinutes } from '../lib/officeTime.js';

export interface DayRules {
  shiftStart: string;
  shiftEnd: string;
  graceMinutes: number;
  fullDayMinutes: number;
  halfDayMinutes: number;
  overtimeAfterMins: number;
  scheduled: boolean;
}

// Arriving within the grace period isn't late. Past it, lateness counts from the shift start.
export function calcLateMinutes(checkInAt: Date, rules: DayRules) {
  if (!rules.scheduled) return 0;
  const late = officeTime(checkInAt).minutes - timeToMinutes(rules.shiftStart);
  return late > rules.graceMinutes ? late : 0;
}

export function calcDay(checkInAt: Date, checkOutAt: Date, breaks: { startAt: Date; endAt: Date }[], rules: DayRules) {
  const breakMs = breaks.reduce((sum, b) => sum + (b.endAt.getTime() - b.startAt.getTime()), 0);
  return calcDayWithBreakMs(checkInAt, checkOutAt, breakMs, rules);
}

// For corrections, where only the total break time is known.
export function calcDayWithBreakMs(
  checkInAt: Date,
  checkOutAt: Date,
  breakMs: number,
  rules: DayRules,
): {
  workedMinutes: number;
  breakMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  status: AttendanceStatus;
} {
  const breakMinutes = Math.floor(breakMs / 60000);
  const workedMinutes = Math.max(0, Math.floor((checkOutAt.getTime() - checkInAt.getTime() - breakMs) / 60000));
  const lateMinutes = calcLateMinutes(checkInAt, rules);

  // Time worked on a weekly off or holiday is all overtime, with no late or half-day rules.
  if (!rules.scheduled) {
    return { workedMinutes, breakMinutes, lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: workedMinutes, status: 'PRESENT' };
  }

  const earlyLeaveMinutes = Math.max(0, timeToMinutes(rules.shiftEnd) - officeTime(checkOutAt).minutes);
  const overtimeMinutes = Math.max(0, workedMinutes - rules.overtimeAfterMins);

  let status: AttendanceStatus;
  if (workedMinutes >= rules.fullDayMinutes) status = lateMinutes ? 'LATE' : 'PRESENT';
  else if (workedMinutes >= rules.halfDayMinutes) status = 'HALF_DAY';
  else status = 'ABSENT';

  return { workedMinutes, breakMinutes, lateMinutes, earlyLeaveMinutes, overtimeMinutes, status };
}
