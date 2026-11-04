import { Navigate } from 'react-router-dom';
import { ChangePasswordForm } from '../components/ChangePasswordForm';
import { AuthCard } from '../components/ui';
import { useAuth } from '../hooks/useAuth';

export function ForcedPasswordChange() {
  const { user, logout, markPasswordChanged } = useAuth();
  if (!user?.mustChangePassword) return <Navigate to="/" replace />;

  return (
    <AuthCard title="Choose your own password" subtitle="You logged in with a temporary password. Replace it to continue.">
      <ChangePasswordForm currentLabel="Temporary password" onChanged={markPasswordChanged} />
      <p className="mt-4 text-center text-sm">
        <button onClick={logout} className="text-brand-700 hover:underline">Log out</button>
      </p>
    </AuthCard>
  );
}
