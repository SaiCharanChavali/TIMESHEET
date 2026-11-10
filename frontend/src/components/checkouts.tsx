import { useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { formatDay, formatDuration, formatShiftTime, formatTime } from '../lib/time';
import { TimeField } from './TimeField';
import { Alert, Button, Modal, SecondaryButton, TextArea } from './ui';

export type AlertStatus = 'AWAITING_CHECKOUT' | 'REMINDER_SENT' | 'ESCALATED' | 'REQUIRES_HR_REVIEW' | 'RESOLVED';

export interface CheckoutAlert {
  id: string;
  date: string;
  employee: { id: string; name: string; employeeCode: string; department: string | null };
  shift: { name: string; startTime: string; endTime: string };
  scheduledEndAt: string;
  checkInAt: string;
  checkOutAt: string | null;
  missingMinutes: number;
  status: AlertStatus;
  alertCount: number;
  lastAlertAt: string | null;
  explanation: string | null;
  explainedAt: string | null;
  resolution: 'CHECKED_OUT' | 'CORRECTED' | 'CLOSED' | null;
  resolvedAt: string | null;
  events: { type: string; actor: string | null; note: string | null; at: string }[];
  canAct?: boolean;
  canExplain?: boolean;
}

export interface AlertList {
  timeZone: string;
  alerts: CheckoutAlert[];
}

// Fired after anything that changes alerts or notifications, so the header and Home page refresh.
export const NOTIFICATIONS_CHANGED = 'notifications-changed';
export const notifyChanged = () => window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));

const statusStyle: Record<AlertStatus, { label: string; className: string }> = {
  AWAITING_CHECKOUT: { label: 'Waiting for check-out', className: 'bg-amber-100 text-amber-800' },
  REMINDER_SENT: { label: 'Reminded', className: 'bg-amber-100 text-amber-800' },
  ESCALATED: { label: 'With manager', className: 'bg-orange-100 text-orange-800' },
  REQUIRES_HR_REVIEW: { label: 'Needs HR review', className: 'bg-red-100 text-red-800' },
  RESOLVED: { label: 'Resolved', className: 'bg-green-100 text-green-800' },
};

export const resolutionLabel = { CHECKED_OUT: 'Checked out', CORRECTED: 'Correction approved', CLOSED: 'Closed by reviewer' } as const;

export function AlertStatusBadge({ status }: { status: AlertStatus }) {
  const { label, className } = statusStyle[status];
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${className}`}>{label}</span>;
}

export const eventLabel: Record<string, string> = {
  CREATED: 'Alert opened',
  REMINDER: 'Alert sent to employee',
  MANAGER_NOTIFIED: 'Manager notified',
  HR_NOTIFIED: 'HR notified',
  MANUAL_REMINDER: 'Reminder sent',
  ESCALATED_TO_HR: 'Escalated to HR',
  EXPLANATION: 'Employee explained',
  RESOLVED: 'Resolved',
};

// Lets an employee say what happened. Giving a leaving time raises a correction for their manager to approve.
export function ExplainDialog({ alert, onClose, onDone }: { alert: CheckoutAlert; onClose: () => void; onDone: () => void }) {
  const [explanation, setExplanation] = useState('');
  const [alreadyLeft, setAlreadyLeft] = useState(true);
  const [leftAt, setLeftAt] = useState(alert.shift.endTime);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api(`/forgotten-checkouts/${alert.id}/explanation`, { explanation, ...(alreadyLeft ? { leftAt } : {}) });
      notifyChanged();
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <Modal title={`Missing check-out on ${formatDay(alert.date, { weekday: 'short', day: 'numeric', month: 'short' })}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <p className="text-sm text-slate-600">
          Your shift ({alert.shift.name}, {formatShiftTime(alert.shift.startTime)} to {formatShiftTime(alert.shift.endTime)}) has ended, but there's no check-out.
        </p>
        <TextArea label="What happened?" required maxLength={470} rows={3} autoFocus value={explanation} onChange={(e) => setExplanation(e.target.value)} placeholder="For example: I left in a hurry and forgot to check out." />
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input type="checkbox" checked={alreadyLeft} onChange={(e) => setAlreadyLeft(e.target.checked)} className="size-4 accent-brand-600" />
          I've already left and know what time it was
        </label>
        {alreadyLeft && (
          <>
            <TimeField label="When did you leave?" value={leftAt} onChange={setLeftAt} />
            <p className="text-xs text-slate-500">This sends a correction request to your manager. The day is counted once they approve it.</p>
          </>
        )}
        <div className="flex justify-end gap-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <Button type="submit" disabled={submitting}>{submitting ? 'Sending…' : 'Send'}</Button>
        </div>
      </form>
    </Modal>
  );
}

// Shown on Home while the employee has an open alert.
// `openDay` is the day still open on the Home card, which can still be checked out of normally.
export function MyCheckoutAlerts({ data, openDay, onChange }: { data: AlertList; openDay?: string; onChange: () => void }) {
  const [explaining, setExplaining] = useState<CheckoutAlert | null>(null);
  const open = data.alerts.filter((a) => a.status !== 'RESOLVED');
  if (!open.length) return null;

  return (
    <section aria-label="Missing check-outs" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
      <h2 className="font-bold">You haven't checked out</h2>
      <ul className="mt-2 space-y-3">
        {open.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <span>
              <span className="font-semibold">{formatDay(a.date, { weekday: 'short', day: 'numeric', month: 'short' })}</span>: your shift ({a.shift.name}) ended at{' '}
              {formatTime(a.scheduledEndAt, data.timeZone)}, {formatDuration(a.missingMinutes)} ago.
              {a.explanation && <span className="block text-amber-800">Sent to your manager for review. You said: “{a.explanation}”</span>}
            </span>
            {a.canExplain && (
              <button type="button" onClick={() => setExplaining(a)} className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-semibold text-amber-900 hover:bg-amber-100">
                I already left
              </button>
            )}
          </li>
        ))}
      </ul>
      {open.some((a) => a.date === openDay) && <p className="mt-3 text-xs text-amber-800">Still at work? Check out below as usual.</p>}
      {explaining && (
        <ExplainDialog alert={explaining} onClose={() => setExplaining(null)} onDone={() => { setExplaining(null); onChange(); }} />
      )}
    </section>
  );
}
