import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { CorrectionStatusBadge, type Correction, TimeRange } from '../components/attendance';
import { AlertStatusBadge, ExplainDialog, notifyChanged, resolutionLabel, type AlertList, type CheckoutAlert } from '../components/checkouts';
import { Alert, DataTable, RowAction } from '../components/ui';
import { formatDay, formatTime } from '../lib/time';

export function Requests() {
  const [corrections, setCorrections] = useState<Correction[] | null>(null);
  const [timeZone, setTimeZone] = useState('');
  const [error, setError] = useState('');
  const [alerts, setAlerts] = useState<AlertList | null>(null);
  const [alertsError, setAlertsError] = useState('');
  const [explaining, setExplaining] = useState<CheckoutAlert | null>(null);

  const loadAlerts = useCallback(() => {
    api<AlertList>('/forgotten-checkouts/mine').then(setAlerts).catch((err: Error) => setAlertsError(err.message));
  }, []);

  useEffect(loadAlerts, [loadAlerts]);

  const load = useCallback(async () => {
    const res = await api<{ timeZone: string; corrections: Correction[] }>('/corrections/mine');
    setTimeZone(res.timeZone);
    setCorrections(res.corrections);
  }, []);

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [load]);

  const cancel = async (c: Correction) => {
    if (!window.confirm(`Cancel your request for ${formatDay(c.date, { day: 'numeric', month: 'long' })}?`)) return;
    setError('');
    try {
      await api(`/corrections/${c.id}`, undefined, 'DELETE');
    } catch (err) {
      setError((err as Error).message);
    }
    await load().catch((err: Error) => setError(err.message));
  };

  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight">My requests</h1>
      <p className="mt-1 text-slate-600">
        Corrections you've asked for. To request a new one, open the day on your <Link to="/timesheet" className="font-medium text-brand-700 hover:underline">timesheet</Link>.
      </p>

      <div className="mt-6 space-y-4">
        {error && <Alert>{error}</Alert>}
        {!error && !corrections && <p className="text-sm text-slate-600">Loading…</p>}
        {corrections?.length === 0 && <p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">You haven't requested any corrections.</p>}
        {!!corrections?.length && (
          <DataTable headers={['Date', 'Status', 'Was', 'Requested', 'Reason', 'Response', 'Actions']}>
            {corrections.map((c) => (
              <tr key={c.id}>
                <td className="font-medium whitespace-nowrap">{formatDay(c.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</td>
                <td><CorrectionStatusBadge status={c.status} /></td>
                <td className="whitespace-nowrap"><TimeRange from={c.originalCheckInAt} to={c.originalCheckOutAt} timeZone={timeZone} /></td>
                <td className="whitespace-nowrap">
                  <TimeRange from={c.requestedCheckInAt} to={c.requestedCheckOutAt} timeZone={timeZone} />
                  <span className="block text-xs text-slate-500">{c.requestedBreakMinutes} min break</span>
                </td>
                <td className="max-w-56">{c.reason}</td>
                <td className="max-w-56">
                  {c.reviewer ? <span className="block text-xs text-slate-500">{c.reviewer}</span> : '—'}
                  {c.reviewNote}
                </td>
                <td>{c.status === 'PENDING' ? <RowAction danger onClick={() => cancel(c)}>Cancel</RowAction> : '—'}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </div>

      <h2 className="mt-10 text-lg font-bold">Missed check-outs</h2>
      <p className="mt-1 text-sm text-slate-600">Days you were reminded to check out after your shift ended.</p>
      <div className="mt-4 space-y-4">
        {alertsError && <Alert>{alertsError}</Alert>}
        {!alertsError && !alerts && <p className="text-sm text-slate-600">Loading…</p>}
        {alerts?.alerts.length === 0 && <p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">You haven't missed a check-out.</p>}
        {!!alerts?.alerts.length && (
          <DataTable headers={['Date', 'Shift ended', 'Reminders', 'Status', 'Your explanation', 'Actions']}>
            {alerts.alerts.map((a) => (
              <tr key={a.id}>
                <td className="font-medium whitespace-nowrap">{formatDay(a.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</td>
                <td className="whitespace-nowrap">{formatTime(a.scheduledEndAt, alerts.timeZone)}</td>
                <td className="tabular-nums">{a.alertCount}</td>
                <td>
                  <AlertStatusBadge status={a.status} />
                  {a.resolution && <span className="block text-xs text-slate-500">{resolutionLabel[a.resolution]}</span>}
                </td>
                <td className="max-w-64">{a.explanation ?? '—'}</td>
                <td>{a.canExplain ? <RowAction onClick={() => setExplaining(a)}>I already left</RowAction> : '—'}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </div>

      {explaining && (
        <ExplainDialog
          alert={explaining}
          onClose={() => setExplaining(null)}
          onDone={() => {
            setExplaining(null);
            notifyChanged();
            loadAlerts();
            load().catch((err: Error) => setError(err.message));
          }}
        />
      )}
    </>
  );
}
