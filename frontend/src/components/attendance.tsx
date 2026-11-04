import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { formatDay, formatDuration, formatTime } from '../lib/time';
import { DataTable } from './ui';

export interface DayRecord {
  date: string;
  checkInAt: string;
  checkOutAt: string | null;
  shiftName: string;
  shiftStart: string;
  shiftEnd: string;
  scheduled: boolean;
  lateMinutes: number;
  workedMinutes: number | null;
  breakMinutes: number | null;
  earlyLeaveMinutes: number | null;
  overtimeMinutes: number | null;
  status: string | null;
  correctedAt: string | null;
  breaks: { startAt: string; endAt: string | null }[];
}

export interface AttendanceDay {
  date: string;
  status: string;
  holiday: string | null;
  record: DayRecord | null;
  locked?: boolean;
  pendingCorrection?: boolean;
}

export interface Correction {
  id: string;
  date: string;
  employee: { id: string; name: string; employeeCode: string };
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  reason: string;
  requestedCheckInAt: string;
  requestedCheckOutAt: string;
  requestedBreakMinutes: number;
  originalCheckInAt: string | null;
  originalCheckOutAt: string | null;
  originalBreakMinutes: number | null;
  reviewer: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
}

// Lets the menu badge update as soon as something on the Approvals page is dealt with.
export const APPROVALS_CHANGED = 'approvals-changed';

export interface TeamSummaryCounts {
  total: number;
  atWork: number;
  checkedOut: number;
  noCheckOut: number;
  notIn: number;
  off: number;
  noShift: number;
  late: number;
}

export interface TeamRow {
  id: string;
  employeeCode: string;
  name: string;
  department: string | null;
  shift: string | null;
  status: string;
  record: DayRecord | null;
}

export interface TeamDay {
  timeZone: string;
  today: string;
  date: string;
  holiday: string | null;
  summary: TeamSummaryCounts;
  rows: TeamRow[];
}

const statusStyle: Record<string, { label: string; className: string }> = {
  PRESENT: { label: 'Present', className: 'bg-green-100 text-green-800' },
  LATE: { label: 'Late', className: 'bg-amber-100 text-amber-900' },
  HALF_DAY: { label: 'Half day', className: 'bg-amber-100 text-amber-900' },
  ABSENT: { label: 'Absent', className: 'bg-red-100 text-red-800' },
  IN_PROGRESS: { label: 'At work', className: 'bg-blue-100 text-blue-800' },
  ON_BREAK: { label: 'On break', className: 'bg-brand-100 text-brand-700' },
  CHECKED_OUT: { label: 'Checked out', className: 'bg-slate-200 text-slate-800' },
  MISSING_CHECK_OUT: { label: 'No check-out', className: 'bg-red-100 text-red-800' },
  NOT_CHECKED_IN: { label: 'Not checked in', className: 'bg-slate-200 text-slate-800' },
  WEEKLY_OFF: { label: 'Weekly off', className: 'bg-slate-100 text-slate-600' },
  HOLIDAY: { label: 'Holiday', className: 'bg-purple-100 text-purple-800' },
  NO_SHIFT: { label: 'No shift', className: 'bg-slate-100 text-slate-600' },
};

export const statusLabel = (status: string) => statusStyle[status]?.label ?? status;

export function StatusBadge({ status }: { status: string }) {
  const className = statusStyle[status]?.className ?? 'bg-slate-100 text-slate-600';
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${className}`}>{statusLabel(status)}</span>;
}

const correctionStyle: Record<Correction['status'], { label: string; className: string }> = {
  PENDING: { label: 'Waiting', className: 'bg-blue-100 text-blue-800' },
  APPROVED: { label: 'Approved', className: 'bg-green-100 text-green-800' },
  REJECTED: { label: 'Rejected', className: 'bg-red-100 text-red-800' },
  CANCELLED: { label: 'Cancelled', className: 'bg-slate-100 text-slate-600' },
};

export function CorrectionStatusBadge({ status }: { status: Correction['status'] }) {
  const { label, className } = correctionStyle[status];
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${className}`}>{label}</span>;
}

export function TimeRange({ from, to, timeZone }: { from: string | null; to: string | null; timeZone: string }) {
  if (!from) return <>Nothing recorded</>;
  return <>{formatTime(from, timeZone)} to {to ? formatTime(to, timeZone) : 'no check-out'}</>;
}

export function StatTile({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-sm font-medium text-slate-600">{label}</p>
      <p className="mt-1 text-3xl font-bold tracking-tight tabular-nums">{value}</p>
      {note && <p className="mt-0.5 text-xs text-slate-500">{note}</p>}
    </div>
  );
}

export function TeamSummary({ summary, isToday }: { summary: TeamSummaryCounts; isToday: boolean }) {
  const extras = [
    summary.noCheckOut ? `${summary.noCheckOut} with no check-out` : '',
    summary.noShift ? `${summary.noShift} with no shift` : '',
  ].filter(Boolean).join(', ');

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Team size" value={summary.total} />
        <StatTile label={isToday ? 'At work now' : 'At work'} value={summary.atWork} />
        <StatTile label="Checked out" value={summary.checkedOut} />
        <StatTile label={isToday ? 'Not checked in' : 'Absent'} value={summary.notIn} />
        <StatTile label="Late" value={summary.late} note="Also counted in the others" />
        <StatTile label="Day off" value={summary.off} />
      </div>
      {extras && <p className="mt-2 text-sm text-slate-600">Also: {extras}.</p>}
    </>
  );
}

// The team's day at a glance for the Home page, with the detail one click away.
export function TeamToday() {
  const [team, setTeam] = useState<TeamDay | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = () => api<TeamDay>('/attendance/team').then(setTeam).catch((err: Error) => setError(err.message));
    load();
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, []);

  if (error) return <p className="mt-8 text-sm text-red-800">Couldn't load your team's attendance: {error}</p>;
  if (!team) return null;

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Team today</h2>
        <Link to="/attendance" className="text-sm font-medium text-brand-700 hover:underline">View everyone</Link>
      </div>
      <TeamSummary summary={team.summary} isToday />
    </section>
  );
}

const orDash = (minutes: number | null | undefined) => (minutes ? formatDuration(minutes) : '—');

export function DayTable({ days, timeZone, renderAction }: { days: AttendanceDay[]; timeZone: string; renderAction?: (day: AttendanceDay) => ReactNode }) {
  return (
    <DataTable headers={['Date', 'Status', 'Check in', 'Check out', 'Breaks', 'Worked', 'Late by', 'Left early', 'Overtime', ...(renderAction ? ['Actions'] : [])]}>
      {days.map((day) => { const { date, status, holiday, record } = day; return (
        <tr key={date}>
          <td className="font-medium whitespace-nowrap">
            {formatDay(date, { weekday: 'short', day: 'numeric', month: 'short' })}
            {holiday && <span className="block text-xs font-normal text-slate-500">{holiday}</span>}
          </td>
          <td>
            <StatusBadge status={status} />
            {record?.correctedAt && <span className="block text-xs text-slate-500">Corrected</span>}
          </td>
          <td className="whitespace-nowrap">{formatTime(record?.checkInAt, timeZone)}</td>
          <td className="whitespace-nowrap">{formatTime(record?.checkOutAt, timeZone)}</td>
          <td className="whitespace-nowrap">{orDash(record?.breakMinutes)}</td>
          <td className="whitespace-nowrap">{record?.workedMinutes != null ? formatDuration(record.workedMinutes) : '—'}</td>
          <td className="whitespace-nowrap">{orDash(record?.lateMinutes)}</td>
          <td className="whitespace-nowrap">{orDash(record?.earlyLeaveMinutes)}</td>
          <td className="whitespace-nowrap">{orDash(record?.overtimeMinutes)}</td>
          {renderAction && <td className="whitespace-nowrap">{renderAction(day)}</td>}
        </tr>
      ); })}
    </DataTable>
  );
}
