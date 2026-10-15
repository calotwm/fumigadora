import { Select } from '../../ui/form';
import { useUsers } from '../../lib/queries';

/** "Asignado a" select shared by every visit form. `''` = unassigned. */
export function AssigneeSelect({
  value,
  onChange,
  label = 'Asignado a',
  wrapperClassName,
  emptyLabel = 'Sin asignar',
}: {
  value: number | '';
  onChange: (value: number | '') => void;
  label?: string;
  wrapperClassName?: string;
  emptyLabel?: string;
}) {
  const users = useUsers();
  const list = (users.data ?? []).filter((u) => u.active || u.id === value);
  return (
    <Select
      label={label}
      value={value}
      wrapperClassName={wrapperClassName}
      onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
    >
      <option value="">{emptyLabel}</option>
      {list.map((user) => (
        <option key={user.id} value={user.id}>
          {user.name}
          {user.active ? '' : ' (inactivo)'}
        </option>
      ))}
    </Select>
  );
}
