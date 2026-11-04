import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { StatusBadge, statusLabel, TeamSummary, type TeamDay } from '../components/attendance';
import { Alert, DataTable, Field, SecondaryButton, Select } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { addDays, formatDay, formatDuration, formatTime } from '../lib/time';

export function Attendance() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? '';
  const [team, setTeam] = useState<TeamDay | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [department, setDepartment] = useState('');

  const load = useCallback(async () => {
    const res = await api<TeamDay>(`/attendance/team${date ? `?date=${date}` : ''}`);
    setTeam(res);
    setError('');
  }, [date]);

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
    // Keeps "who's in" current when someone returns to the tab.
    const onFocus = () => { load().catch((err: Error) => setError(err.message)); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const statuses = useMemo(() => [...new Set(team?.rows.map((r) => r.status))].sort(), [team]);
  const departments = useMemo(() => [...new Set(team?.rows.map((r) => r.department).filter(Boolean))].sort() as string[], [team]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return team?.rows.filter((r) =>
      (!status || r.status === status) &&
      (!department || r.department === department) &&
      (!q || r.name.toLowerCase().includes(q) || r.employeeCode.toLowerCase().includes(q)));
  }, [team, search, status, department]);

  const setDate = (value: string) => {
    if (team && value > team.today) return;
    setParams(value && value !== team?.today ? { date: value } : {});
  };

  const isToday = !!team && team.date === team.today;

  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight">{user?.role === 'ADMIN' ? 'Attendance' : 'Team attendance'}</h1>
      <p className="mt-1 text-slate-600">Who's in, late or absent. All times are in India time.</p>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <SecondaryButton aria-label="Previous day" disabled={!team} onClick={() => team && setDate(addDays(team.date, -1))} className="px-2!">
          <ChevronLeft size={18} aria-hidden />
        </SecondaryButton>
        <SecondaryButton aria-label="Next day" disabled={!team || isToday} onClick={() => team && setDate(addDays(team.date, 1))} className="px-2!">
          <ChevronRight size={18} aria-hidden />
        </SecondaryButton>
        <SecondaryButton disabled={isToday} onClick={() => setParams({})}>Today</SecondaryButton>
        {team && (
          <p data-testid="team-date" className="ml-1 font-semibold">
            {formatDay(team.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            {team.holiday && <span className="font-normal text-slate-600"> · {team.holiday}</span>}
          </p>
        )}
      </div>

      <div className="mt-5 space-y-5">
        {error && <Alert>{error}</Alert>}
        {!error && !team && <p className="text-sm text-slate-600">Loading…</p>}
        {team && <TeamSummary summary={team.summary} isToday={isToday} />}

        {team && team.rows.length > 0 && (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-full max-w-xs">
                <Field label="Search" type="search" placeholder="Name or code" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <div className="w-44">
                <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="">All</option>
                  {statuses.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                </Select>
              </div>
              <div className="w-44">
                <Select label="Department" value={department} onChange={(e) => setDepartment(e.target.value)}>
                  <option value="">All</option>
                  {departments.map((d) => <option key={d} value={d}>{d}</option>)}
                </Select>
              </div>
            </div>
            {visible?.length === 0 ? (
              <p className="text-sm text-slate-600">No one matches.</p>
            ) : (
              <DataTable headers={['Employee', 'Department', 'Status', 'Check in', 'Check out', 'Worked', 'Late by']}>
                {visible?.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap">
                      <Link to={`/timesheet?user=${r.id}`} className="font-medium text-brand-700 hover:underline">{r.name}</Link>
                      <span className="block text-xs text-slate-500">{r.employeeCode}</span>
                    </td>
                    <td>{r.department ?? '—'}</td>
                    <td><StatusBadge status={r.status} /></td>
                    <td className="whitespace-nowrap">{formatTime(r.record?.checkInAt, team.timeZone)}</td>
                    <td className="whitespace-nowrap">{formatTime(r.record?.checkOutAt, team.timeZone)}</td>
                    <td className="whitespace-nowrap">{r.record?.workedMinutes != null ? formatDuration(r.record.workedMinutes) : '—'}</td>
                    <td className="whitespace-nowrap">{r.record?.lateMinutes ? formatDuration(r.record.lateMinutes) : '—'}</td>
                  </tr>
                ))}
              </DataTable>
            )}
          </>
        )}
        {team && team.rows.length === 0 && (
          <p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">No team members on this date.</p>
        )}
      </div>
    </>
  );
}
