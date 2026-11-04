import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { APPROVALS_CHANGED, StatusBadge, TimeRange, type Correction } from '../components/attendance';
import { ReasonDialog } from '../components/ReasonDialog';
import { Alert, DataTable, RowAction } from '../components/ui';
import { formatDay, formatDuration } from '../lib/time';

type PendingCorrection = Correction & { outcome: { status: string; workedMinutes: number } | null };

interface PendingTimesheet {
  id: string;
  month: string;
  employee: { id: string; name: string; employeeCode: string };
  submittedAt: string;
  workedMinutes: number;
  overtimeMinutes: number;
}

interface ApprovalsData {
  timeZone: string;
  corrections: PendingCorrection[];
  timesheets: PendingTimesheet[];
  count: number;
}

const monthLabel = (month: string) => formatDay(`${month}-01`, { month: 'long', year: 'numeric' });

export function Approvals() {
  const [data, setData] = useState<ApprovalsData | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState<{ path: string; title: string } | null>(null);

  const load = useCallback(async () => {
    setData(await api<ApprovalsData>('/approvals'));
    window.dispatchEvent(new Event(APPROVALS_CHANGED));
  }, []);

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [load]);

  const approve = async (path: string) => {
    setBusy(true);
    setError('');
    try {
      await api(`${path}/approve`, {});
    } catch (err) {
      // Usually someone else got there first, so the refreshed list below shows the true state.
      setError((err as Error).message);
    }
    await load().catch((err: Error) => setError(err.message));
    setBusy(false);
  };

  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight">Approvals</h1>
      <p className="mt-1 text-slate-600">Requests waiting for your review. All times are in India time.</p>

      <div className="mt-6 space-y-8">
        {error && <Alert>{error}</Alert>}
        {!error && !data && <p className="text-sm text-slate-600">Loading…</p>}
        {data?.count === 0 && <p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">Nothing is waiting for your review.</p>}

        {!!data?.corrections.length && (
          <section>
            <h2 className="mb-3 text-lg font-bold">Corrections ({data.corrections.length})</h2>
            <DataTable headers={['Employee', 'Date', 'Was', 'Requested', 'Result if approved', 'Reason', 'Actions']}>
              {data.corrections.map((c) => (
                <tr key={c.id}>
                  <td className="whitespace-nowrap">
                    <Link to={`/timesheet?user=${c.employee.id}&view=day&date=${c.date}`} className="font-medium text-brand-700 hover:underline">{c.employee.name}</Link>
                    <span className="block text-xs text-slate-500">{c.employee.employeeCode}</span>
                  </td>
                  <td className="whitespace-nowrap">{formatDay(c.date, { weekday: 'short', day: 'numeric', month: 'short' })}</td>
                  <td className="whitespace-nowrap"><TimeRange from={c.originalCheckInAt} to={c.originalCheckOutAt} timeZone={data.timeZone} /></td>
                  <td className="whitespace-nowrap">
                    <TimeRange from={c.requestedCheckInAt} to={c.requestedCheckOutAt} timeZone={data.timeZone} />
                    <span className="block text-xs text-slate-500">{c.requestedBreakMinutes} min break</span>
                  </td>
                  <td className="whitespace-nowrap">
                    {c.outcome ? <><StatusBadge status={c.outcome.status} /><span className="block text-xs text-slate-500">{formatDuration(c.outcome.workedMinutes)} worked</span></> : '—'}
                  </td>
                  <td className="max-w-56">{c.reason}</td>
                  <td>
                    <div className="flex gap-3">
                      <RowAction disabled={busy} onClick={() => approve(`/corrections/${c.id}`)}>Approve</RowAction>
                      <RowAction danger disabled={busy} onClick={() => setRejecting({ path: `/corrections/${c.id}`, title: `Reject ${c.employee.name}'s correction` })}>Reject</RowAction>
                    </div>
                  </td>
                </tr>
              ))}
            </DataTable>
          </section>
        )}

        {!!data?.timesheets.length && (
          <section>
            <h2 className="mb-3 text-lg font-bold">Monthly timesheets ({data.timesheets.length})</h2>
            <DataTable headers={['Employee', 'Month', 'Hours worked', 'Overtime', 'Actions']}>
              {data.timesheets.map((t) => (
                <tr key={t.id}>
                  <td className="whitespace-nowrap">
                    <span className="font-medium">{t.employee.name}</span>
                    <span className="block text-xs text-slate-500">{t.employee.employeeCode}</span>
                  </td>
                  <td className="whitespace-nowrap">
                    <Link to={`/timesheet?user=${t.employee.id}&view=month&date=${t.month}-01`} className="font-medium text-brand-700 hover:underline">{monthLabel(t.month)}</Link>
                  </td>
                  <td>{formatDuration(t.workedMinutes)}</td>
                  <td>{formatDuration(t.overtimeMinutes)}</td>
                  <td>
                    <div className="flex gap-3">
                      <RowAction disabled={busy} onClick={() => approve(`/timesheets/${t.id}`)}>Approve</RowAction>
                      <RowAction danger disabled={busy} onClick={() => setRejecting({ path: `/timesheets/${t.id}`, title: `Reject ${t.employee.name}'s ${monthLabel(t.month)} timesheet` })}>Reject</RowAction>
                    </div>
                  </td>
                </tr>
              ))}
            </DataTable>
          </section>
        )}
      </div>

      {rejecting && (
        <ReasonDialog
          title={rejecting.title}
          action="Reject"
          onClose={() => setRejecting(null)}
          onSubmit={async (note) => {
            await api(`${rejecting.path}/reject`, { note });
            setRejecting(null);
            await load();
          }}
        />
      )}
    </>
  );
}
