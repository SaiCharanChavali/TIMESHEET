import { Bell } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { NOTIFICATIONS_CHANGED } from './checkouts';

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

const POLL_MS = 60_000;

function timeAgo(iso: string) {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(new Date(iso));
}

export function NotificationBell() {
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const load = useCallback(() => {
    api<{ notifications: Notification[]; unread: number }>('/notifications')
      .then((res) => { setItems(res.notifications); setUnread(res.unread); })
      .catch(() => {});
  }, []);

  // Alerts are created by a background job, so the list is checked regularly as well as on focus.
  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_MS);
    window.addEventListener('focus', load);
    window.addEventListener(NOTIFICATIONS_CHANGED, load);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', load);
      window.removeEventListener(NOTIFICATIONS_CHANGED, load);
    };
  }, [load]);

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

  const openItem = async (n: Notification) => {
    setOpen(false);
    if (!n.readAt) await api(`/notifications/${n.id}/read`, {}).catch(() => {});
    load();
    if (n.link) navigate(n.link);
  };

  const markAll = async () => {
    await api('/notifications/read-all', {}).catch(() => {});
    load();
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="relative flex size-10 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-brand-600"
      >
        <Bell size={20} aria-hidden />
        {!!unread && (
          <span className="absolute top-1 right-1 min-w-4 rounded-full bg-brand-600 px-1 text-center text-[11px] leading-4 font-semibold text-white" aria-hidden>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-bold">Notifications</h2>
            {!!unread && <button type="button" onClick={markAll} className="text-xs font-medium text-brand-700 hover:underline">Mark all as read</button>}
          </div>
          {!items.length && <p className="px-4 py-6 text-center text-sm text-slate-500">You're all caught up.</p>}
          <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
            {items.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => openItem(n)} className={`block w-full px-4 py-3 text-left hover:bg-slate-50 ${n.readAt ? '' : 'bg-brand-50/60'}`}>
                  <span className="flex items-start gap-2">
                    {!n.readAt && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-600" aria-label="Unread" />}
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{n.title}</span>
                      <span className="mt-0.5 block text-sm text-slate-600">{n.body}</span>
                      <span className="mt-1 block text-xs text-slate-500">{timeAgo(n.createdAt)}</span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
