import { useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { LogOut, Plus, Search, Settings } from 'lucide-react';
import { ActionsProvider, QUICK_ACTIONS, useActions } from '../features/actions/ActionsProvider';
import { useCurrentUser, useLogout } from '../features/auth/auth';
import { useUsers } from '../lib/queries';
import { Sheet } from '../ui/Sheet';
import { CommandPalette } from './CommandPalette';
import { NAV_ITEMS } from './nav';
import plagamixWhite from '../assets/plagamix-white.png';
import urqWhite from '../assets/urq-white.png';

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

function GlobalShortcuts() {
  const { paletteOpen, setPaletteOpen, setQuickMenuOpen } = useActions();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(!paletteOpen);
        return;
      }
      if (event.key.toLowerCase() === 'n' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (isTyping(event.target) || document.querySelector('[role="dialog"]')) return;
        event.preventDefault();
        setQuickMenuOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [paletteOpen, setPaletteOpen, setQuickMenuOpen]);
  return null;
}

function QuickMenu() {
  const { open, quickMenuOpen, setQuickMenuOpen } = useActions();
  if (!quickMenuOpen) return null;
  return (
    <Sheet title="Acción rápida" onClose={() => setQuickMenuOpen(false)} variant="modal">
      <ul className="-my-2">
        {QUICK_ACTIONS.map((quick) => (
          <li key={quick.id}>
            <button
              type="button"
              onClick={() => open(quick.action)}
              className="flex min-h-14 w-full items-center justify-between border-b border-rule text-left text-base font-semibold hover:bg-paper-2"
            >
              <span>{quick.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

const railLink =
  'relative flex min-h-11 items-center gap-3 px-6 text-sm font-semibold text-paper/75 hover:bg-paper/10 hover:text-paper aria-[current=page]:bg-paper/10 aria-[current=page]:text-paper';

function Marker() {
  return <span aria-hidden className="absolute inset-y-0 left-0 w-1.5 bg-yellow" />;
}

function Rail() {
  const { setQuickMenuOpen, setPaletteOpen } = useActions();
  const logout = useLogout();
  return (
    <aside className="on-ink fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-ink text-paper lg:flex">
      <div className="border-t-4 border-yellow px-6 pb-5 pt-5">
        <img src={plagamixWhite} alt="Plagamix" width={374} height={100} className="h-auto w-40" />
        <p className="mt-2 text-[11px] font-semibold uppercase leading-4 tracking-[0.12em] text-paper/60">Gestión</p>
      </div>
      <div className="flex flex-col gap-2 px-6 pb-4">
        <button
          type="button"
          onClick={() => setQuickMenuOpen(true)}
          className="flex min-h-11 items-center justify-between rounded-sm bg-yellow px-4 text-sm font-semibold uppercase tracking-wider text-ink hover:bg-yellow-dark"
        >
          <span className="flex items-center gap-2">
            <Plus size={16} aria-hidden /> Nuevo
          </span>
          <kbd className="text-xs opacity-80">N</kbd>
        </button>
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="flex min-h-11 items-center justify-between rounded-sm border border-paper/30 px-4 text-sm text-paper/70 hover:border-paper hover:text-paper"
        >
          <span className="flex items-center gap-2">
            <Search size={16} aria-hidden /> Buscar
          </span>
          <kbd className="text-xs">Ctrl K</kbd>
        </button>
      </div>
      <nav aria-label="Principal" className="flex-1 border-t border-paper/15 py-2">
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={railLink}>
            {({ isActive }) => (
              <>
                {isActive ? <Marker /> : null}
                <Icon size={18} aria-hidden />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-paper/15 py-2">
        <NavLink to="/ajustes" className={railLink}>
          {({ isActive }) => (
            <>
              {isActive ? <Marker /> : null}
              <Settings size={18} aria-hidden />
              Ajustes
            </>
          )}
        </NavLink>
        <button type="button" onClick={() => logout.mutate()} className={`${railLink} w-full text-left`}>
          <LogOut size={18} aria-hidden />
          Salir
        </button>
      </div>
      <div className="flex items-center gap-2 border-t border-paper/15 px-6 py-4">
        <span className="text-[10px] font-semibold uppercase leading-3 tracking-[0.12em] text-paper/50">Desarrollado por</span>
        <img src={urqWhite} alt="Urquisoft" width={1244} height={878} className="h-5 w-auto opacity-80" />
      </div>
    </aside>
  );
}

function TopBar() {
  const { setPaletteOpen } = useActions();
  const logout = useLogout();
  const iconButton = 'grid size-11 place-items-center hover:bg-paper/10';
  return (
    <header className="on-ink sticky top-0 z-30 flex h-14 items-center justify-between border-t-4 border-t-yellow bg-ink pl-4 pr-1 text-paper lg:hidden">
      <img src={plagamixWhite} alt="Plagamix" width={374} height={100} className="h-6 w-auto" />
      <div className="flex">
        <button type="button" aria-label="Buscar" onClick={() => setPaletteOpen(true)} className={iconButton}>
          <Search size={20} aria-hidden />
        </button>
        <NavLink to="/ajustes" aria-label="Ajustes" className={iconButton}>
          <Settings size={20} aria-hidden />
        </NavLink>
        <button type="button" aria-label="Salir" onClick={() => logout.mutate()} className={iconButton}>
          <LogOut size={20} aria-hidden />
        </button>
      </div>
    </header>
  );
}

function BottomBar() {
  const { setQuickMenuOpen } = useActions();
  return (
    <>
      <button
        type="button"
        aria-label="Acción rápida"
        onClick={() => setQuickMenuOpen(true)}
        className="fixed bottom-[calc(72px+env(safe-area-inset-bottom))] right-4 z-30 grid size-14 place-items-center rounded-sm border border-ink bg-yellow text-ink lg:hidden"
      >
        <Plus size={28} aria-hidden />
      </button>
      <nav
        aria-label="Principal"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-ink bg-paper pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className="relative flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted aria-[current=page]:text-ink"
          >
            {({ isActive }) => (
              <>
                {isActive ? <span aria-hidden className="absolute inset-x-3 top-0 h-1 bg-yellow" /> : null}
                <Icon size={20} aria-hidden />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </>
  );
}

/** Emergency (password-only) session with no active admin user yet: nudge the owner to create their own account. */
function EmergencyBanner() {
  const user = useCurrentUser();
  const emergency = user?.role === 'admin' && user.userId === undefined;
  const users = useUsers();
  if (!emergency || !users.data || users.data.some((u) => u.role === 'admin' && u.active)) return null;
  return (
    <div role="status" className="mb-6 border-l-4 border-yellow bg-paper-2 px-4 py-3 text-sm">
      Estás usando el acceso de emergencia. Creá tu usuario de administrador en{' '}
      <Link to="/ajustes" className="font-semibold underline underline-offset-2">
        Ajustes &gt; Empleados
      </Link>{' '}
      para ingresar con tu nombre y recibir notificaciones.
    </div>
  );
}

function ScrollReset() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function Frame() {
  const { paletteOpen, setPaletteOpen } = useActions();
  return (
    <>
      <GlobalShortcuts />
      <ScrollReset />
      <Rail />
      <TopBar />
      <main className="min-h-dvh px-4 pb-32 pt-6 md:px-8 lg:ml-60 lg:px-10 lg:pb-16 lg:pt-8">
        <div className="mx-auto max-w-[1200px]">
          <EmergencyBanner />
          <Outlet />
        </div>
      </main>
      <BottomBar />
      <QuickMenu />
      {paletteOpen ? <CommandPalette onClose={() => setPaletteOpen(false)} /> : null}
    </>
  );
}

export function Shell() {
  return (
    <ActionsProvider>
      <Frame />
    </ActionsProvider>
  );
}
