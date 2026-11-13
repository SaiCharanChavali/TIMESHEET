import { LogIn, LogOut } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { DayTable, StatusBadge, TeamToday, type AttendanceDay, type DayRecord } from '../components/attendance';
import { MyCheckoutAlerts, NOTIFICATIONS_CHANGED, notifyChanged, type AlertList } from '../components/checkouts';
import { Alert, Button, Field, SecondaryButton } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { formatDay, formatDuration, formatShiftTime, formatTime } from '../lib/time';

interface Today {
  now: string;
  timeZone: string;
  date: string;
  shift: { name: string; startTime: string; endTime: string; breakStartTime: string | null; breakMinutes: number; breakAfterMinutes: number } | null;
  holiday: string | null;
  weeklyOff: boolean;
  record: DayRecord | null;
  missedCheckOutDate: string | null;
  taskSlots: { slotStartAt: string; slotEndAt: string; task: string; savedTask: string }[];
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
  if (record.breaks.length) return record.breaks.reduce((sum, b) => sum + ((b.endAt ? new Date(b.endAt).getTime() : now) - new Date(b.startAt).getTime()), 0);
  const elapsed = now - new Date(record.checkInAt).getTime();
  return record.breakRuleMinutes > 0 && elapsed >= record.breakAfterMinutes * 60000 ? record.breakRuleMinutes * 60000 : 0;
}

function TodayCard({ today, onChange }: { today: Today; onChange: (t: Today) => void }) {
  const { record, shift, timeZone } = today;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [taskDrafts, setTaskDrafts] = useState<Record<string, string>>({});
  // The timer follows the server's clock, in case this computer's clock is wrong.
  const [clockOffset] = useState(() => new Date(today.now).getTime() - Date.now());
  const [now, setNow] = useState(() => Date.now() + clockOffset);

  const running = !!record && !record.checkOutAt;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now() + clockOffset), 1000);
    return () => clearInterval(id);
  }, [running, clockOffset]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      api<Today>('/attendance/today').then(onChange).catch(() => {});
    }, 60_000);
    return () => clearInterval(id);
  }, [running, onChange]);

  useEffect(() => {
    setTaskDrafts((current) => {
      if (today.record?.checkOutAt) return {};
      const next = { ...current };
      for (const slot of today.taskSlots) if (!(slot.slotStartAt in next)) next[slot.slotStartAt] = slot.task;
      return next;
    });
  }, [today.taskSlots, today.record?.checkOutAt]);

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

  const taskValue = (slotStartAt: string, saved: string) => taskDrafts[slotStartAt] ?? saved;

  const saveTask = async (slotStartAt: string, task: string) => {
    if (!record || !task.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api('/attendance/task-entry', { date: record.date, slotStartAt, task }, 'PUT');
      const updated = await api<Today>('/attendance/today');
      setTaskDrafts((current) => { const next = { ...current }; delete next[slotStartAt]; return next; });
      onChange(updated);
    } catch (err) {
      setError((err as Error).message);
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
  const breakPolicy = record
    ? { startTime: record.breakStartTime, minutes: record.breakRuleMinutes, afterMinutes: record.breakAfterMinutes }
    : shift ? { startTime: shift.breakStartTime, minutes: shift.breakMinutes, afterMinutes: shift.breakAfterMinutes } : null;
  const missingTasks = today.taskSlots.filter((slot) => {
    const task = taskValue(slot.slotStartAt, slot.task);
    return !task.trim() || task !== slot.savedTask;
  }).length;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{formatDay(today.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</h2>
          <p className="mt-0.5 text-sm text-slate-600">
            {shift ? `${shift.name}, ${formatShiftTime(shift.startTime)} to ${formatShiftTime(shift.endTime)}` : 'No shift assigned'}
          </p>
          {breakPolicy?.minutes ? <p className="mt-1 text-xs text-slate-500">Planned break {breakPolicy.startTime ? `around ${formatShiftTime(breakPolicy.startTime)}, ` : ''}{formatDuration(breakPolicy.minutes)} deducted after {formatDuration(breakPolicy.afterMinutes)} attendance.</p> : null}
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
          {running && (
            <Button disabled={busy || missingTasks > 0} onClick={checkOut} className="inline-flex items-center gap-2 py-3">
              <LogOut size={18} aria-hidden /> Check out
            </Button>
          )}
        </div>

        {running && today.taskSlots.length > 0 && (
          <section className="border-t border-slate-100 pt-4">
            <h3 className="font-semibold">Hourly task log</h3>
            <p className="mt-1 text-xs text-slate-500">Enter the task for each hour. Complete every listed slot before checking out.</p>
            <div className="mt-3 space-y-3">
              {today.taskSlots.map((slot) => (
                <div key={slot.slotStartAt} className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                  <Field
                    label={`${formatTime(slot.slotStartAt, timeZone)}–${formatTime(slot.slotEndAt, timeZone)}`}
                    maxLength={200}
                    placeholder="What did you work on?"
                    value={taskValue(slot.slotStartAt, slot.task)}
                    onChange={(e) => setTaskDrafts((current) => ({ ...current, [slot.slotStartAt]: e.target.value }))}
                  />
                  <SecondaryButton disabled={busy || !taskValue(slot.slotStartAt, slot.task).trim() || taskValue(slot.slotStartAt, slot.task) === slot.savedTask} onClick={() => saveTask(slot.slotStartAt, taskValue(slot.slotStartAt, slot.task))}>
                    Save hour
                  </SecondaryButton>
                </div>
              ))}
            </div>
            {missingTasks > 0 && <p className="mt-2 text-sm font-medium text-amber-800">Save {missingTasks} task {missingTasks === 1 ? 'entry' : 'entries'} to check out.</p>}
          </section>
        )}

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
  const isReviewer = user?.role === 'ADMIN' || user?.role === 'MANAGER';
  const [today, setToday] = useState<Today | null>(null);
  const [myAlerts, setMyAlerts] = useState<AlertList | null>(null);
  const [recent, setRecent] = useState<AttendanceDay[] | null>(null);
  const [error, setError] = useState('');
  const [pendingApprovals, setPendingApprovals] = useState(0);

  const loadRecent = useCallback(
    () => api<{ days: AttendanceDay[] }>('/attendance/recent?days=14').then((res) => setRecent(res.days)),
    [],
  );

  const loadAlerts = useCallback(() => {
    api<AlertList>('/forgotten-checkouts/mine').then(setMyAlerts).catch(() => {});
  }, []);

  const load = useCallback(() => {
    api<Today>('/attendance/today').then(setToday).catch((err: Error) => setError(err.message));
    loadRecent().catch((err: Error) => setError(err.message));
    loadAlerts();
    if (isReviewer) api<{ count: number }>('/approvals').then((res) => setPendingApprovals(res.count)).catch(() => {});
  }, [loadRecent, loadAlerts, isReviewer]);

  // Returning to the tab refreshes it, in case it was left open overnight or used elsewhere.
  useEffect(() => {
    load();
    window.addEventListener('focus', load);
    window.addEventListener(NOTIFICATIONS_CHANGED, loadAlerts);
    return () => {
      window.removeEventListener('focus', load);
      window.removeEventListener(NOTIFICATIONS_CHANGED, loadAlerts);
    };
  }, [load, loadAlerts]);

  if (!user) return null;
  // The older banner is hidden for a day that already has an alert above, so the same day isn't raised twice.
  const alertDays = new Set(myAlerts?.alerts.filter((a) => a.status !== 'RESOLVED').map((a) => a.date));
  const openDay = today?.record && !today.record.checkOutAt ? today.record.date : undefined;

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
        {myAlerts && <MyCheckoutAlerts data={myAlerts} openDay={openDay} onChange={load} />}
        {today?.missedCheckOutDate && !alertDays.has(today.missedCheckOutDate) && (
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
              // Checking out resolves any alert for the day.
              loadAlerts();
              notifyChanged();
            }}
          />
        )}
      </div>

      {isReviewer && <TeamToday />}

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
