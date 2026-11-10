import { ArrowLeft } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { Alert, Button, SecondaryButton } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { formatDateTime } from '../lib/time';

interface Settings {
  enabled: boolean;
  alertAfterMinutes: number;
  repeatReminders: boolean;
  reminderIntervalMinutes: number;
  maxReminders: number;
  notifyEmployee: boolean;
  notifyManager: boolean;
  managerAfterMinutes: number;
  notifyHr: boolean;
  hrAfterMinutes: number;
  sendEmail: boolean;
}

interface SettingsResponse {
  settings: Settings & { updatedAt: string };
  emailConfigured: boolean;
  job: { lastFinishedAt: string | null; lastError: string | null; lastSummary: Record<string, number> | null } | null;
}

const FIELDS: (keyof Settings)[] = [
  'enabled', 'alertAfterMinutes', 'repeatReminders', 'reminderIntervalMinutes', 'maxReminders',
  'notifyEmployee', 'notifyManager', 'managerAfterMinutes', 'notifyHr', 'hrAfterMinutes', 'sendEmail',
];
const pick = (s: Settings): Settings => Object.fromEntries(FIELDS.map((k) => [k, s[k]])) as unknown as Settings;

function Toggle({ label, hint, checked, disabled, onChange }: { label: string; hint?: string; checked: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-3">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 accent-brand-600" />
      <span>
        <span className="block text-sm font-semibold text-slate-800">{label}</span>
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      </span>
    </label>
  );
}

function Minutes({ label, value, min, max, disabled, suffix = 'minutes', onChange }: {
  label: string; value: number; min: number; max: number; disabled: boolean; suffix?: string; onChange: (v: number) => void;
}) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <span className="mt-1 flex items-center gap-2">
        <input
          type="number" min={min} max={max} step={1} required value={value} disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          className="block w-28 rounded-lg border border-slate-300 bg-white px-3 py-2 text-navy outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20 disabled:bg-slate-50"
        />
        <span className="text-slate-500">{suffix}</span>
      </span>
    </label>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6">
      <h2 className="text-lg font-bold">{title}</h2>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

const count = (n: number | undefined, one: string, many: string) => `${n ?? 0} ${n === 1 ? one : many}`;
const summaryText = (s: Record<string, number>) =>
  `Checked ${count(s.checked, 'open day', 'open days')}, opened ${count(s.alertsCreated, 'alert', 'alerts')}, ` +
  `queued ${count(s.notificationsQueued, 'notification', 'notifications')}, resolved ${s.resolved ?? 0}${s.failed ? `, ${s.failed} failed` : ''}.`;

export function CheckoutSettings() {
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN';
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [form, setForm] = useState<Settings | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  const apply = (res: SettingsResponse) => {
    setData(res);
    setForm(pick(res.settings));
  };

  useEffect(() => {
    api<SettingsResponse>('/forgotten-checkouts/settings').then(apply).catch((err: Error) => setError(err.message));
  }, []);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setForm((f) => f && { ...f, [key]: value });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      apply(await api<SettingsResponse>('/forgotten-checkouts/settings', form, 'PUT'));
      setNotice('Settings saved.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const runNow = async () => {
    setRunning(true);
    setError('');
    setNotice('');
    try {
      const res = await api<{ summary?: Record<string, number>; error?: string }>('/forgotten-checkouts/run', {});
      if (res.error) setError(`The check failed: ${res.error}`);
      else if (res.summary) setNotice(summaryText(res.summary));
      api<SettingsResponse>('/forgotten-checkouts/settings').then(setData).catch(() => {});
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const off = !canEdit;

  return (
    <>
      <Link to="/checkouts" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
        <ArrowLeft size={16} aria-hidden /> Missing check-outs
      </Link>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Check-out alert settings</h1>
      <p className="mt-1 text-slate-600">
        When and to whom alerts go after a shift ends without a check-out. All times count from the end of the shift.
        {!canEdit && ' Only admins can change these.'}
      </p>

      <div className="mt-6 max-w-3xl space-y-4">
        {error && <Alert>{error}</Alert>}
        {notice && <Alert kind="success">{notice}</Alert>}
        {!error && !form && <p className="text-sm text-slate-600">Loading…</p>}

        {form && data && (
          <form onSubmit={save} className="space-y-4">
            <Card title="Alerts">
              <Toggle label="Send forgotten check-out alerts" hint="When off, nothing new is sent. Open alerts still resolve when people check out." checked={form.enabled} disabled={off} onChange={(v) => set('enabled', v)} />
              <Minutes label="First alert after the shift ends" value={form.alertAfterMinutes} min={0} max={720} disabled={off} onChange={(v) => set('alertAfterMinutes', v)} />
            </Card>

            <Card title="Employee">
              <Toggle label="Alert the employee" checked={form.notifyEmployee} disabled={off} onChange={(v) => set('notifyEmployee', v)} />
              <Toggle label="Repeat reminders until they respond" checked={form.repeatReminders} disabled={off || !form.notifyEmployee} onChange={(v) => set('repeatReminders', v)} />
              {form.repeatReminders && form.notifyEmployee && (
                <div className="flex flex-wrap gap-6">
                  <Minutes label="Every" value={form.reminderIntervalMinutes} min={5} max={720} disabled={off} onChange={(v) => set('reminderIntervalMinutes', v)} />
                  <Minutes label="Up to" value={form.maxReminders} min={1} max={20} suffix="alerts in total" disabled={off} onChange={(v) => set('maxReminders', v)} />
                </div>
              )}
            </Card>

            <Card title="Escalation">
              <Toggle label="Tell the employee's manager" checked={form.notifyManager} disabled={off} onChange={(v) => set('notifyManager', v)} />
              {form.notifyManager && <Minutes label="After" value={form.managerAfterMinutes} min={0} max={2880} disabled={off} onChange={(v) => set('managerAfterMinutes', v)} />}
              <Toggle label="Tell HR" hint="If there are no HR users, admins are told instead." checked={form.notifyHr} disabled={off} onChange={(v) => set('notifyHr', v)} />
              {form.notifyHr && <Minutes label="After" value={form.hrAfterMinutes} min={0} max={2880} disabled={off} onChange={(v) => set('hrAfterMinutes', v)} />}
            </Card>

            <Card title="Email">
              <Toggle label="Also send alerts by email" hint="Notifications always appear in the app." checked={form.sendEmail} disabled={off} onChange={(v) => set('sendEmail', v)} />
              {!data.emailConfigured && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  No email server is set up, so emails aren't being sent. Ask whoever runs the server to set SMTP_HOST.
                </p>
              )}
            </Card>

            {canEdit && (
              <div className="flex justify-end">
                <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</Button>
              </div>
            )}
          </form>
        )}

        {data && (
          <Card title="Background check">
            <p className="text-sm text-slate-600">
              The server checks for missing check-outs automatically, every minute by default.
              {data.job?.lastFinishedAt ? ` Last run: ${formatDateTime(data.job.lastFinishedAt, 'Asia/Kolkata')}.` : ' It hasn’t run yet.'}
            </p>
            {data.job?.lastSummary && !data.job.lastError && <p className="text-sm text-slate-600">{summaryText(data.job.lastSummary)}</p>}
            {data.job?.lastError && <Alert>Last run failed: {data.job.lastError}</Alert>}
            {canEdit && <SecondaryButton onClick={runNow} disabled={running}>{running ? 'Checking…' : 'Run check now'}</SecondaryButton>}
          </Card>
        )}
      </div>
    </>
  );
}
