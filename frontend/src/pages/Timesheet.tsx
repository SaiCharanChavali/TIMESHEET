import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { DayTable, StatTile, type AttendanceDay } from '../components/attendance';
import { CorrectionDialog } from '../components/CorrectionDialog';
import { ReasonDialog } from '../components/ReasonDialog';
import { Alert, Button, RowAction, SecondaryButton, Select } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { addDays, formatDay, formatDuration, formatShiftTime, formatTime } from '../lib/time';

type View = 'day' | 'week' | 'month';

function TaskEntries({ entries, date, timeZone, canEdit, onSaved }: {
  entries: { slotStartAt: string; task: string }[];
  date: string;
  timeZone: string;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [tasks, setTasks] = useState(entries);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  useEffect(() => setTasks(entries), [entries]);

  if (!entries.length) return null;
  const save = async (entry: { slotStartAt: string; task: string }) => {
    setSaving(entry.slotStartAt);
    setError('');
    try {
      await api('/attendance/task-entry', { date, slotStartAt: entry.slotStartAt, task: entry.task }, 'PUT');
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(null);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
      <h2 className="font-semibold">Hourly tasks</h2>
      {error && <div className="mt-2"><Alert>{error}</Alert></div>}
      <div className="mt-3 space-y-3">
        {tasks.map((entry) => {
          const start = new Date(entry.slotStartAt);
          const end = new Date(start.getTime() + 60 * 60 * 1000).toISOString();
          return (
            <div key={entry.slotStartAt} className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
              <label className="block text-sm font-medium text-slate-700">
                {formatTime(entry.slotStartAt, timeZone)}–{formatTime(end, timeZone)}
                <input
                  value={entry.task}
                  disabled={!canEdit || saving === entry.slotStartAt}
                  maxLength={200}
                  onChange={(e) => setTasks((current) => current.map((item) => item.slotStartAt === entry.slotStartAt ? { ...item, task: e.target.value } : item))}
                  className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal text-navy outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20 disabled:bg-slate-50"
                />
              </label>
              {canEdit && <SecondaryButton disabled={saving === entry.slotStartAt || !entry.task.trim()} onClick={() => save(entry)}>{saving === entry.slotStartAt ? 'Saving…' : 'Save'}</SecondaryButton>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

interface TimesheetData {
  timeZone: string;
  today: string;
  view: View;
  from: string;
  to: string;
  employee: { id: string; name: string; employeeCode: string };
  shift: { startTime: string; endTime: string } | null;
  days: AttendanceDay[];
  blockers: string[];
  submission: {
    id: string;
    status: 'SUBMITTED' | 'APPROVED' | 'REJECTED';
    submittedAt: string;
    reviewer: string | null;
    reviewedAt: string | null;
    reviewNote: string | null;
  } | null;
  totals: {
    workedMinutes: number;
    overtimeMinutes: number;
    lateMinutes: number;
    present: number;
    late: number;
    halfDay: number;
    absent: number;
    missingCheckOut: number;
  };
}

const VIEWS: { value: View; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

function periodLabel({ view, from, to }: TimesheetData) {
  if (view === 'day') return formatDay(from, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  if (view === 'month') return formatDay(from, { month: 'long', year: 'numeric' });
  return `${formatDay(from, { day: 'numeric', month: 'short' })} – ${formatDay(to, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

const submissionText = {
  SUBMITTED: { title: 'Submitted', detail: 'Waiting for review. This month is locked until then.', className: 'border-blue-200 bg-blue-50 text-blue-900' },
  APPROVED: { title: 'Approved', detail: 'This month is locked.', className: 'border-green-200 bg-green-50 text-green-900' },
  REJECTED: { title: 'Sent back', detail: 'Make any corrections needed, then submit it again.', className: 'border-red-200 bg-red-50 text-red-900' },
};

function MonthPanel({ data, viewingSelf, isAdmin, onChanged }: { data: TimesheetData; viewingSelf: boolean; isAdmin: boolean; onChanged: () => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reopening, setReopening] = useState(false);
  const { submission } = data;
  const month = data.from.slice(0, 7);
  const label = formatDay(data.from, { month: 'long', year: 'numeric' });

  const act = async (path: string, confirmText: string) => {
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    setError('');
    try {
      await api(path, { month });
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const text = submission && submissionText[submission.status];
  const canSubmit = viewingSelf && (!submission || submission.status === 'REJECTED');

  return (
    <section data-testid="month-panel" className={`rounded-2xl border p-4 text-sm ${text?.className ?? 'border-slate-200 bg-white'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-bold">{label}: {text?.title ?? 'Not submitted'}</h2>
          {text && <p className="mt-0.5">{text.detail}</p>}
          {submission?.reviewer && submission.reviewNote && <p className="mt-1">{submission.reviewer}: "{submission.reviewNote}"</p>}
          {submission?.reviewer && !submission.reviewNote && <p className="mt-1">Reviewed by {submission.reviewer}.</p>}
          {canSubmit && data.blockers.length > 0 && (
            <ul className="mt-1 text-slate-700">{data.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
          )}
        </div>
        <div className="flex gap-2">
          {canSubmit && (
            <Button disabled={busy || data.blockers.length > 0} onClick={() => act('/timesheets/submit', `Submit your ${label} timesheet? You can't request corrections for this month while it's being reviewed.`)}>
              Submit month
            </Button>
          )}
          {viewingSelf && submission?.status === 'SUBMITTED' && (
            <SecondaryButton disabled={busy} onClick={() => act('/timesheets/withdraw', `Withdraw your ${label} timesheet?`)}>Withdraw</SecondaryButton>
          )}
          {isAdmin && submission?.status === 'APPROVED' && (
            <SecondaryButton onClick={() => setReopening(true)}>Reopen</SecondaryButton>
          )}
        </div>
      </div>
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
      {reopening && submission && (
        <ReasonDialog
          title={`Reopen ${data.employee.name}'s ${label} timesheet`}
          action="Reopen"
          onClose={() => setReopening(false)}
          onSubmit={async (note) => {
            await api(`/timesheets/${submission.id}/reopen`, { note });
            setReopening(false);
            onChanged();
          }}
        />
      )}
    </section>
  );
}

export function Timesheet() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const view = (['day', 'week', 'month'].includes(params.get('view') ?? '') ? params.get('view') : 'month') as View;
  const date = params.get('date') ?? '';
  const userId = params.get('user') ?? '';
  const openCorrection = params.get('correct') === '1';

  const [data, setData] = useState<TimesheetData | null>(null);
  const [people, setPeople] = useState<{ id: string; name: string; employeeCode: string }[]>([]);
  const [error, setError] = useState('');
  const [correcting, setCorrecting] = useState<AttendanceDay | null>(null);
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((n) => n + 1), []);

  // HR only reviews check-out alerts, so like employees they see just their own timesheet.
  const canViewOthers = user?.role === 'ADMIN' || user?.role === 'MANAGER';

  useEffect(() => {
    if (!canViewOthers) return;
    api<{ users: { id: string; name: string; employeeCode: string }[] }>('/users')
      .then((res) => setPeople(res.users.filter((u) => u.id !== user?.id)))
      .catch((err: Error) => setError(err.message));
  }, [canViewOthers, user?.id]);

  useEffect(() => {
    // Ignores a slow reply that arrives after someone has already moved to another period.
    let current = true;
    const query = new URLSearchParams({ view });
    if (date) query.set('date', date);
    if (userId) query.set('userId', userId);
    setError('');
    api<TimesheetData>(`/attendance/timesheet?${query}`)
      .then((res) => { if (current) setData(res); })
      .catch((err: Error) => { if (current) { setData(null); setError(err.message); } });
    return () => { current = false; };
  }, [view, date, userId, refresh]);

  // Arriving from the "you didn't check out" warning on Home opens the form straight away.
  useEffect(() => {
    if (!openCorrection || !data || data.view !== 'day' || data.from !== date) return;
    const day = data.days[0];
    if (day && !day.locked && !day.pendingCorrection && data.employee.id === user?.id) setCorrecting(day);
    const next = new URLSearchParams(params);
    next.delete('correct');
    setParams(next, { replace: true });
  }, [openCorrection, data, date, params, setParams, user?.id]);

  const update = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next);
  };

  // Switching view stays around the same date rather than jumping back to today.
  const anchor = date || data?.today || '';
  const canGoNext = !!data && data.to < data.today;
  const viewingSelf = !data || data.employee.id === user?.id;

  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight">{viewingSelf ? 'My timesheet' : `${data.employee.name}'s timesheet`}</h1>
      <p className="mt-1 text-slate-600">{viewingSelf ? 'Your attendance and hours.' : `Employee code ${data.employee.employeeCode}.`} All times are in India time.</p>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <div role="group" aria-label="View" className="flex rounded-lg border border-slate-300 bg-white p-0.5">
            {VIEWS.map((v) => (
              <button
                key={v.value}
                aria-pressed={view === v.value}
                onClick={() => update({ view: v.value, date: anchor })}
                className={`rounded-md px-4 py-1.5 text-sm font-semibold ${view === v.value ? 'bg-brand-50 text-brand-600' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                {v.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <SecondaryButton aria-label="Previous period" disabled={!data} onClick={() => data && update({ date: addDays(data.from, -1) })} className="px-2!">
              <ChevronLeft size={18} aria-hidden />
            </SecondaryButton>
            <SecondaryButton aria-label="Next period" disabled={!canGoNext} onClick={() => data && update({ date: addDays(data.to, 1) })} className="px-2!">
              <ChevronRight size={18} aria-hidden />
            </SecondaryButton>
            <SecondaryButton onClick={() => update({ date: '' })}>Today</SecondaryButton>
          </div>
          {data && <p data-testid="period" className="pb-2 font-semibold">{periodLabel(data)}</p>}
        </div>
        {canViewOthers && (
          <div className="w-60">
            <Select label="Employee" value={userId} onChange={(e) => update({ user: e.target.value })}>
              <option value="">Me</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.employeeCode})</option>)}
            </Select>
          </div>
        )}
      </div>

      <div className="mt-5 space-y-5">
        {error && <Alert>{error}</Alert>}
        {!error && !data && <p className="text-sm text-slate-600">Loading…</p>}
        {data && (
          <>
            {view !== 'day' && (
              <dl data-testid="totals" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
                <StatTile label="Hours worked" value={formatDuration(data.totals.workedMinutes)} />
                <StatTile label="Overtime" value={formatDuration(data.totals.overtimeMinutes)} />
                <StatTile label="Days present" value={data.totals.present} note={data.totals.late ? `Including ${data.totals.late} late` : undefined} />
                <StatTile label="Half days" value={data.totals.halfDay} />
                <StatTile label="Absent" value={data.totals.absent} />
                <StatTile label="No check-out" value={data.totals.missingCheckOut} note={data.totals.missingCheckOut ? 'Hours not counted' : undefined} />
              </dl>
            )}
            {view === 'month' && (
              <MonthPanel data={data} viewingSelf={viewingSelf} isAdmin={user?.role === 'ADMIN'} onChanged={reload} />
            )}
            {data.days.length === 0 ? (
              <p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">No attendance to show for this period.</p>
            ) : (
              <DayTable
                days={data.days}
                timeZone={data.timeZone}
                renderAction={viewingSelf ? (day) => {
                  if (day.pendingCorrection) return <span className="text-xs font-semibold text-blue-800">Fix requested</span>;
                  if (day.locked) return <span className="text-xs text-slate-500">Locked</span>;
                  return <RowAction onClick={() => setCorrecting(day)}>Correct</RowAction>;
                } : undefined}
              />
            )}
            {view === 'day' && !!data.days[0]?.record && ((data.days[0].record?.breaks.length ?? 0) > 0 || (data.days[0].record?.breakMinutes ?? 0) > 0) && (
              <section className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
                <h2 className="font-semibold">Breaks</h2>
                {data.days[0].record?.breaks.length ? <ul className="mt-1 text-slate-700">
                  {data.days[0].record.breaks.map((b) => (
                    <li key={b.startAt}>{formatTime(b.startAt, data.timeZone)} to {b.endAt ? formatTime(b.endAt, data.timeZone) : 'now'}</li>
                  ))}
                </ul> : <p className="mt-1 text-slate-700">Automatic deduction: {formatDuration(data.days[0].record?.breakMinutes ?? 0)}{data.days[0].record?.breakStartTime ? ` (planned around ${formatShiftTime(data.days[0].record.breakStartTime)})` : ''}.</p>}
              </section>
            )}
            {view === 'day' && data.days[0]?.record?.taskEntries.length ? (
              <TaskEntries
                entries={data.days[0].record.taskEntries}
                date={data.days[0].date}
                timeZone={data.timeZone}
                canEdit={viewingSelf && !data.days[0].locked}
                onSaved={reload}
              />
            ) : null}
          </>
        )}
      </div>
      {correcting && data && (
        <CorrectionDialog
          day={correcting}
          timeZone={data.timeZone}
          shift={data.shift}
          onClose={() => setCorrecting(null)}
          onSaved={() => {
            setCorrecting(null);
            reload();
          }}
        />
      )}
    </>
  );
}
