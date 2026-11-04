import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, type Role } from '../api/client';
import { Alert, Button, DataTable, Field, Modal, roleLabel, RowAction, SecondaryButton, Select } from '../components/ui';
import { useAuth } from '../hooks/useAuth';

interface Person {
  id: string;
  employeeCode: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  departmentId: string | null;
  shiftId: string | null;
  managerId: string | null;
  department: { name: string } | null;
  shift: { name: string } | null;
  manager: { name: string } | null;
}

interface Option {
  id: string;
  name: string;
}

interface Issued {
  name: string;
  email: string;
  temporaryPassword: string;
}

function EmployeeForm({ person, people, departments, shifts, onClose, onSaved }: {
  person: Person | null;
  people: Person[];
  departments: Option[];
  shifts: Option[];
  onClose: () => void;
  onSaved: (issued?: Issued) => void;
}) {
  const { user } = useAuth();
  const [employeeCode, setEmployeeCode] = useState(person?.employeeCode ?? '');
  const [name, setName] = useState(person?.name ?? '');
  const [email, setEmail] = useState(person?.email ?? '');
  const [role, setRole] = useState<Role>(person?.role ?? 'EMPLOYEE');
  const [departmentId, setDepartmentId] = useState(person?.departmentId ?? '');
  // New employees need a shift for attendance, so start from the first one instead of blank.
  const [shiftId, setShiftId] = useState(person ? person.shiftId ?? '' : shifts[0]?.id ?? '');
  const [managerId, setManagerId] = useState(person?.managerId ?? '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Keeps a current manager who has since left in the list, so that editing doesn't silently clear them.
  const managers = people.filter((p) => p.id !== person?.id && ((p.active && p.role !== 'EMPLOYEE') || p.id === person?.managerId));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    const body = {
      employeeCode, name, email, role,
      departmentId: departmentId || null,
      shiftId: shiftId || null,
      managerId: managerId || null,
    };
    try {
      if (person) {
        await api(`/users/${person.id}`, body, 'PATCH');
        onSaved();
      } else {
        const res = await api<{ temporaryPassword: string }>('/users', body);
        onSaved({ name: name.trim(), email: email.trim().toLowerCase(), temporaryPassword: res.temporaryPassword });
      }
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <Modal title={person ? `Edit ${person.name}` : 'Add employee'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Employee code" required maxLength={30} value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)} />
          <Field label="Full name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <Field label="Work email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Role" value={role} disabled={person?.id === user?.id} onChange={(e) => setRole(e.target.value as Role)}>
            {(Object.keys(roleLabel) as Role[]).map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}
          </Select>
          <Select label="Manager" value={managerId} onChange={(e) => setManagerId(e.target.value)}>
            <option value="">None</option>
            {managers.map((m) => <option key={m.id} value={m.id}>{m.name}{m.active ? '' : ' (inactive)'}</option>)}
          </Select>
          <Select label="Department" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">None</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
          <Select label="Shift" value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
            <option value="">None</option>
            {shifts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <Button type="submit" disabled={submitting}>{submitting ? 'Saving…' : person ? 'Save changes' : 'Add employee'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function TemporaryPassword({ issued, onClose }: { issued: Issued; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(issued.temporaryPassword);
    setCopied(true);
  };

  return (
    <Modal title={`Temporary password for ${issued.name}`} onClose={onClose}>
      <p className="text-sm text-slate-600">
        Give this to {issued.name} ({issued.email}) privately. They'll be asked to replace it when they log in.
      </p>
      <p data-testid="temp-password" className="mt-3 rounded-md bg-slate-100 px-3 py-2 font-mono text-lg select-all">{issued.temporaryPassword}</p>
      <p className="mt-3 text-sm font-medium text-amber-800">This won't be shown again.</p>
      <div className="mt-4 flex justify-end gap-2">
        <SecondaryButton onClick={copy}>{copied ? 'Copied' : 'Copy'}</SecondaryButton>
        <Button type="button" onClick={onClose}>Done</Button>
      </div>
    </Modal>
  );
}

export function People() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [people, setPeople] = useState<Person[] | null>(null);
  const [departments, setDepartments] = useState<Option[]>([]);
  const [shifts, setShifts] = useState<Option[]>([]);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive' | 'all'>('active');
  const [editing, setEditing] = useState<Person | 'new' | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);

  const load = useCallback(async () => {
    const res = await api<{ users: Person[] }>('/users');
    setPeople(res.users);
  }, []);

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
    if (!isAdmin) return;
    api<{ departments: Option[] }>('/departments').then((res) => setDepartments(res.departments)).catch((err: Error) => setError(err.message));
    api<{ shifts: Option[] }>('/shifts').then((res) => setShifts(res.shifts)).catch((err: Error) => setError(err.message));
  }, [load, isAdmin]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return people?.filter((p) =>
      (status === 'all' || p.active === (status === 'active')) &&
      (!q || [p.name, p.email, p.employeeCode].some((v) => v.toLowerCase().includes(q))));
  }, [people, search, status]);

  // Runs an admin action on one row and refreshes the list, showing any refusal from the server.
  const act = async (action: () => Promise<void>) => {
    setError('');
    try {
      await action();
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const setActive = (p: Person, active: boolean) => {
    if (!active && !window.confirm(`Deactivate ${p.name}? They won't be able to log in. Their records are kept.`)) return;
    act(() => api(`/users/${p.id}`, { active }, 'PATCH'));
  };

  const resetPassword = (p: Person) => {
    if (!window.confirm(`Create a new temporary password for ${p.name}? Their current password will stop working.`)) return;
    act(async () => {
      const res = await api<{ temporaryPassword: string }>(`/users/${p.id}/temporary-password`, {});
      setIssued({ name: p.name, email: p.email, temporaryPassword: res.temporaryPassword });
    });
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight">{isAdmin ? 'People' : 'My team'}</h1>
        {isAdmin && <Button onClick={() => setEditing('new')}>Add employee</Button>}
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="w-full max-w-xs">
          <Field label="Search" type="search" placeholder="Name, email or code" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="w-36">
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </Select>
        </div>
      </div>

      <div className="mt-4 space-y-4">
        {error && <Alert>{error}</Alert>}
        {!error && !people && <p className="text-sm text-slate-600">Loading…</p>}
        {visible?.length === 0 && <p className="text-sm text-slate-600">No one matches.</p>}
        {!!visible?.length && (
          <DataTable headers={['Code', 'Employee', 'Role', 'Department', 'Shift', 'Manager', ...(isAdmin ? ['Actions'] : [])]}>
            {visible.map((p) => (
              <tr key={p.id} className={p.active ? '' : 'text-slate-500'}>
                <td>{p.employeeCode}</td>
                <td className="whitespace-nowrap">
                  <div className="font-medium">{p.name}{!p.active && ' (inactive)'}</div>
                  <div className="text-slate-500">{p.email}</div>
                </td>
                <td>{roleLabel[p.role]}</td>
                <td>{p.department?.name ?? '—'}</td>
                <td>{p.shift?.name ?? '—'}</td>
                <td>{p.manager?.name ?? '—'}</td>
                {isAdmin && (
                  <td>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 whitespace-nowrap">
                      <RowAction onClick={() => setEditing(p)}>Edit</RowAction>
                      {p.id !== user?.id && (
                        <>
                          {p.active && <RowAction onClick={() => resetPassword(p)}>Reset password</RowAction>}
                          {p.active
                            ? <RowAction danger onClick={() => setActive(p, false)}>Deactivate</RowAction>
                            : <RowAction onClick={() => setActive(p, true)}>Reactivate</RowAction>}
                        </>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </DataTable>
        )}
      </div>

      {editing && people && (
        <EmployeeForm
          person={editing === 'new' ? null : editing}
          people={people}
          departments={departments}
          shifts={shifts}
          onClose={() => setEditing(null)}
          onSaved={(newlyIssued) => {
            setEditing(null);
            if (newlyIssued) setIssued(newlyIssued);
            load().catch((err: Error) => setError(err.message));
          }}
        />
      )}
      {issued && <TemporaryPassword issued={issued} onClose={() => setIssued(null)} />}
    </>
  );
}
