import { useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { formatDay, formatTime, toOfficeTime } from '../lib/time';
import type { AttendanceDay } from './attendance';
import { TimeField } from './TimeField';
import { Alert, Button, Field, Modal, SecondaryButton, TextArea } from './ui';

export function CorrectionDialog({ day, timeZone, shift, onClose, onSaved }: {
  day: AttendanceDay;
  timeZone: string;
  shift: { startTime: string; endTime: string } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { record } = day;
  const [checkIn, setCheckIn] = useState(record ? toOfficeTime(record.checkInAt, timeZone) : shift?.startTime ?? '09:00');
  const [checkOut, setCheckOut] = useState(record?.checkOutAt ? toOfficeTime(record.checkOutAt, timeZone) : shift?.endTime ?? '18:00');
  const [breakMinutes, setBreakMinutes] = useState(String(record?.breakMinutes ?? 0));
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api('/corrections', { date: day.date, checkIn, checkOut, breakMinutes: Number(breakMinutes), reason });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <Modal title={`Correct ${formatDay(day.date, { weekday: 'short', day: 'numeric', month: 'long' })}`} onClose={onClose}>
      <p className="text-sm text-slate-600">
        {record
          ? `Currently recorded: ${formatTime(record.checkInAt, timeZone)} to ${record.checkOutAt ? formatTime(record.checkOutAt, timeZone) : 'no check-out'}.`
          : 'Nothing is recorded for this day.'}{' '}
        Enter what it should be. Nothing changes until your manager approves it.
      </p>
      <form onSubmit={submit} className="mt-4 space-y-4">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <TimeField label="Check in" value={checkIn} onChange={setCheckIn} />
          <TimeField label="Check out" value={checkOut} onChange={setCheckOut} />
        </div>
        <div className="w-44">
          <Field label="Total breaks (minutes)" type="number" min={0} max={1440} step={1} required value={breakMinutes} onChange={(e) => setBreakMinutes(e.target.value)} />
        </div>
        <TextArea label="Reason" required minLength={3} maxLength={500} rows={3} placeholder="For example, I forgot to check out" value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="flex justify-end gap-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <Button type="submit" disabled={submitting}>{submitting ? 'Sending…' : 'Send request'}</Button>
        </div>
      </form>
    </Modal>
  );
}
