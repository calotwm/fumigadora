import { useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api';
import type { AuthUser, PortalClient, PortalVerifyResult } from '../../lib/types';
import { Button } from '../../ui/Button';
import { Loading } from '../../ui/display';
import { PortalFrame } from './PortalPage';

/** `/portal/entrar?token=`: spends the magic link, asking which client when the email belongs to several. */
export function PortalVerifyPage() {
  const token = useSearchParams()[0].get('token') ?? '';
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  function signedIn(client: PortalClient) {
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' });
    queryClient.setQueryData<AuthUser>(['auth'], { authenticated: true, role: 'client', clientId: client.id, name: client.name });
    navigate('/portal', { replace: true });
  }

  const verify = useMutation({
    mutationFn: () => api<PortalVerifyResult>('/portal/verify', { body: { token } }),
    onSuccess: (result) => result.status === 'ok' && signedIn(result.client),
  });
  const select = useMutation({
    mutationFn: (clientId: number) => api<PortalVerifyResult>('/portal/select', { body: { token, clientId } }),
    onSuccess: (result) => result.status === 'ok' && signedIn(result.client),
  });

  // Strict mode runs effects twice in development; the link is single use, so ask only once.
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current || !token) return;
    asked.current = true;
    verify.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const failure = !token ? 'El enlace está incompleto.' : verify.error ? errorMessage(verify.error) : select.error ? errorMessage(select.error) : null;
  const choices = verify.data?.status === 'choose' ? verify.data.clients : null;

  return (
    <PortalFrame client={null}>
      <div className="mx-auto max-w-sm border-t-4 border-ink pt-4">
        {failure ? (
          <>
            <h1 className="text-2xl font-extrabold tracking-tight">No pudimos abrir el enlace</h1>
            <p role="alert" className="mt-2 text-sm text-red">
              {failure}
            </p>
            <Link to="/portal" className="mt-6 inline-block text-sm font-semibold underline">
              Pedir un enlace nuevo
            </Link>
          </>
        ) : choices ? (
          <>
            <p className="label-caps">Este email figura en más de un cliente</p>
            <h1 className="mb-4 mt-1 text-2xl font-extrabold tracking-tight">¿Qué cuenta querés ver?</h1>
            <ul className="flex flex-col gap-2">
              {choices.map((client) => (
                <li key={client.id}>
                  <Button variant="outline" className="w-full !justify-start" disabled={select.isPending} onClick={() => select.mutate(client.id)}>
                    {client.name}
                  </Button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <Loading label="Abriendo tu cuenta…" />
        )}
      </div>
    </PortalFrame>
  );
}
