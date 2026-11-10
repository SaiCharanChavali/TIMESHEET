import { Settings } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { AlertStatusBadge, eventLabel, notifyChanged, resolutionLabel, type AlertList, type CheckoutAlert } from '../components/checkouts';
import { ReasonDialog } from '../components/ReasonDialog';
import { Alert, DataTable, Modal, RowAction, SecondaryButton, Select } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { formatDateTime, formatDay, formatDuration, formatShiftTime, formatTime } from '../lib/time';

type StatusFilter = 'open' | 'resolved' | 'all';

function History({ alert, timeZone, onClose }: { alert: CheckoutAlert; timeZone: string; onClose: () => void }) {
  return (
    <Modal title={`${alert.employee.name}, ${formatDay(alert.date, { weekday: 'short', day: 'numeric', month: 'short' })}`} onClose={onClose}>
      <ol className="space-y-3 border-l-2 border-slate-200 pl-4 text-sm">
        {alert.events.map((e, i) => (
          <li key={i}>
            <span className="font-semibold">{eventLabel[e.type] ?? e.type}</span>
            {e.actor && <span className="text-slate-600"> by {e.actor}</span>}
            <span className="block text-xs text-slate-500">{formatDateTime(e.at, timeZone)}</span>
            {e.note && <span className="mt-0.5 block text-slate-700">{e.note.replace(/^Left at (\d\d:\d\d)$/, (_, t: string) => `Left at ${formatShiftTime(t)}`)}</span>}
          </li>
        ))}
      </ol>
      <div className="mt-5 flex justify-end">
        <SecondaryButton onClick={onClose}>Close</SecondaryButton>
      </div>
    </Modal>
  );
}

export function Checkouts() {
  const { user } = useAuth();
  const [status, setStatus] = useState<StatusFilter>('open');
  const [data, setData] = useState<AlertList | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<{ kind: 'escalate' | 'resolve'; alert: CheckoutAlert } | null>(null);
  const [history, setHistory] = useState<CheckoutAlert | null>(null);

  const canSeeTimesheets = user?.role === 'ADMIN' || user?.role === 'MANAGER';
  const canSeeSettings = user?.role === 'ADMIN' || user?.role === 'HR';

  const load = useCallback(async () => {
    setData(await api<AlertList>(`/forgotten-checkouts?status=${status}`));
  }, [status]);

  useEffect(() => {
    setData(null);
    load().catch((err: Error) => setError(err.message));
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load]);

  const remind = async (a: CheckoutAlert) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`/forgotten-checkouts/${a.id}/remind`, {});
      setNotice(`Reminder sent to ${a.employee.name}.`);
    } catch (err) {
      setError((err as Error).message);
    }
    await load().catch((err: Error) => setError(err.message));
    setBusy(false);
  };

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Missing check-outs</h1>
          <p className="mt-1 text-slate-600">People whose shift ended without a check-out. All times are in India time.</p>
        </div>
        {canSeeSettings && (
          <Link to="/checkouts/settings" className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <Settings size={16} aria-hidden /> Alert settings
          </Link>
        )}
      </div>

      <div className="mt-6 max-w-48">
        <Select label="Show" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
          <option value="all">All</option>
        </Select>
      </div>

      <div className="mt-4 space-y-4">
        {error && <Alert>{error}</Alert>}
        {notice && <Alert kind="success">{notice}</Alert>}
        {!error && !data && <p className="text-sm text-slate-600">Loading…</p>}
        {data && !data.alerts.length && (
          <p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
            {status === 'open' ? 'Everyone has checked out. Nothing needs attention.' : 'No missing check-outs found.'}
          </p>
        )}

        {!!data?.alerts.length && (
          <DataTable headers={['Employee', 'Date', 'Shift', 'Checked in', 'Missing for', 'Status', 'Alerts', 'Explanation', 'Actions']}>
            {data.alerts.map((a) => (
              <tr key={a.id}>
                <td className="whitespace-nowrap">
                  {canSeeTimesheets
                    ? <Link to={`/timesheet?user=${a.employee.id}&view=day&date=${a.date}`} className="font-medium text-brand-700 hover:underline">{a.employee.name}</Link>
                    : <span className="font-medium">{a.employee.name}</span>}
                  <span className="block text-xs text-slate-500">{a.employee.employeeCode}{a.employee.department ? ` · ${a.employee.department}` : ''}</span>
                </td>
                <td className="whitespace-nowrap">{formatDay(a.date, { weekday: 'short', day: 'numeric', month: 'short' })}</td>
                <td className="whitespace-nowrap">
                  {a.shift.name}
                  <span className="block text-xs text-slate-500">{formatShiftTime(a.shift.startTime)} to {formatShiftTime(a.shift.endTime)}</span>
                </td>
                <td className="whitespace-nowrap">{formatTime(a.checkInAt, data.timeZone)}</td>
                <td className="whitespace-nowrap">
                  {formatDuration(a.missingMinutes)}
                  {a.checkOutAt && <span className="block text-xs text-slate-500">Out at {formatTime(a.checkOutAt, data.timeZone)}</span>}
                </td>
                <td className="whitespace-nowrap">
                  <AlertStatusBadge status={a.status} />
                  {a.resolution && <span className="block text-xs text-slate-500">{resolutionLabel[a.resolution]}</span>}
                </td>
                <td className="whitespace-nowrap">
                  {a.alertCount}
                  {a.lastAlertAt && <span className="block text-xs text-slate-500">Last {formatDateTime(a.lastAlertAt, data.timeZone)}</span>}
                </td>
                <td className="max-w-56">{a.explanation ?? <span className="text-slate-400">—</span>}</td>
                <td>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {a.canAct && !a.checkOutAt && <RowAction disabled={busy} onClick={() => remind(a)}>Remind</RowAction>}
                    {a.canAct && a.status !== 'REQUIRES_HR_REVIEW' && (
                      <RowAction disabled={busy} onClick={() => setDialog({ kind: 'escalate', alert: a })}>Escalate to HR</RowAction>
                    )}
                    {a.canAct && <RowAction disabled={busy} onClick={() => setDialog({ kind: 'resolve', alert: a })}>Resolve</RowAction>}
                    <RowAction onClick={() => setHistory(a)}>History</RowAction>
                  </div>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </div>

      {dialog && (
        <ReasonDialog
          title={dialog.kind === 'escalate' ? `Escalate ${dialog.alert.employee.name}'s check-out to HR` : `Resolve ${dialog.alert.employee.name}'s check-out`}
          action={dialog.kind === 'escalate' ? 'Escalate' : 'Resolve'}
          label={dialog.kind === 'escalate' ? 'Note for HR' : 'How was it resolved?'}
          onClose={() => setDialog(null)}
          onSubmit={async (note) => {
            await api(`/forgotten-checkouts/${dialog.alert.id}/${dialog.kind}`, { note });
            setNotice(dialog.kind === 'escalate' ? 'Escalated to HR.' : 'Alert resolved.');
            setDialog(null);
            notifyChanged();
            await load();
          }}
        />
      )}
      {history && data && <History alert={history} timeZone={data.timeZone} onClose={() => setHistory(null)} />}
    </>
  );
}
