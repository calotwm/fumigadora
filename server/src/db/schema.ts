import {
  bigint,
  boolean,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  time,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { CASH_KINDS, CLIENT_KINDS, FREQUENCIES, PAYMENT_METHODS, VISIT_STATUSES } from '@fumigadora/shared';

const cents = (name: string) => bigint(name, { mode: 'number' });
const isoDate = (name: string) => date(name, { mode: 'string' });
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const clientKindEnum = pgEnum('client_kind', CLIENT_KINDS);
export const visitStatusEnum = pgEnum('visit_status', VISIT_STATUSES);
export const frequencyEnum = pgEnum('frequency', FREQUENCIES);
export const paymentMethodEnum = pgEnum('payment_method', PAYMENT_METHODS);
export const cashKindEnum = pgEnum('cash_kind', CASH_KINDS);

export const clients = pgTable(
  'clients',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    kind: clientKindEnum('kind').notNull().default('business'),
    contactName: text('contact_name'),
    phone: text('phone'),
    email: text('email'),
    address: text('address'),
    area: text('area'),
    notes: text('notes'),
    taxId: text('tax_id'),
    monthlyFeeCents: cents('monthly_fee_cents'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('clients_name_idx').on(t.name)],
);

export const serviceTypes = pgTable('service_types', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  defaultPriceCents: cents('default_price_cents').notNull().default(0),
  issuesCertificate: boolean('issues_certificate').notNull().default(false),
  certificateValidityDays: integer('certificate_validity_days'),
});

export const visits = pgTable(
  'visits',
  {
    id: serial('id').primaryKey(),
    clientId: integer('client_id')
      .notNull()
      .references(() => clients.id),
    serviceTypeId: integer('service_type_id')
      .notNull()
      .references(() => serviceTypes.id),
    date: isoDate('date').notNull(),
    time: time('time'),
    status: visitStatusEnum('status').notNull().default('scheduled'),
    frequency: frequencyEnum('frequency').notNull().default('none'),
    notes: text('notes'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    priceCents: cents('price_cents'),
    createdAt: createdAt(),
  },
  (t) => [
    index('visits_date_idx').on(t.date),
    index('visits_client_idx').on(t.clientId, t.date),
    index('visits_status_date_idx').on(t.status, t.date),
  ],
);

export const certificates = pgTable(
  'certificates',
  {
    id: serial('id').primaryKey(),
    clientId: integer('client_id')
      .notNull()
      .references(() => clients.id),
    visitId: integer('visit_id').references(() => visits.id),
    number: text('number').notNull(),
    issuedOn: isoDate('issued_on').notNull(),
    expiresOn: isoDate('expires_on').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('certificates_number_uq').on(t.number),
    index('certificates_client_idx').on(t.clientId),
    index('certificates_expires_idx').on(t.expiresOn),
  ],
);

export const invoices = pgTable(
  'invoices',
  {
    id: serial('id').primaryKey(),
    clientId: integer('client_id')
      .notNull()
      .references(() => clients.id),
    visitId: integer('visit_id').references(() => visits.id),
    /** `YYYY-NNNN`, sequence restarts every year. */
    number: text('number').notNull(),
    issuedOn: isoDate('issued_on').notNull(),
    dueOn: isoDate('due_on').notNull(),
    amountCents: cents('amount_cents').notNull(),
    description: text('description').notNull().default(''),
    /** `YYYY-MM` when the invoice is a monthly-fee ("abono") invoice. */
    periodMonth: text('period_month'),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('invoices_number_uq').on(t.number),
    index('invoices_client_idx').on(t.clientId),
    index('invoices_due_idx').on(t.dueOn),
    index('invoices_period_idx').on(t.periodMonth),
  ],
);

export const payments = pgTable(
  'payments',
  {
    id: serial('id').primaryKey(),
    clientId: integer('client_id')
      .notNull()
      .references(() => clients.id),
    paidOn: isoDate('paid_on').notNull(),
    amountCents: cents('amount_cents').notNull(),
    method: paymentMethodEnum('method').notNull().default('cash'),
    notes: text('notes'),
    createdAt: createdAt(),
  },
  (t) => [index('payments_client_idx').on(t.clientId), index('payments_paid_on_idx').on(t.paidOn)],
);

export const allocations = pgTable(
  'allocations',
  {
    id: serial('id').primaryKey(),
    paymentId: integer('payment_id')
      .notNull()
      .references(() => payments.id, { onDelete: 'cascade' }),
    invoiceId: integer('invoice_id')
      .notNull()
      .references(() => invoices.id),
    amountCents: cents('amount_cents').notNull(),
  },
  (t) => [index('allocations_payment_idx').on(t.paymentId), index('allocations_invoice_idx').on(t.invoiceId)],
);

export const expenseCategories = pgTable('expense_categories', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
});

export const cashEntries = pgTable(
  'cash_entries',
  {
    id: serial('id').primaryKey(),
    kind: cashKindEnum('kind').notNull(),
    date: isoDate('date').notNull(),
    amountCents: cents('amount_cents').notNull(),
    categoryId: integer('category_id').references(() => expenseCategories.id),
    description: text('description').notNull().default(''),
    method: paymentMethodEnum('method').notNull().default('cash'),
    createdAt: createdAt(),
  },
  (t) => [index('cash_entries_date_idx').on(t.date)],
);

export type Client = typeof clients.$inferSelect;
export type ServiceType = typeof serviceTypes.$inferSelect;
export type Visit = typeof visits.$inferSelect;
export type Certificate = typeof certificates.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type CashEntry = typeof cashEntries.$inferSelect;
