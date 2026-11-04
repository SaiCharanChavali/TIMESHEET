import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { Alert, Button, DataTable, Field, RowAction } from '../components/ui';
import { formatDay } from '../lib/time';

interface Holiday {
  id: string;
  date: string;
  name: string;
}

export function Holidays() {
  const [holidays, setHolidays] = useState<Holiday[] | null>(null);
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => api<{ holidays: Holiday[] }>('/holidays').then((res) => setHolidays(res.holidays)), []);

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [load]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api('/holidays', { date, name });
      setDate('');
      setName('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (h: Holiday) => {
    if (!window.confirm(`Delete ${h.name}?`)) return;
    setError('');
    try {
      await api(`/holidays/${h.id}`, undefined, 'DELETE');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight">Holidays</h1>
      <p className="mt-1 text-slate-600">No one is marked absent on these days. They apply to everyone.</p>

      <form onSubmit={add} className="mt-6 flex max-w-2xl flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="w-44">
          <Field label="Date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="min-w-48 flex-1">
          <Field label="Holiday name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <Button type="submit" disabled={submitting}>{submitting ? 'Adding…' : 'Add holiday'}</Button>
      </form>

      <div className="mt-4 max-w-2xl space-y-4">
        {error && <Alert>{error}</Alert>}
        {!error && !holidays && <p className="text-sm text-slate-600">Loading…</p>}
        {holidays?.length === 0 && <p className="text-sm text-slate-600">No holidays added yet.</p>}
        {!!holidays?.length && (
          <DataTable headers={['Date', 'Holiday', 'Actions']}>
            {holidays.map((h) => (
              <tr key={h.id}>
                <td className="whitespace-nowrap">{formatDay(h.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</td>
                <td className="font-medium">{h.name}</td>
                <td><RowAction danger onClick={() => remove(h)}>Delete</RowAction></td>
              </tr>
            ))}
          </DataTable>
        )}
      </div>
    </>
  );
}
