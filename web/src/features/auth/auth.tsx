import { useState, type FormEvent } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, errorMessage } from '../../lib/api';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/form';
import plagamixBlack from '../../assets/plagamix-black.png';
import urqBlack from '../../assets/urq-black.png';

const AUTH_KEY = ['auth'] as const;

function useAuth() {
  return useQuery({
    queryKey: AUTH_KEY,
    queryFn: async () => {
      try {
        await api('/auth/me');
        return true;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return false;
        throw error;
      }
    },
    retry: false,
    staleTime: Infinity,
  });
}

/** Layout route: renders nested routes only for an authenticated session, otherwise redirects to /login. */
export function RequireAuth() {
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
  return <Outlet />;
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

export function LoginPage() {
  const queryClient = useQueryClient();
  const auth = useAuth();
  const location = useLocation();
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: (value: string) => api('/auth/login', { body: { password: value } }),
    onSuccess: () => queryClient.setQueryData(AUTH_KEY, true),
  });

  if (auth.data) {
    const from = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={from} replace />;
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (password) login.mutate(password);
  }

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
          <h1 className="mb-6 mt-1 text-4xl font-extrabold tracking-tight">Ingresar</h1>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <Input
              label="Contraseña"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={login.error ? (login.error instanceof ApiError && login.error.status === 401 ? 'Contraseña incorrecta.' : errorMessage(login.error)) : null}
            />
            <Button type="submit" variant="accent" disabled={login.isPending || !password}>
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
