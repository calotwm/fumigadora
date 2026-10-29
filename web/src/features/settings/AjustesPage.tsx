import { useId, useState, type FormEvent } from 'react';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
import { Confirm } from '../../ui/Confirm';
import { Checkbox, Input, MoneyInput } from '../../ui/form';
import { EmptyState, ErrorNote, Loading, PageHeader, SectionHead } from '../../ui/display';
import { useToast } from '../../ui/Toast';
import {
  useDeleteCategory,
  useDeleteServiceType,
  useExpenseCategories,
  useSaveCategory,
  useSaveServiceType,
  useServiceTypes,
} from '../../lib/queries';
import { errorMessage } from '../../lib/api';
import { money } from '../../lib/format';
import type { ExpenseCategory, ServiceType } from '../../lib/types';
import { ArcaSection } from './ArcaSection';
import { EmployeesSection } from './EmployeesSection';
import { ExtrasSection } from './ExtrasSection';
import { MailSection } from './MailSection';
import { RemindersSection } from './RemindersSection';

export function AjustesPage() {
  return (
    <>
      <PageHeader eyebrow="Ajustes" title="Catálogos" />
      <div className="grid gap-12 lg:grid-cols-2">
        <ServiceTypes />
        <ExtrasSection />
        <Categories />
        <EmployeesSection />
        <MailSection />
        <RemindersSection />
        <ArcaSection />
      </div>
    </>
  );
}

function ServiceTypes() {
  const { data, error, isLoading, refetch } = useServiceTypes();
  const [editing, setEditing] = useState<ServiceType | 'new' | null>(null);
  const [deleting, setDeleting] = useState<ServiceType | null>(null);
  const remove = useDeleteServiceType();
  const toast = useToast();

  return (
    <section aria-label="Tipos de servicio">
      <SectionHead title="Tipos de servicio" action={<Button size="sm" onClick={() => setEditing('new')}>Nuevo servicio</Button>} />
      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorNote message={errorMessage(error)} onRetry={() => refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState title="Todavía no hay servicios." />
      ) : (
        <ul className="border-t border-ink">
          {data.map((service) => (
            <li key={service.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-rule py-3">
              <div className="min-w-0">
                <p className="text-base font-bold">{service.name}</p>
                <p className="text-xs text-muted">
                  <span className="num">{money(service.defaultPriceCents)}</span>
                  {service.issuesCertificate ? ` · Emite oblea (${service.certificateValidityDays} días)` : ''}
                </p>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={() => setEditing(service)}>
                  Editar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDeleting(service)}>
                  Eliminar
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing ? <ServiceTypeSheet service={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} /> : null}
      {deleting ? (
        <Confirm
          title="Eliminar servicio"
          confirmLabel="Eliminar"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await remove.mutateAsync(deleting.id);
            toast.success('Servicio eliminado');
          }}
        >
          <p>
            Se eliminará <strong>{deleting.name}</strong>. Si tiene visitas registradas no se podrá eliminar.
          </p>
        </Confirm>
      ) : null}
    </section>
  );
}

function ServiceTypeSheet({ service, onClose }: { service?: ServiceType; onClose: () => void }) {
  const formId = useId();
  const toast = useToast();
  const save = useSaveServiceType();
  const [name, setName] = useState(service?.name ?? '');
  const [price, setPrice] = useState<number | null>(service?.defaultPriceCents ?? null);
  const [issues, setIssues] = useState(service?.issuesCertificate ?? false);
  const [days, setDays] = useState(service?.certificateValidityDays ? String(service.certificateValidityDays) : '180');
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const validity = Number(days);
    if (!name.trim()) return setError('El nombre es obligatorio.');
    if (issues && (!Number.isInteger(validity) || validity <= 0)) return setError('Ingrese los días de validez de la oblea.');
    setError(null);
    save.mutate(
      {
        id: service?.id,
        body: {
          name: name.trim(),
          defaultPriceCents: price ?? 0,
          issuesCertificate: issues,
          certificateValidityDays: issues ? validity : null,
        },
      },
      {
        onSuccess: () => {
          toast.success(service ? 'Servicio actualizado' : 'Servicio creado');
          onClose();
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  }

  return (
    <Sheet
      title={service ? 'Editar servicio' : 'Nuevo servicio'}
      onClose={onClose}
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
        <MoneyInput label="Precio por defecto" value={price} onChange={setPrice} />
        <Checkbox label="Emite oblea" hint="Se puede emitir al completar la visita" checked={issues} onChange={setIssues} />
        {issues ? (
          <Input
            label="Validez de la oblea (días)"
            type="number"
            min={1}
            inputMode="numeric"
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
        ) : null}
      </form>
    </Sheet>
  );
}

function Categories() {
  const { data, error, isLoading, refetch } = useExpenseCategories();
  const [editing, setEditing] = useState<ExpenseCategory | 'new' | null>(null);
  const [deleting, setDeleting] = useState<ExpenseCategory | null>(null);
  const remove = useDeleteCategory();
  const toast = useToast();

  return (
    <section aria-label="Categorías de gasto">
      <SectionHead title="Categorías de gasto" action={<Button size="sm" onClick={() => setEditing('new')}>Nueva categoría</Button>} />
      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorNote message={errorMessage(error)} onRetry={() => refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState title="Todavía no hay categorías." />
      ) : (
        <ul className="border-t border-ink">
          {data.map((category) => (
            <li key={category.id} className="flex items-center justify-between gap-2 border-b border-rule py-3">
              <p className="text-base font-bold">{category.name}</p>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={() => setEditing(category)}>
                  Editar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDeleting(category)}>
                  Eliminar
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing ? <CategorySheet category={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} /> : null}
      {deleting ? (
        <Confirm
          title="Eliminar categoría"
          confirmLabel="Eliminar"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await remove.mutateAsync(deleting.id);
            toast.success('Categoría eliminada');
          }}
        >
          <p>
            Se eliminará <strong>{deleting.name}</strong>. Si tiene gastos registrados no se podrá eliminar.
          </p>
        </Confirm>
      ) : null}
    </section>
  );
}

function CategorySheet({ category, onClose }: { category?: ExpenseCategory; onClose: () => void }) {
  const formId = useId();
  const toast = useToast();
  const save = useSaveCategory();
  const [name, setName] = useState(category?.name ?? '');
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return setError('El nombre es obligatorio.');
    save.mutate(
      { id: category?.id, name: name.trim() },
      {
        onSuccess: () => {
          toast.success(category ? 'Categoría actualizada' : 'Categoría creada');
          onClose();
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  }

  return (
    <Sheet
      title={category ? 'Editar categoría' : 'Nueva categoría'}
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
      <form id={formId} onSubmit={submit}>
        <Input label="Nombre" value={name} onChange={(e) => setName(e.target.value)} data-autofocus required error={error} />
      </form>
    </Sheet>
  );
}
