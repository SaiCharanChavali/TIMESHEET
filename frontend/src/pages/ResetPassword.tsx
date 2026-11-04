import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { Alert, AuthCard, Button, Field } from '../components/ui';

export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirm) {
      setError('The passwords do not match');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await api('/auth/reset-password', { token, newPassword });
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthCard title="Choose a new password">
      {done ? (
        <Alert kind="success">Your password has been changed. You can now log in.</Alert>
      ) : !token ? (
        <Alert>This reset link is invalid or has expired</Alert>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <Field label="New password" type="password" autoComplete="new-password" required minLength={8} maxLength={72} autoFocus value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          <Field label="Confirm new password" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          <Button type="submit" disabled={submitting} className="w-full">{submitting ? 'Saving…' : 'Change password'}</Button>
        </form>
      )}
      <p className="mt-4 text-center text-sm">
        <Link to="/login" className="text-brand-700 hover:underline">Back to log in</Link>
      </p>
    </AuthCard>
  );
}
