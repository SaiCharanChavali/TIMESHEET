import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { Alert, AuthCard, Button, Field } from '../components/ui';

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await api<{ message: string }>('/auth/forgot-password', { email });
      setMessage(res.message);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthCard title="Reset your password" subtitle="Enter your work email and we'll send you a reset link.">
      {message ? (
        <Alert kind="success">{message}</Alert>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <Field label="Email" type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" disabled={submitting} className="w-full">{submitting ? 'Sending…' : 'Send reset link'}</Button>
        </form>
      )}
      <p className="mt-4 text-center text-sm">
        <Link to="/login" className="text-brand-700 hover:underline">Back to log in</Link>
      </p>
    </AuthCard>
  );
}
