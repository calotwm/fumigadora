export const CLIENT_KINDS = ['business', 'home', 'building'] as const;
export type ClientKind = (typeof CLIENT_KINDS)[number];

export const VISIT_STATUSES = ['scheduled', 'done', 'cancelled'] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

export const FREQUENCIES = [
  'none',
  'weekly',
  'biweekly',
  'monthly',
  'bimonthly',
  'quarterly',
  'semiannual',
  'yearly',
] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const USER_ROLES = ['admin', 'employee'] as const;
export type UserRole = (typeof USER_ROLES)[number];
/** Roles a session can carry: staff accounts plus `client` (portal login, bound to one client). */
export const SESSION_ROLES = [...USER_ROLES, 'client'] as const;
export type SessionRole = (typeof SESSION_ROLES)[number];

export const PAYMENT_METHODS = ['cash', 'transfer', 'mercadopago', 'check', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const CASH_KINDS = ['expense', 'income'] as const;
export type CashKind = (typeof CASH_KINDS)[number];

/** What a payment to an employee was: salary, advance or anything else. */
export const EMPLOYEE_PAY_KINDS = ['sueldo', 'adelanto', 'otro'] as const;
export type EmployeePayKind = (typeof EMPLOYEE_PAY_KINDS)[number];

/** `void` is a voided invoice; the rest follow the derived rules in docs/design.md. */
export const INVOICE_STATUSES = ['pending', 'partial', 'overdue', 'paid', 'void'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const AGING_BUCKETS = ['current', '1-30', '31-60', '61-90', '90+'] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

/** ISO calendar date, `YYYY-MM-DD`. */
export type IsoDate = string;
/** Calendar month, `YYYY-MM`. */
export type IsoMonth = string;
