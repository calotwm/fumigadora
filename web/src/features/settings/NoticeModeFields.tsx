import { useEffect, useState } from 'react';
import { useSaveSettings, useSettings } from '../../lib/queries';
import { errorMessage } from '../../lib/api';
import type { NoticeMode } from '../../lib/types';
import { Input, Chips } from '../../ui/form';
import { useToast } from '../../ui/Toast';

const OPTIONS: { value: NoticeMode; label: string }[] = [
  { value: 'on_approve', label: 'Al aprobar el recorrido' },
  { value: 'days_before', label: 'Unos días antes de la visita' },
];

/** When service notices go out. Saves on every change; shared by Ajustes and the route approval dialog. */
export function NoticeModeFields() {
  const settings = useSettings();
  const save = useSaveSettings();
  const toast = useToast();
  const [days, setDays] = useState('7');

  useEffect(() => {
    if (settings.data) setDays(String(settings.data.noticeDaysBefore));
  }, [settings.data?.noticeDaysBefore]);

  if (!settings.data) return null;
  const { noticeMode } = settings.data;

  function commit(patch: Parameters<typeof save.mutate>[0]) {
    save.mutate(patch, { onError: (e) => toast.error(errorMessage(e)) });
  }

  return (
    <div className="flex flex-col gap-3">
      <Chips label="Enviar los avisos" value={noticeMode} options={OPTIONS} onChange={(value) => commit({ noticeMode: value })} />
      {noticeMode === 'days_before' ? (
        <Input
          label="Días de anticipación"
          type="number"
          min={1}
          max={60}
          inputMode="numeric"
          value={days}
          wrapperClassName="max-w-40"
          onChange={(e) => setDays(e.target.value)}
          onBlur={() => {
            const value = Number(days);
            if (Number.isInteger(value) && value >= 1 && value <= 60) {
              if (value !== settings.data?.noticeDaysBefore) commit({ noticeDaysBefore: value });
            } else setDays(String(settings.data?.noticeDaysBefore ?? 7));
          }}
        />
      ) : null}
    </div>
  );
}
