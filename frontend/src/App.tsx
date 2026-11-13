import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import type { Role } from './api/client';
import { Layout } from './components/Layout';
import { Alert } from './components/ui';
import { useAuth } from './hooks/useAuth';
import { Account } from './pages/Account';
import { Approvals } from './pages/Approvals';
import { Attendance } from './pages/Attendance';
import { Checkouts } from './pages/Checkouts';
import { CheckoutSettings } from './pages/CheckoutSettings';
import { Dashboard } from './pages/Dashboard';
import { Departments } from './pages/Departments';
import { ForcedPasswordChange } from './pages/ForcedPasswordChange';
import { ForgotPassword } from './pages/ForgotPassword';
import { Holidays } from './pages/Holidays';
import { Login } from './pages/Login';
import { People } from './pages/People';
import { Requests } from './pages/Requests';
import { ResetPassword } from './pages/ResetPassword';
import { Shifts } from './pages/Shifts';
import { Timesheet } from './pages/Timesheet';

function RequireAuth() {
  const { user, loading, error } = useAuth();
  const location = useLocation();
  if (loading) return <p className="p-6 text-sm text-slate-600">Loading…</p>;
  if (error) return <div className="mx-auto max-w-md p-6"><Alert>{error}</Alert></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.mustChangePassword && location.pathname !== '/change-password') return <Navigate to="/change-password" replace />;
  return <Outlet />;
}

function RequireRole({ roles }: { roles: Role[] }) {
  const { user } = useAuth();
  return user && roles.includes(user.role) ? <Outlet /> : <Navigate to="/" replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route element={<RequireAuth />}>
        <Route path="/change-password" element={<ForcedPasswordChange />} />
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="timesheet" element={<Timesheet />} />
          <Route path="requests" element={<Requests />} />
          <Route path="account" element={<Account />} />
          <Route element={<RequireRole roles={['ADMIN', 'MANAGER']} />}>
            <Route path="attendance" element={<Attendance />} />
            <Route path="approvals" element={<Approvals />} />
            <Route path="people" element={<People />} />
          </Route>
          <Route element={<RequireRole roles={['ADMIN', 'MANAGER', 'HR']} />}>
            <Route path="checkouts" element={<Checkouts />} />
          </Route>
          <Route element={<RequireRole roles={['ADMIN', 'HR']} />}>
            <Route path="checkouts/settings" element={<CheckoutSettings />} />
          </Route>
          <Route element={<RequireRole roles={['ADMIN']} />}>
            <Route path="departments" element={<Departments />} />
            <Route path="holidays" element={<Holidays />} />
          </Route>
          <Route element={<RequireRole roles={['ADMIN', 'MANAGER']} />}>
            <Route path="shifts" element={<Shifts />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
