import { useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { Alert, Button, Field } from './ui';

export function ChangePasswordForm({ currentLabel = 'Current password', onChanged }: { currentLabel?: string; onChanged: () => void }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirm) {
      setError('The new passwords do not match');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await api('/auth/change-password', { currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirm('');
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Alert>{error}</Alert>}
      <Field label={currentLabel} type="password" autoComplete="current-password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
      <Field label="New password" type="password" autoComplete="new-password" required minLength={8} maxLength={72} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
      <Field label="Confirm new password" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      <Button type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Change password'}</Button>
    </form>
  );
}
