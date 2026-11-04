import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { Alert, Button, DataTable, Field, Modal, RowAction, SecondaryButton } from '../components/ui';

interface Department {
  id: string;
  name: string;
  _count: { users: number };
}

function DepartmentForm({ department, onClose, onSaved }: { department: Department | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(department?.name ?? '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (department) await api(`/departments/${department.id}`, { name }, 'PUT');
      else await api('/departments', { name });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <Modal title={department ? 'Rename department' : 'Add department'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Department name" required maxLength={80} autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        <div className="flex justify-end gap-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <Button type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Modal>
  );
}

export function Departments() {
  const [departments, setDepartments] = useState<Department[] | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Department | 'new' | null>(null);

  const load = useCallback(() => api<{ departments: Department[] }>('/departments').then((res) => setDepartments(res.departments)), []);

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [load]);

  const remove = async (d: Department) => {
    if (!window.confirm(`Delete the ${d.name} department?`)) return;
    setError('');
    try {
      await api(`/departments/${d.id}`, undefined, 'DELETE');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight">Departments</h1>
        <Button onClick={() => setEditing('new')}>Add department</Button>
      </div>
      <div className="mt-4 max-w-2xl space-y-4">
        {error && <Alert>{error}</Alert>}
        {!error && !departments && <p className="text-sm text-slate-600">Loading…</p>}
        {departments?.length === 0 && <p className="text-sm text-slate-600">No departments yet.</p>}
        {!!departments?.length && (
          <DataTable headers={['Name', 'Employees', 'Actions']}>
            {departments.map((d) => (
              <tr key={d.id}>
                <td className="font-medium">{d.name}</td>
                <td>{d._count.users}</td>
                <td>
                  <div className="flex gap-3">
                    <RowAction onClick={() => setEditing(d)}>Rename</RowAction>
                    <RowAction danger onClick={() => remove(d)}>Delete</RowAction>
                  </div>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </div>
      {editing && (
        <DepartmentForm
          department={editing === 'new' ? null : editing}
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
