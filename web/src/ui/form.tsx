import {
  useEffect,
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { parseMoney } from '@fumigadora/shared';
import { moneyPlain } from '../lib/format';

const CONTROL =
  'block w-full min-h-11 bg-paper text-ink text-base border border-ink rounded-sm px-3 placeholder:text-muted/70 disabled:bg-paper-2 disabled:text-muted';

interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  className?: string;
  children: (id: string) => ReactNode;
}

/** Label + control + hint/error wrapper. The control receives the generated id. */
export function Field({ label, hint, error, className = '', children }: FieldProps) {
  const id = useId();
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="label-caps">
        {label}
      </label>
      {children(id)}
      {error ? (
        <p role="alert" className="text-xs text-red">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

type BaseProps = { label: string; hint?: ReactNode; error?: string | null; wrapperClassName?: string };

export function Input({
  label,
  hint,
  error,
  wrapperClassName,
  className = '',
  ...rest
}: BaseProps & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field label={label} hint={hint} error={error} className={wrapperClassName}>
      {(id) => <input id={id} className={`${CONTROL} ${className}`} aria-invalid={!!error} {...rest} />}
    </Field>
  );
}

export function Textarea({
  label,
  hint,
  error,
  wrapperClassName,
  className = '',
  ...rest
}: BaseProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Field label={label} hint={hint} error={error} className={wrapperClassName}>
      {(id) => <textarea id={id} rows={3} className={`${CONTROL} py-2 ${className}`} {...rest} />}
    </Field>
  );
}

export function Select({
  label,
  hint,
  error,
  wrapperClassName,
  className = '',
  children,
  ...rest
}: BaseProps & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Field label={label} hint={hint} error={error} className={wrapperClassName}>
      {(id) => (
        <select id={id} className={`${CONTROL} ${className}`} {...rest}>
          {children}
        </select>
      )}
    </Field>
  );
}

export function DateInput({
  label,
  hint,
  error,
  wrapperClassName,
  className = '',
  ...rest
}: BaseProps & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return (
    <Field label={label} hint={hint} error={error} className={wrapperClassName}>
      {(id) => <input id={id} type="date" className={`${CONTROL} ${className}`} {...rest} />}
    </Field>
  );
}

interface MoneyInputProps {
  label: string;
  value: number | null;
  onChange: (cents: number | null) => void;
  hint?: ReactNode;
  error?: string | null;
  wrapperClassName?: string;
  autoFocus?: boolean;
  required?: boolean;
}

/** Accepts "150.000", "150000,50" etc. via `parseMoney`; reformats on blur. Emits integer cents. */
export function MoneyInput({
  label,
  value,
  onChange,
  hint,
  error,
  wrapperClassName,
  autoFocus,
  required,
}: MoneyInputProps) {
  const [text, setText] = useState(value === null ? '' : moneyPlain(value));

  // Sync when the parent changes the value programmatically (e.g. "Todo el saldo").
  useEffect(() => {
    setText((current) => {
      const parsed = current.trim() === '' ? null : parseMoney(current);
      if (parsed === value) return current;
      return value === null ? '' : moneyPlain(value);
    });
  }, [value]);

  const invalid = text.trim() !== '' && parseMoney(text) === null;

  return (
    <Field
      label={label}
      hint={hint}
      error={error ?? (invalid ? 'Ingrese un importe válido, por ejemplo 150.000' : null)}
      className={wrapperClassName}
    >
      {(id) => (
        <div className="relative">
          <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
            $
          </span>
          <input
            id={id}
            inputMode="decimal"
            autoComplete="off"
            autoFocus={autoFocus}
            required={required}
            aria-invalid={invalid || !!error}
            className={`${CONTROL} pl-7 text-right font-semibold num`}
            value={text}
            placeholder="0"
            onChange={(e) => {
              setText(e.target.value);
              const raw = e.target.value.trim();
              onChange(raw === '' ? null : parseMoney(raw));
            }}
            onBlur={() => {
              const parsed = parseMoney(text);
              if (parsed !== null && text.trim() !== '') setText(moneyPlain(parsed));
            }}
          />
        </div>
      )}
    </Field>
  );
}

interface ChipsProps<T extends string | number> {
  label: string;
  value: T | null;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}

/** Single-choice chips (radio semantics) for short enumerations like payment method. */
export function Chips<T extends string | number>({ label, value, options, onChange }: ChipsProps<T>) {
  const id = useId();
  return (
    <div role="radiogroup" aria-labelledby={id} className="flex flex-col gap-1">
      <span id={id} className="label-caps">
        {label}
      </span>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(option.value)}
              className={`min-h-11 px-3 text-sm font-medium border rounded-sm transition-colors ${
                active ? 'bg-yellow text-ink border-ink font-semibold' : 'bg-paper text-ink border-rule hover:border-ink'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Checkbox({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex items-start gap-3 min-h-11 py-2 cursor-pointer">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 size-5 accent-ink"
      />
      <span className="flex flex-col">
        <span className="text-sm font-medium">{label}</span>
        {hint ? <span className="text-xs text-muted">{hint}</span> : null}
      </span>
    </label>
  );
}
