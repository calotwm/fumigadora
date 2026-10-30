import { useId, useState, type FormEvent } from 'react';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
import { Confirm } from '../../ui/Confirm';
import { Checkbox, Input, MoneyInput } from '../../ui/form';
import { EmptyState, ErrorNote, Loading, SectionHead } from '../../ui/display';
import { useToast } from '../../ui/Toast';
import { useDeleteExtra, useExtras, useSaveExtra } from '../../lib/queries';
import { errorMessage } from '../../lib/api';
import { money } from '../../lib/format';
import type { Extra } from '../../lib/types';

/** Ajustes > Extras: add-ons (bait, bait stations...) the employee bills when closing a visit. */
export function ExtrasSection() {
  const { data, error, isLoading, refetch } = useExtras();
  const [editing, setEditing] = useState<Extra | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Extra | null>(null);
  const remove = useDeleteExtra();
  const toast = useToast();

  return (
    <section aria-label="Extras">
      <SectionHead title="Extras" action={<Button size="sm" onClick={() => setEditing('new')}>Nuevo extra</Button>} />
      <p className="mb-2 text-sm text-muted">Productos o trabajos que el empleado suma al cerrar una visita. Se facturan en una línea aparte.</p>
      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorNote message={errorMessage(error)} onRetry={() => refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState title="Todavía no hay extras." />
      ) : (
        <ul className="border-t border-ink">
          {data.map((extra) => (
            <li key={extra.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-rule py-3">
              <div className="min-w-0">
                <p className={`text-base font-bold ${extra.active ? '' : 'text-muted line-through'}`}>{extra.name}</p>
                <p className="text-xs text-muted">
                  <span className="num">{money(extra.priceCents)}</span>
                  {extra.active ? '' : ' · No disponible'}
                </p>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={() => setEditing(extra)}>
                  Editar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDeleting(extra)}>
                  Eliminar
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing ? <ExtraSheet extra={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} /> : null}
      {deleting ? (
        <Confirm
          title="Eliminar extra"
          confirmLabel="Eliminar"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await remove.mutateAsync(deleting.id);
            toast.success('Extra eliminado');
          }}
        >
          <p>
            Se eliminará <strong>{deleting.name}</strong>. Si ya se usó en alguna visita no se podrá eliminar: desactivalo para que deje de ofrecerse.
          </p>
        </Confirm>
      ) : null}
    </section>
  );
}

function ExtraSheet({ extra, onClose }: { extra?: Extra; onClose: () => void }) {
  const formId = useId();
  const toast = useToast();
  const save = useSaveExtra();
  const [name, setName] = useState(extra?.name ?? '');
  const [price, setPrice] = useState<number | null>(extra?.priceCents ?? null);
  const [active, setActive] = useState(extra?.active ?? true);
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return setError('El nombre es obligatorio.');
    if (price === null || price <= 0) return setError('Ingrese el precio del extra.');
    setError(null);
    save.mutate(
      { id: extra?.id, body: { name: name.trim(), priceCents: price, active } },
      {
        onSuccess: () => {
          toast.success(extra ? 'Extra actualizado' : 'Extra creado');
          onClose();
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  }

  return (
    <Sheet
      title={extra ? 'Editar extra' : 'Nuevo extra'}
      onClose={onClose}
      variant="modal"
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} className="flex-1">
            Cancelar
          </Button>
          <Button type="submit" form={formId} disabled={save.isPending} className="flex-[2]">
            Guardar
          </Button>
        </div>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-5">
        <Input label="Nombre" value={name} onChange={(e) => setName(e.target.value)} data-autofocus required error={error} />
        <MoneyInput
          label="Precio por unidad"
          value={price}
          onChange={setPrice}
          hint="Solo se usa si el servicio no tiene precio: si lo tiene, cada extra cuesta el 30% del precio del servicio."
        />
        <Checkbox label="Disponible" hint="Si lo desactivás deja de ofrecerse a los empleados" checked={active} onChange={setActive} />
      </form>
    </Sheet>
  );
}
