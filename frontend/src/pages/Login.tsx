import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { Alert, AuthCard, Button, Field } from '../components/ui';
import { useAuth } from '../hooks/useAuth';

export function Login() {
  const { user, loading, login } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (loading) return null;
  if (user) return <Navigate to={location.state?.from ?? '/'} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <AuthCard title="Log in" subtitle="Use your work email and password.">
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Email" type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button type="submit" disabled={submitting} className="w-full">{submitting ? 'Logging in…' : 'Log in'}</Button>
        <p className="text-center text-sm">
          <Link to="/forgot-password" className="text-brand-700 hover:underline">Forgot your password?</Link>
        </p>
      </form>
    </AuthCard>
  );
}
