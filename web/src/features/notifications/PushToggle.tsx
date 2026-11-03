import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api';
import { currentSubscription, disablePush, enablePush, pushSupport } from '../../lib/push';

const hint = 'text-xs text-muted';

/** "Activar notificaciones" for this device. Hidden when the server has push turned off. */
export function PushToggle() {
  const config = useQuery({
    queryKey: ['me', 'push'],
    queryFn: () => api<{ enabled: boolean; publicKey: string | null }>('/me/push'),
    staleTime: 5 * 60_000,
  });
  const support = pushSupport();
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (support !== 'ok') return;
    currentSubscription()
      .then((s) => setSubscribed(Boolean(s) && Notification.permission === 'granted'))
      .catch(() => setSubscribed(false));
  }, [support]);

  if (!config.data?.enabled || !config.data.publicKey) return null;
  const publicKey = config.data.publicKey;

  async function toggle() {
    setBusy(true);
    setMessage(null);
    try {
      if (subscribed) {
        await disablePush();
        setSubscribed(false);
      } else if (await enablePush(publicKey)) {
        setSubscribed(true);
      } else {
        setMessage('No diste permiso. Podés habilitarlo desde los ajustes del navegador o del teléfono.');
      }
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-ink px-4 py-3">
      {support === 'ios-install' ? (
        <p className={hint}>En iPhone, primero agregá la app a la pantalla de inicio (Compartir &gt; Agregar a inicio).</p>
      ) : support === 'unsupported' ? (
        <p className={hint}>Este navegador no permite recibir notificaciones en el dispositivo.</p>
      ) : Notification.permission === 'denied' ? (
        <p className={hint}>Las notificaciones están bloqueadas. Habilitalas desde los ajustes del navegador o del teléfono.</p>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p className={hint}>{subscribed ? 'Recibís avisos en este dispositivo.' : 'Recibí los avisos como notificación del teléfono.'}</p>
          <button
            type="button"
            disabled={busy || subscribed === null}
            onClick={toggle}
            className="shrink-0 text-xs font-semibold underline underline-offset-2 disabled:no-underline disabled:opacity-40"
          >
            {subscribed ? 'Desactivar' : 'Activar notificaciones'}
          </button>
        </div>
      )}
      {message ? (
        <p role="alert" className="mt-2 text-xs text-red">
          {message}
        </p>
      ) : null}
    </div>
  );
}
