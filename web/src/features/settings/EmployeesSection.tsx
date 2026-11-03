import { useId, useState, type FormEvent } from 'react';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
import { Checkbox, Input, Select } from '../../ui/form';
import { EmptyState, ErrorNote, Loading, SectionHead } from '../../ui/display';
import { useToast } from '../../ui/Toast';
import { useResetPassword, useSaveUser, useUsers } from '../../lib/queries';
import { errorMessage } from '../../lib/api';
import type { UserRow } from '../../lib/types';

const ROLE_LABELS = { admin: 'Administrador', employee: 'Empleado' } as const;

export function EmployeesSection() {
  const { data, error, isLoading, refetch } = useUsers();
  const [editing, setEditing] = useState<UserRow | 'new' | null>(null);
  const [resetting, setResetting] = useState<UserRow | null>(null);
  const save = useSaveUser();
  const toast = useToast();

  function toggleActive(user: UserRow) {
    save.mutate(
      { id: user.id, body: { active: !user.active } },
      {
        onSuccess: () => toast.success(user.active ? `${user.name} desactivado` : `${user.name} activado`),
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  }

  return (
    <section aria-label="Empleados" className="lg:col-span-2">
      <SectionHead title="Empleados" action={<Button size="sm" onClick={() => setEditing('new')}>Nuevo usuario</Button>} />
      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorNote message={errorMessage(error)} onRetry={() => refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState title="Todavía no hay usuarios. Creá uno para asignarle visitas." />
      ) : (
        <ul className="border-t border-ink">
          {data.map((user) => (
            <li key={user.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-rule py-3">
              <div className="min-w-0">
                <p className={`text-base font-bold ${user.active ? '' : 'text-muted line-through'}`}>{user.name}</p>
                <p className="text-xs text-muted">
                  {ROLE_LABELS[user.role]} · <span className="font-semibold text-ink">{user.username}</span>
                  {user.email ? ` · ${user.email}` : ''}
                  {user.phone ? ` · ${user.phone}` : ''}
                  {user.assignable ? '' : ' · No recibe visitas'}
                  {user.active ? '' : ' · Inactivo'}
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                <Button size="sm" variant="outline" onClick={() => setEditing(user)}>
                  Editar
                </Button>
                <Button size="sm" variant="outline" onClick={() => setResetting(user)}>
                  Cambiar contraseña
                </Button>
                <Button size="sm" variant="ghost" disabled={save.isPending} onClick={() => toggleActive(user)}>
                  {user.active ? 'Desactivar' : 'Activar'}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing ? <UserSheet user={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} /> : null}
      {resetting ? <PasswordSheet user={resetting} onClose={() => setResetting(null)} /> : null}
    </section>
  );
}

function UserSheet({ user, onClose }: { user?: UserRow; onClose: () => void }) {
  const formId = useId();
  const toast = useToast();
  const save = useSaveUser();
  const [name, setName] = useState(user?.name ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [role, setRole] = useState<UserRow['role']>(user?.role ?? 'employee');
  const [assignable, setAssignable] = useState(user?.assignable ?? true);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return setError('El nombre es obligatorio.');
    if (!username.trim()) return setError('El usuario es obligatorio.');
    if (!user && password.length < 6) return setError('La contraseña debe tener al menos 6 caracteres.');
    setError(null);
    const base = { name: name.trim(), phone: phone.trim(), username: username.trim().toLowerCase(), email: email.trim(), role, assignable };
    save.mutate(
      { id: user?.id, body: user ? base : { ...base, password } },
      {
        onSuccess: () => {
          toast.success(user ? 'Usuario actualizado' : 'Usuario creado');
          onClose();
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  }

  return (
    <Sheet
      title={user ? 'Editar usuario' : 'Nuevo usuario'}
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
        <Input label="Nombre" value={name} onChange={(e) => setName(e.target.value)} data-autofocus required />
        <Select
          label="Rol"
          value={role}
          onChange={(e) => {
            const next = e.target.value as UserRow['role'];
            setRole(next);
            // Employees take visits by default; administrators only when asked to.
            setAssignable(next === 'employee');
          }}
          hint="El administrador ve y gestiona todo el sistema. El empleado solo ve sus visitas desde el celular."
        >
          <option value="employee">{ROLE_LABELS.employee}</option>
          <option value="admin">{ROLE_LABELS.admin}</option>
        </Select>
        <Input label="Teléfono (opcional)" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <Input
          label="Email (opcional)"
          type="email"
          autoCapitalize="none"
          autoCorrect="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          hint="Los avisos del sistema también se envían a este mail."
        />
        <Checkbox
          label="Puede recibir visitas"
          hint="Si está activado, aparece en la lista de asignación de visitas."
          checked={assignable}
          onChange={setAssignable}
        />
        <Input
          label="Usuario"
          value={username}
          autoCapitalize="none"
          autoCorrect="off"
          onChange={(e) => setUsername(e.target.value)}
          hint="Con este usuario ingresa al sistema. Solo letras minúsculas, números, punto y guion."
          required
        />
        {!user ? (
          <Input
            label="Contraseña"
            type="text"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint="Mínimo 6 caracteres. Compartila con la persona; podés cambiarla cuando quieras."
            required
          />
        ) : null}
        {error ? (
          <p role="alert" className="text-xs text-red">
            {error}
          </p>
        ) : null}
      </form>
    </Sheet>
  );
}

function PasswordSheet({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const formId = useId();
  const toast = useToast();
  const reset = useResetPassword();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < 6) return setError('La contraseña debe tener al menos 6 caracteres.');
    setError(null);
    reset.mutate(
      { id: user.id, password },
      {
        onSuccess: () => {
          toast.success(`Contraseña de ${user.name} actualizada`);
          onClose();
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  }

  return (
    <Sheet
      title="Cambiar contraseña"
      onClose={onClose}
      variant="modal"
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} className="flex-1">
            Cancelar
          </Button>
          <Button type="submit" form={formId} disabled={reset.isPending} className="flex-[2]">
            Guardar
          </Button>
        </div>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-sm">
          Nueva contraseña para <strong>{user.name}</strong> ({user.username}).
        </p>
        <Input
          label="Contraseña nueva"
          type="text"
          autoComplete="off"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          data-autofocus
          error={error}
        />
      </form>
    </Sheet>
  );
}
