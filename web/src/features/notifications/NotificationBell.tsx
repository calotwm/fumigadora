import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Bell } from 'lucide-react';
import { useMarkAllNotificationsRead, useMarkNotificationRead, useNotifications } from '../../lib/queries';
import type { NotificationItem } from '../../lib/types';
import { useCurrentUser } from '../auth/auth';

function ago(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} d`;
}

interface BellProps {
  buttonClassName: string;
  /** Positions the dropdown for each host (rail, mobile top bar, employee header). */
  panelClassName: string;
}

/** Bell for the signed-in user. Renders nothing for the emergency owner session: nothing is addressed to it. */
export function NotificationBell(props: BellProps) {
  const user = useCurrentUser();
  if (user?.userId === undefined) return null;
  return <BellWithList {...props} />;
}

function BellWithList({ buttonClassName, panelClassName }: BellProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { data } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const unread = data?.unreadCount ?? 0;

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function pick(item: NotificationItem) {
    if (!item.readAt) markRead.mutate(item.id);
    setOpen(false);
    if (item.link) navigate(item.link);
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label={unread > 0 ? `Notificaciones (${unread} sin leer)` : 'Notificaciones'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`relative ${buttonClassName}`}
      >
        <Bell size={20} aria-hidden />
        {unread > 0 ? (
          <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-yellow px-1 text-[10px] font-bold leading-4 text-ink">
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div role="dialog" aria-label="Notificaciones" className={`z-40 border border-ink bg-paper text-ink shadow-lg ${panelClassName}`}>
          <div className="flex items-center justify-between gap-3 border-b border-ink px-4 py-2">
            <p className="label-caps">Notificaciones</p>
            <button
              type="button"
              disabled={unread === 0 || markAll.isPending}
              onClick={() => markAll.mutate()}
              className="text-xs font-semibold underline underline-offset-2 disabled:no-underline disabled:opacity-40"
            >
              Marcar todas como leídas
            </button>
          </div>
          {data && data.items.length > 0 ? (
            <ul className="max-h-96 overflow-y-auto">
              {data.items.map((item) => (
                <li key={item.id} className="border-b border-rule last:border-b-0">
                  <button
                    type="button"
                    onClick={() => pick(item)}
                    className={`flex w-full gap-3 px-4 py-3 text-left hover:bg-paper-2 ${item.readAt ? '' : 'bg-paper-2'}`}
                  >
                    <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${item.readAt ? 'bg-transparent' : 'bg-yellow'}`} />
                    <span className="min-w-0">
                      <span className={`block text-sm ${item.readAt ? 'font-medium' : 'font-bold'}`}>{item.title}</span>
                      <span className="mt-0.5 block text-xs text-muted">{item.body}</span>
                      <span className="mt-1 block text-[11px] text-muted">{ago(item.createdAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-6 text-center text-sm text-muted">No tenés notificaciones.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
