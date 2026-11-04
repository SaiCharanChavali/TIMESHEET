import { Coffee, LogIn, LogOut, Play } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { DayTable, StatusBadge, TeamToday, type AttendanceDay, type DayRecord } from '../components/attendance';
import { Alert, Button, SecondaryButton } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { formatDay, formatDuration, formatShiftTime, formatTime } from '../lib/time';

interface Today {
  now: string;
  timeZone: string;
  date: string;
  shift: { name: string; startTime: string; endTime: string } | null;
  holiday: string | null;
  weeklyOff: boolean;
  record: DayRecord | null;
  missedCheckOutDate: string | null;
}

function formatClock(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-semibold">{value}</dd>
    </div>
  );
}

function breakMsSoFar(record: DayRecord, now: number) {
  return record.breaks.reduce((sum, b) => sum + ((b.endAt ? new Date(b.endAt).getTime() : now) - new Date(b.startAt).getTime()), 0);
}

function TodayCard({ today, onChange }: { today: Today; onChange: (t: Today) => void }) {
  const { record, shift, timeZone } = today;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // The timer follows the server's clock, in case this computer's clock is wrong.
  const [clockOffset] = useState(() => new Date(today.now).getTime() - Date.now());
  const [now, setNow] = useState(() => Date.now() + clockOffset);

  const running = !!record && !record.checkOutAt;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now() + clockOffset), 1000);
    return () => clearInterval(id);
  }, [running, clockOffset]);

  const act = async (path: string) => {
    setBusy(true);
    setError('');
    try {
      onChange(await api<Today>(`/attendance/${path}`, {}));
    } catch (err) {
      setError((err as Error).message);
      // A refusal usually means this page is out of date, such as after checking out in another tab.
      api<Today>('/attendance/today').then(onChange).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const checkOut = () => {
    if (window.confirm(`Check out at ${formatTime(new Date(now).toISOString(), timeZone)}? You can only check out once a day.`)) act('check-out');
  };

  const onBreak = !!record?.breaks.some((b) => !b.endAt) && !record.checkOutAt;
  const status = !record ? 'NOT_CHECKED_IN' : record.checkOutAt ? record.status ?? 'CHECKED_OUT' : onBreak ? 'ON_BREAK' : 'IN_PROGRESS';
  const workedMs = record && !record.checkOutAt ? now - new Date(record.checkInAt).getTime() - breakMsSoFar(record, now) : 0;
  const breakMinutes = record ? record.breakMinutes ?? Math.floor(breakMsSoFar(record, now) / 60000) : 0;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{formatDay(today.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</h2>
          <p className="mt-0.5 text-sm text-slate-600">
            {shift ? `${shift.name}, ${formatShiftTime(shift.startTime)} to ${formatShiftTime(shift.endTime)}` : 'No shift assigned'}
          </p>
        </div>
        <StatusBadge status={status} />
      </div>

      {(today.holiday || today.weeklyOff) && !record?.checkOutAt && (
        <p className="mt-4 rounded-lg bg-purple-50 px-3 py-2 text-sm text-purple-900">
          {today.holiday ? `Today is a holiday: ${today.holiday}.` : 'Today is your weekly off.'} Any time you work today counts as overtime.
        </p>
      )}

      <div className="mt-5 space-y-4">
        {error && <Alert>{error}</Alert>}
        {!shift && !record && <Alert>You have no shift assigned yet, so you can't check in. Please ask your admin to assign one.</Alert>}

        {running && (
          <div>
            <p className="text-xs font-medium text-slate-500">{onBreak ? 'Worked before this break' : 'Worked so far'}</p>
            <p data-testid="timer" className="mt-0.5 text-4xl font-bold tabular-nums">{formatClock(workedMs)}</p>
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          {!record && shift && (
            <Button disabled={busy} onClick={() => act('check-in')} className="inline-flex items-center gap-2 px-6 py-3 text-base">
              <LogIn size={20} aria-hidden /> Check in
            </Button>
          )}
          {running && !onBreak && (
            <SecondaryButton disabled={busy} onClick={() => act('break/start')} className="inline-flex items-center gap-2 py-3">
              <Coffee size={18} aria-hidden /> Start break
            </SecondaryButton>
          )}
          {running && onBreak && (
            <SecondaryButton disabled={busy} onClick={() => act('break/end')} className="inline-flex items-center gap-2 py-3">
              <Play size={18} aria-hidden /> End break
            </SecondaryButton>
          )}
          {running && (
            <Button disabled={busy} onClick={checkOut} className="inline-flex items-center gap-2 py-3">
              <LogOut size={18} aria-hidden /> Check out
            </Button>
          )}
        </div>

        {record && (
          <dl className="grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Check in" value={formatTime(record.checkInAt, timeZone)} />
            <Stat label="Check out" value={formatTime(record.checkOutAt, timeZone)} />
            <Stat label="Breaks" value={formatDuration(breakMinutes)} />
            <Stat label="Late by" value={record.lateMinutes ? formatDuration(record.lateMinutes) : '—'} />
            <Stat label="Worked" value={record.workedMinutes === null ? '—' : formatDuration(record.workedMinutes)} />
            <Stat label="Overtime" value={record.overtimeMinutes ? formatDuration(record.overtimeMinutes) : '—'} />
          </dl>
        )}
      </div>
    </section>
  );
}

export function Dashboard() {
  const { user } = useAuth();
  const isReviewer = !!user && user.role !== 'EMPLOYEE';
  const [today, setToday] = useState<Today | null>(null);
  const [recent, setRecent] = useState<AttendanceDay[] | null>(null);
  const [error, setError] = useState('');
  const [pendingApprovals, setPendingApprovals] = useState(0);

  const loadRecent = useCallback(
    () => api<{ days: AttendanceDay[] }>('/attendance/recent?days=14').then((res) => setRecent(res.days)),
    [],
  );

  const load = useCallback(() => {
    api<Today>('/attendance/today').then(setToday).catch((err: Error) => setError(err.message));
    loadRecent().catch((err: Error) => setError(err.message));
    if (isReviewer) api<{ count: number }>('/approvals').then((res) => setPendingApprovals(res.count)).catch(() => {});
  }, [loadRecent, isReviewer]);

  // Returning to the tab refreshes it, in case it was left open overnight or used elsewhere.
  useEffect(() => {
    load();
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load]);

  if (!user) return null;

  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight">Welcome back, {user.name}!</h1>
      <p className="mt-1 text-slate-600">Here's your attendance for today. All times are in India time.</p>

      <div className="mt-6 space-y-4">
        {error && <Alert>{error}</Alert>}
        {!!pendingApprovals && (
          <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
            You have {pendingApprovals} {pendingApprovals === 1 ? 'request' : 'requests'} waiting for your review.{' '}
            <Link to="/approvals" className="font-semibold underline">Review now</Link>
          </p>
        )}
        {today?.missedCheckOutDate && (
          <Alert>
            You didn't check out on {formatDay(today.missedCheckOutDate, { day: 'numeric', month: 'long' })}, so that day's hours
            haven't been counted.{' '}
            <Link to={`/timesheet?view=day&date=${today.missedCheckOutDate}&correct=1`} className="font-semibold underline">Request a correction</Link>
          </Alert>
        )}
        {!error && !today && <p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm">Loading your attendance…</p>}
        {today && (
          <TodayCard
            today={today}
            onChange={(updated) => {
              setToday(updated);
              loadRecent().catch((err: Error) => setError(err.message));
            }}
          />
        )}
      </div>

      {user.role !== 'EMPLOYEE' && <TeamToday />}

      {today && recent && (
        <section className="mt-8">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold">Last 14 days</h2>
            <Link to="/timesheet" className="text-sm font-medium text-brand-700 hover:underline">View full timesheet</Link>
          </div>
          <DayTable days={recent} timeZone={today.timeZone} />
        </section>
      )}
    </>
  );
}
