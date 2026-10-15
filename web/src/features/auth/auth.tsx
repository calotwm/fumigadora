import { useState, type FormEvent } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, errorMessage } from '../../lib/api';
import type { AuthUser } from '../../lib/types';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/form';
import plagamixBlack from '../../assets/plagamix-black.png';
import urqBlack from '../../assets/urq-black.png';

const AUTH_KEY = ['auth'] as const;

/** Current session: the user, `false` when logged out. */
function useAuth() {
  return useQuery<AuthUser | false>({
    queryKey: AUTH_KEY,
    queryFn: async () => {
      try {
        return await api<AuthUser>('/auth/me');
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return false;
        throw error;
      }
    },
    retry: false,
    staleTime: Infinity,
  });
}

/** Where each role lands after logging in. */
function homeFor(user: AuthUser): string {
  return user.role === 'employee' ? '/app' : '/';
}

function AuthGate({ role }: { role?: 'admin' }) {
  const auth = useAuth();
  const location = useLocation();
  if (auth.isLoading) return <p role="status" className="p-6 text-sm text-muted">Cargando…</p>;
  if (auth.error) {
    return (
      <p role="alert" className="p-6 text-sm text-red">
        {errorMessage(auth.error)}
      </p>
    );
  }
  if (!auth.data) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  // Employees never see the admin app: send them to their own screen.
  if (role === 'admin' && auth.data.role !== 'admin') return <Navigate to="/app" replace />;
  return <Outlet />;
}

/** Layout route for any signed-in user. */
export function RequireAuth() {
  return <AuthGate />;
}

/** Layout route for the owner's app; employees are redirected to /app. */
export function RequireAdmin() {
  return <AuthGate role="admin" />;
}

export function useCurrentUser(): AuthUser | null {
  const auth = useAuth();
  return auth.data || null;
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST', body: {} }),
    onSettled: () => {
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' });
      queryClient.setQueryData(AUTH_KEY, false);
    },
  });
}

type Mode = 'owner' | 'employee';

export function LoginPage() {
  const queryClient = useQueryClient();
  const auth = useAuth();
  const location = useLocation();
  const [mode, setMode] = useState<Mode>('owner');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: (body: { username?: string; password: string }) => api<AuthUser>('/auth/login', { body }),
    onSuccess: (user) => {
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' });
      queryClient.setQueryData(AUTH_KEY, user);
    },
  });

  if (auth.data) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={auth.data.role === 'admin' && from ? from : homeFor(auth.data)} replace />;
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!password) return;
    if (mode === 'employee') {
      if (username.trim()) login.mutate({ username: username.trim(), password });
    } else {
      login.mutate({ password });
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setPassword('');
    login.reset();
  }

  const failed =
    login.error instanceof ApiError && login.error.status === 401
      ? mode === 'employee'
        ? 'Usuario o contraseña incorrectos.'
        : 'Contraseña incorrecta.'
      : login.error
        ? errorMessage(login.error)
        : null;

  return (
    <main className="grid min-h-dvh grid-rows-[auto_1fr] bg-paper lg:grid-cols-2 lg:grid-rows-1">
      <section className="flex items-center justify-center bg-yellow px-6 py-10 lg:justify-start lg:px-16 lg:py-0">
        <div>
          <img src={plagamixBlack} alt="Plagamix" width={374} height={100} className="h-auto w-56 lg:w-96" />
          <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink lg:mt-5 lg:text-sm">
            Gestión de clientes, visitas y cobranzas
          </p>
        </div>
      </section>
      <section className="flex flex-col justify-between px-6 py-8 lg:px-16 lg:py-10">
        <div className="mx-auto my-auto w-full max-w-sm border-t-4 border-ink pt-5">
          <p className="label-caps">Acceso</p>
          <h1 className="mb-4 mt-1 text-4xl font-extrabold tracking-tight">Ingresar</h1>
          <div role="tablist" aria-label="Tipo de acceso" className="mb-5 grid grid-cols-2 border border-ink">
            {(
              [
                ['owner', 'Ingresar como dueño'],
                ['employee', 'Soy empleado'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={mode === id}
                onClick={() => switchMode(id)}
                className={`min-h-11 px-2 text-xs font-semibold uppercase tracking-[0.06em] ${
                  mode === id ? 'bg-yellow text-ink' : 'bg-paper text-muted hover:bg-paper-2'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <form onSubmit={submit} className="flex flex-col gap-4">
            {mode === 'employee' ? (
              <Input
                label="Usuario"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            ) : null}
            <Input
              label="Contraseña"
              type="password"
              autoComplete="current-password"
              autoFocus={mode === 'owner'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={failed}
            />
            <Button type="submit" variant="accent" disabled={login.isPending || !password || (mode === 'employee' && !username.trim())}>
              {login.isPending ? 'Ingresando…' : 'Ingresar'}
            </Button>
          </form>
        </div>
        <footer className="mt-10 flex items-center justify-center gap-2 lg:justify-start">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">Desarrollado por</span>
          <img src={urqBlack} alt="Urquisoft" width={1244} height={878} className="h-5 w-auto" />
        </footer>
      </section>
    </main>
  );
}
