import { useState } from 'react';
import { ChangePasswordForm } from '../components/ChangePasswordForm';
import { Alert } from '../components/ui';
import { useAuth } from '../hooks/useAuth';

export function Account() {
  const { user } = useAuth();
  const [saved, setSaved] = useState(false);

  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight">Account</h1>
      <p className="mt-1 text-sm text-slate-600">{user?.email}</p>
      <section className="mt-6 max-w-md rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-bold">Change password</h2>
        <p className="mt-1 text-sm text-slate-600">You'll be logged out on your other devices.</p>
        <div className="mt-4 space-y-4">
          {saved && <Alert kind="success">Your password has been changed.</Alert>}
          <ChangePasswordForm onChanged={() => setSaved(true)} />
        </div>
      </section>
    </>
  );
}
