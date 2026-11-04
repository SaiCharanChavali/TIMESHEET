import { Building2, CalendarDays, CheckSquare, ChevronDown, ClipboardList, Clock3, FileClock, Home, LogOut, UserCheck, UserRound, Users, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { APPROVALS_CHANGED } from './attendance';
import { Logo } from './Logo';
import { roleLabel } from './ui';

function RailLink({ to, label, icon: Icon, end, badge }: { to: string; label: string; icon: LucideIcon; end?: boolean; badge?: number }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex min-w-20 flex-col items-center gap-1 rounded-xl px-2 py-2.5 text-sm font-medium ${
          isActive ? 'bg-brand-50 text-brand-600' : 'text-slate-700 hover:bg-slate-100'
        }`}
    >
      <span className="relative">
        <Icon size={22} aria-hidden />
        {!!badge && (
          <span data-testid="approvals-badge" className="absolute -top-1.5 left-3.5 min-w-4 rounded-full bg-brand-600 px-1 text-center text-[11px] leading-4 font-semibold text-white">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </span>
      {label}
      {!!badge && <span className="sr-only">, {badge} waiting</span>}
    </NavLink>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;
  const itemClass = 'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100';

  return (
    <div ref={ref} className="relative">
      <button aria-label="Account menu" aria-expanded={open} onClick={() => setOpen(!open)} className="flex items-center gap-3 rounded-lg p-1 text-left hover:bg-slate-50">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-navy font-semibold text-white" aria-hidden>
          {user.name.charAt(0).toUpperCase()}
        </span>
        <span className="hidden sm:block">
          <span className="block max-w-48 truncate text-sm font-semibold">{user.name}</span>
          <span className="block text-xs text-slate-500">{roleLabel[user.role]}</span>
        </span>
        <ChevronDown size={18} className="text-slate-500" aria-hidden />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-48 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
          <Link to="/account" onClick={() => setOpen(false)} className={itemClass}>
            <UserRound size={16} aria-hidden /> Account
          </Link>
          <button onClick={logout} className={itemClass}>
            <LogOut size={16} aria-hidden /> Log out
          </button>
        </div>
      )}
    </div>
  );
}

export function Layout() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const scroller = useRef<HTMLDivElement>(null);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const isReviewer = !!user && user.role !== 'EMPLOYEE';

  useEffect(() => {
    if (!isReviewer) return;
    const load = () => api<{ count: number }>('/approvals').then((res) => setPendingApprovals(res.count)).catch(() => {});
    load();
    window.addEventListener(APPROVALS_CHANGED, load);
    window.addEventListener('focus', load);
    return () => {
      window.removeEventListener(APPROVALS_CHANGED, load);
      window.removeEventListener('focus', load);
    };
  }, [isReviewer, pathname]);

  // Only the content area scrolls, so each new page has to start back at the top.
  useEffect(() => {
    scroller.current?.scrollTo(0, 0);
  }, [pathname]);

  if (!user) return null;

  return (
    <div className="flex h-dvh flex-col print:h-auto">
      <header className="z-10 flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-3 sm:px-8">
        <Logo />
        <UserMenu />
      </header>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav aria-label="Main" className="no-scrollbar flex shrink-0 gap-1 overflow-auto border-b border-slate-200 bg-white p-2 md:w-28 md:flex-col md:border-r md:border-b-0">
          <RailLink to="/" end label="Home" icon={Home} />
          <RailLink to="/timesheet" label="Timesheet" icon={ClipboardList} />
          <RailLink to="/requests" label="Requests" icon={FileClock} />
          {user.role !== 'EMPLOYEE' && <RailLink to="/attendance" label="Attendance" icon={UserCheck} />}
          {user.role !== 'EMPLOYEE' && <RailLink to="/approvals" label="Approvals" icon={CheckSquare} badge={pendingApprovals} />}
          {user.role !== 'EMPLOYEE' && <RailLink to="/people" label={user.role === 'ADMIN' ? 'People' : 'My team'} icon={Users} />}
          {user.role === 'ADMIN' && (
            <>
              <RailLink to="/departments" label="Departments" icon={Building2} />
              <RailLink to="/shifts" label="Shifts" icon={Clock3} />
              <RailLink to="/holidays" label="Holidays" icon={CalendarDays} />
            </>
          )}
        </nav>
        <div ref={scroller} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto print:overflow-visible">
          <main className="w-full max-w-7xl flex-1 px-4 py-6 sm:py-8 xl:px-10">
            <Outlet />
          </main>
          <footer className="border-t border-slate-200 px-4 py-4 xl:px-10">
            <Logo small />
          </footer>
        </div>
      </div>
    </div>
  );
}
