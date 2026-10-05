import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';

type Variant = 'primary' | 'accent' | 'ghost' | 'outline';
type Size = 'md' | 'sm';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-ink text-paper border-ink hover:bg-ink/85',
  accent: 'bg-red text-paper border-red hover:bg-red/85',
  outline: 'bg-paper text-ink border-ink hover:bg-paper-2',
  ghost: 'bg-transparent text-ink border-transparent hover:bg-paper-2',
};

const SIZES: Record<Size, string> = {
  md: 'min-h-11 px-4 text-sm',
  sm: 'min-h-11 md:min-h-8 px-3 text-xs',
};

export function buttonClass(variant: Variant = 'primary', size: Size = 'md', extra = ''): string {
  return `inline-flex items-center justify-center gap-2 border font-semibold uppercase tracking-[0.06em] rounded-sm select-none whitespace-nowrap transition-colors disabled:opacity-40 disabled:pointer-events-none ${VARIANTS[variant]} ${SIZES[size]} ${extra}`;
}

interface CommonProps {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
}

export function Button({
  variant,
  size,
  icon,
  className = '',
  children,
  type = 'button',
  ...rest
}: CommonProps & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} className={buttonClass(variant, size, className)} {...rest}>
      {icon}
      {children}
    </button>
  );
}

export function LinkButton({
  variant,
  size,
  icon,
  className = '',
  children,
  ...rest
}: CommonProps & LinkProps) {
  return (
    <Link className={buttonClass(variant, size, className)} {...rest}>
      {icon}
      {children}
    </Link>
  );
}

export function AnchorButton({
  variant,
  size,
  icon,
  className = '',
  children,
  ...rest
}: CommonProps & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a className={buttonClass(variant, size, className)} {...rest}>
      {icon}
      {children}
    </a>
  );
}
