import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { TimeField } from '../components/TimeField';
import { Alert, Button, DataTable, Field, Modal, RowAction, SecondaryButton } from '../components/ui';
import { formatShiftTime } from '../lib/time';

interface Shift {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  graceMinutes: number;
  fullDayMinutes: number;
  halfDayMinutes: number;
  overtimeAfterMins: number;
  weeklyOffDays: number[];
  _count: { users: number };
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const toHours = (minutes: number) => String(minutes / 60);
const toMinutes = (hours: string) => Math.round(Number(hours) * 60);

function ShiftForm({ shift, onClose, onSaved }: { shift: Shift | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(shift?.name ?? '');
  const [startTime, setStartTime] = useState(shift?.startTime ?? '09:00');
  const [endTime, setEndTime] = useState(shift?.endTime ?? '18:00');
  const [graceMinutes, setGraceMinutes] = useState(String(shift?.graceMinutes ?? 15));
  const [fullDay, setFullDay] = useState(toHours(shift?.fullDayMinutes ?? 480));
  const [halfDay, setHalfDay] = useState(toHours(shift?.halfDayMinutes ?? 240));
  const [overtime, setOvertime] = useState(toHours(shift?.overtimeAfterMins ?? 540));
  const [weeklyOffDays, setWeeklyOffDays] = useState(shift?.weeklyOffDays ?? [0, 6]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const toggleDay = (day: number) =>
    setWeeklyOffDays((days) => (days.includes(day) ? days.filter((d) => d !== day) : [...days, day]));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    const body = {
      name, startTime, endTime, weeklyOffDays,
      graceMinutes: Number(graceMinutes),
      fullDayMinutes: toMinutes(fullDay),
      halfDayMinutes: toMinutes(halfDay),
      overtimeAfterMins: toMinutes(overtime),
    };
    try {
      if (shift) await api(`/shifts/${shift.id}`, body, 'PUT');
      else await api('/shifts', body);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <Modal title={shift ? `Edit ${shift.name}` : 'Add shift'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Shift name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TimeField label="Start time" value={startTime} onChange={setStartTime} />
          <TimeField label="End time" value={endTime} onChange={setEndTime} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Grace (minutes)" type="number" min={0} max={1440} step={1} required value={graceMinutes} onChange={(e) => setGraceMinutes(e.target.value)} />
          <Field label="Full day (hours)" type="number" min={0} max={24} step={0.25} required value={fullDay} onChange={(e) => setFullDay(e.target.value)} />
          <Field label="Half day (hours)" type="number" min={0} max={24} step={0.25} required value={halfDay} onChange={(e) => setHalfDay(e.target.value)} />
          <Field label="Overtime after (hours)" type="number" min={0} max={24} step={0.25} required value={overtime} onChange={(e) => setOvertime(e.target.value)} />
        </div>
        <fieldset>
          <legend className="text-sm font-medium text-slate-700">Weekly off days</legend>
          <div className="mt-2 flex flex-wrap gap-3">
            {DAYS.map((day, i) => (
              <label key={day} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={weeklyOffDays.includes(i)} onChange={() => toggleDay(i)} />
                {day}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <Button type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Modal>
  );
}

export function Shifts() {
  const [shifts, setShifts] = useState<Shift[] | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Shift | 'new' | null>(null);

  const load = useCallback(() => api<{ shifts: Shift[] }>('/shifts').then((res) => setShifts(res.shifts)), []);

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [load]);

  const remove = async (s: Shift) => {
    if (!window.confirm(`Delete the ${s.name} shift?`)) return;
    setError('');
    try {
      await api(`/shifts/${s.id}`, undefined, 'DELETE');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight">Shifts</h1>
        <Button onClick={() => setEditing('new')}>Add shift</Button>
      </div>
      <div className="mt-4 space-y-4">
        {error && <Alert>{error}</Alert>}
        {!error && !shifts && <p className="text-sm text-slate-600">Loading…</p>}
        {shifts?.length === 0 && <p className="text-sm text-slate-600">No shifts yet.</p>}
        {!!shifts?.length && (
          <DataTable headers={['Name', 'Hours', 'Grace', 'Full day', 'Half day', 'Overtime after', 'Weekly off', 'Employees', 'Actions']}>
            {shifts.map((s) => (
              <tr key={s.id}>
                <td className="font-medium whitespace-nowrap">{s.name}</td>
                <td>{formatShiftTime(s.startTime)} – {formatShiftTime(s.endTime)}</td>
                <td className="whitespace-nowrap">{s.graceMinutes} min</td>
                <td className="whitespace-nowrap">{toHours(s.fullDayMinutes)} h</td>
                <td className="whitespace-nowrap">{toHours(s.halfDayMinutes)} h</td>
                <td className="whitespace-nowrap">{toHours(s.overtimeAfterMins)} h</td>
                <td>{s.weeklyOffDays.map((d) => DAYS[d]).join(', ') || 'None'}</td>
                <td>{s._count.users}</td>
                <td>
                  <div className="flex gap-3">
                    <RowAction onClick={() => setEditing(s)}>Edit</RowAction>
                    <RowAction danger onClick={() => remove(s)}>Delete</RowAction>
                  </div>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </div>
      {editing && (
        <ShiftForm
          shift={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load().catch((err: Error) => setError(err.message));
          }}
        />
      )}
    </>
  );
}
