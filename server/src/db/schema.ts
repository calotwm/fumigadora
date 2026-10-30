import {
  type AnyPgColumn,
  bigint,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  time,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import {
  ARCA_STATUSES,
  CASH_KINDS,
  CLIENT_KINDS,
  EMPLOYEE_PAY_KINDS,
  FREQUENCIES,
  IVA_CONDITIONS,
  PAYMENT_METHODS,
  PRODUCT_UNITS,
  STOCK_MOVEMENT_KINDS,
  TAX_DOC_TYPES,
  USER_ROLES,
  VISIT_STATUSES,
} from '@fumigadora/shared';

const cents = (name: string) => bigint(name, { mode: 'number' });
const isoDate = (name: string) => date(name, { mode: 'string' });
/** Id of the row in the legacy system; unique when set, so the legacy import can upsert. */
const legacyId = () => integer('legacy_id');
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const clientKindEnum = pgEnum('client_kind', CLIENT_KINDS);
export const visitStatusEnum = pgEnum('visit_status', VISIT_STATUSES);
export const frequencyEnum = pgEnum('frequency', FREQUENCIES);
export const paymentMethodEnum = pgEnum('payment_method', PAYMENT_METHODS);
export const cashKindEnum = pgEnum('cash_kind', CASH_KINDS);
export const productUnitEnum = pgEnum('product_unit', PRODUCT_UNITS);
export const stockMovementKindEnum = pgEnum('stock_movement_kind', STOCK_MOVEMENT_KINDS);
export const employeePayKindEnum = pgEnum('employee_pay_kind', EMPLOYEE_PAY_KINDS);
export const userRoleEnum = pgEnum('user_role', USER_ROLES);
export const taxDocTypeEnum = pgEnum('tax_doc_type', TAX_DOC_TYPES);
export const ivaConditionEnum = pgEnum('iva_condition', IVA_CONDITIONS);
export const arcaStatusEnum = pgEnum('arca_status', ARCA_STATUSES);
export const EMAIL_KINDS = ['service_notice', 'debt_reminder', 'test', 'owner_notification', 'portal_login'] as const;
export const EMAIL_STATUSES = ['sent', 'simulated', 'failed'] as const;
export const ROUTE_PLAN_STATUSES = ['draft', 'approved'] as const;
export const emailKindEnum = pgEnum('email_kind', EMAIL_KINDS);
export const NOTIFICATION_KINDS = [
  'day_summary',
  'visits_overdue',
  'client_email_failed',
  'visits_today',
  'visits_reminder',
  'visit_done',
  'cash_collected',
  'extras_added',
  'visit_postponed',
  'visit_cancelled',
] as const;
export const notificationKindEnum = pgEnum('notification_kind', NOTIFICATION_KINDS);
export const emailStatusEnum = pgEnum('email_status', EMAIL_STATUSES);
export const routePlanStatusEnum = pgEnum('route_plan_status', ROUTE_PLAN_STATUSES);

export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    phone: text('phone'),
    /** Lowercase login name. */
    username: text('username').notNull(),
    /** `scrypt$<salt b64>$<hash b64>`; never leaves the server. */
    passwordHash: text('password_hash').notNull(),
    role: userRoleEnum('role').notNull().default('employee'),
    /** Lowercase and optional; unique when present. Notification emails go here. */
    email: text('email'),
    /** Can be picked as the assignee of a visit: on for employees, opt-in for admins. */
    assignable: boolean('assignable').notNull().default(true),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('users_username_uq').on(t.username), uniqueIndex('users_email_uq').on(t.email)],
);

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
    /** Service plan: how often the client should be serviced (`none` = no plan, not tracked). */
    serviceFrequency: frequencyEnum('service_frequency').notNull().default('none'),
    /** Service type the plan refers to; null = any service counts. */
    defaultServiceTypeId: integer('default_service_type_id').references((): AnyPgColumn => serviceTypes.id),
    /** Fiscal data for electronic invoicing ("Datos fiscales"). */
    taxDocType: taxDocTypeEnum('tax_doc_type').notNull().default('none'),
    taxDocNumber: text('tax_doc_number'),
    ivaCondition: ivaConditionEnum('iva_condition').notNull().default('consumidor_final'),
    /** Razón social. */
    legalName: text('legal_name'),
    /** Location (kept next to `address`; `area` is the delivery zone). */
    city: text('city'),
    province: text('province'),
    postalCode: text('postal_code'),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    /** Unguessable token of the public link `/c/<token>` (QR placard). Regenerating it kills the old link. */
    publicToken: text('public_token'),
    legacyId: legacyId(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('clients_name_idx').on(t.name),
    uniqueIndex('clients_legacy_id_uq').on(t.legacyId),
    uniqueIndex('clients_public_token_uq').on(t.publicToken),
  ],
);

/** Extra contact people of a client (administrator, doorman...), in addition to the main contact on the client. */
export const clientContacts = pgTable(
  'client_contacts',
  {
    id: serial('id').primaryKey(),
    clientId: integer('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    phone: text('phone'),
    whatsapp: text('whatsapp'),
    email: text('email'),
    /** Role of the person, e.g. administrator. */
    position: text('position'),
    notes: text('notes'),
    legacyId: legacyId(),
    createdAt: createdAt(),
  },
  (t) => [index('client_contacts_client_idx').on(t.clientId), uniqueIndex('client_contacts_legacy_id_uq').on(t.legacyId)],
);

export const serviceTypes = pgTable('service_types', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  defaultPriceCents: cents('default_price_cents').notNull().default(0),
  issuesCertificate: boolean('issues_certificate').notNull().default(false),
  certificateValidityDays: integer('certificate_validity_days'),
});

/** Catalog of add-ons the employee can bill when closing a visit (bait, bait stations...). Never deleted once used: deactivate instead. */
export const extras = pgTable('extras', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  priceCents: cents('price_cents').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
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
    /** Why a visit was cancelled, when the employee reported it. */
    cancelReason: text('cancel_reason'),
    priceCents: cents('price_cents'),
    /** Employee who has to perform the visit (null = unassigned). */
    assignedUserId: integer('assigned_user_id').references(() => users.id),
    legacyId: legacyId(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('visits_legacy_id_uq').on(t.legacyId),
    index('visits_assigned_idx').on(t.assignedUserId, t.date),
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
    description: text('description'),
    /** URL of the certificate PDF in the legacy system, until the file is copied to our own storage. */
    legacyFileUrl: text('legacy_file_url'),
    /** PDF location relative to FILES_DIR (e.g. `certificates/12.pdf`); null while no file is stored. */
    fileKey: text('file_key'),
    fileSize: integer('file_size'),
    legacyId: legacyId(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('certificates_legacy_id_uq').on(t.legacyId),
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
    /** ARCA electronic invoicing state; `not_sent` until the invoice is emitted. */
    arcaStatus: arcaStatusEnum('arca_status').notNull().default('not_sent'),
    cbteType: integer('cbte_type'),
    ptoVta: integer('pto_vta'),
    cbteNumber: integer('cbte_number'),
    cae: text('cae'),
    caeDueOn: isoDate('cae_due_on'),
    /** JSON text: `{ observations: [{code,msg}], errors: [{code,msg}], message? }`. */
    arcaObservations: text('arca_observations'),
    arcaAttemptedAt: timestamp('arca_attempted_at', { withTimezone: true }),
    /** Number requested in the last attempt; lets a retry reconcile a lost answer. */
    arcaAttemptedNumber: integer('arca_attempted_number'),
    legacyId: legacyId(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('invoices_legacy_id_uq').on(t.legacyId),
    uniqueIndex('invoices_number_uq').on(t.number),
    index('invoices_client_idx').on(t.clientId),
    index('invoices_due_idx').on(t.dueOn),
    index('invoices_period_idx').on(t.periodMonth),
  ],
);

/** Lines of an invoice. `invoices.amountCents` is always their sum; invoices without rows (legacy, manual, monthly fee) are one implicit line. */
export const invoiceItems = pgTable(
  'invoice_items',
  {
    id: serial('id').primaryKey(),
    invoiceId: integer('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    description: text('description').notNull(),
    quantity: integer('quantity').notNull().default(1),
    unitPriceCents: cents('unit_price_cents').notNull(),
    amountCents: cents('amount_cents').notNull(),
    /** Catalog extra the line came from; null for the base service line. */
    extraId: integer('extra_id').references(() => extras.id),
  },
  (t) => [index('invoice_items_invoice_idx').on(t.invoiceId)],
);

/** Extras added to a visit when it was completed (name and price are a snapshot of the catalog at that moment). */
export const visitExtras = pgTable(
  'visit_extras',
  {
    id: serial('id').primaryKey(),
    visitId: integer('visit_id')
      .notNull()
      .references(() => visits.id),
    extraId: integer('extra_id')
      .notNull()
      .references(() => extras.id),
    name: text('name').notNull(),
    quantity: integer('quantity').notNull(),
    unitPriceCents: cents('unit_price_cents').notNull(),
  },
  (t) => [index('visit_extras_visit_idx').on(t.visitId)],
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
    /** Employee who collected this cash in the field (null = registered by the owner). */
    collectedByUserId: integer('collected_by_user_id').references(() => users.id),
    /** Visit the cash was collected at, when known. */
    visitId: integer('visit_id').references(() => visits.id),
    /** When the owner confirmed receiving the cash; null while it is still "a rendir". */
    handedOverAt: timestamp('handed_over_at', { withTimezone: true }),
    legacyId: legacyId(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('payments_legacy_id_uq').on(t.legacyId), index('payments_collected_idx').on(t.collectedByUserId, t.handedOverAt), index('payments_client_idx').on(t.clientId), index('payments_paid_on_idx').on(t.paidOn)],
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
    /** Employee the expense belongs to: a payment to them (with `payKind`) or something they spent (fuel). */
    employeeId: integer('employee_id').references(() => users.id),
    /** Set only on payments to an employee (salary, advance, other). */
    payKind: employeePayKindEnum('pay_kind'),
    /** Photo of the receipt under FILES_DIR (fuel loads from the employee app) and its media type. */
    receiptKey: text('receipt_key'),
    receiptType: text('receipt_type'),
    createdAt: createdAt(),
  },
  (t) => [index('cash_entries_date_idx').on(t.date), index('cash_entries_employee_idx').on(t.employeeId, t.date)],
);

/** Every email the system tried to send (real, simulated or failed). */
export const emailLog = pgTable(
  'email_log',
  {
    id: serial('id').primaryKey(),
    kind: emailKindEnum('kind').notNull(),
    clientId: integer('client_id').references(() => clients.id),
    to: text('to').notNull(),
    subject: text('subject').notNull(),
    html: text('html').notNull(),
    status: emailStatusEnum('status').notNull(),
    error: text('error'),
    providerId: text('provider_id'),
    /** What the email is about, e.g. `route_plan` / `2025-06` or `debt_reminder` / the run date. */
    refType: text('ref_type'),
    refId: text('ref_id'),
    /** Business date (America/Argentina/Buenos_Aires) of the attempt; drives the reminder interval. */
    sentOn: isoDate('sent_on').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('email_log_client_idx').on(t.clientId, t.kind), index('email_log_created_idx').on(t.createdAt)],
);

/** In-app notification addressed to one user (the bell). Generators dedupe on `dedupeKey`, so reruns never repeat one. */
export const notifications = pgTable(
  'notifications',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: notificationKindEnum('kind').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    /** In-app route to open when the notification is clicked. */
    link: text('link'),
    /** What it is about, e.g. `email_log` / the log id. */
    refType: text('ref_type'),
    refId: text('ref_id'),
    /** `<userId>:<kind>:<refType>:<refId>:<business date>`. */
    dedupeKey: text('dedupe_key').notNull(),
    /** Live alerts of one employee and kind share a group while unread; a burst updates the row instead of adding one. */
    groupKey: text('group_key'),
    groupCount: integer('group_count').notNull().default(1),
    groupAmountCents: cents('group_amount_cents'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('notifications_dedupe_uq').on(t.dedupeKey), index('notifications_user_idx').on(t.userId, t.createdAt)],
);

/** Browser/phone endpoints that receive Web Push for a user; one row per device. */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('push_subscriptions_endpoint_uq').on(t.endpoint), index('push_subscriptions_user_idx').on(t.userId)],
);

/**
 * Magic-link tokens of the client portal. Only the sha256 of the token is stored; it expires 30 minutes after being
 * issued and works once. `email` is what the link was requested with: the clients it opens are resolved at use time.
 */
export const clientLoginTokens = pgTable(
  'client_login_tokens',
  {
    id: serial('id').primaryKey(),
    tokenHash: text('token_hash').notNull(),
    email: text('email').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('client_login_tokens_hash_uq').on(t.tokenHash), index('client_login_tokens_expires_idx').on(t.expiresAt)],
);

/** Month route proposed by the system and reviewed by the owner. One per month. */
export const routePlans = pgTable(
  'route_plans',
  {
    id: serial('id').primaryKey(),
    /** `YYYY-MM`. */
    month: text('month').notNull(),
    status: routePlanStatusEnum('status').notNull().default('draft'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('route_plans_month_uq').on(t.month)],
);

export const routePlanItems = pgTable(
  'route_plan_items',
  {
    id: serial('id').primaryKey(),
    planId: integer('plan_id')
      .notNull()
      .references(() => routePlans.id, { onDelete: 'cascade' }),
    clientId: integer('client_id')
      .notNull()
      .references(() => clients.id),
    date: isoDate('date').notNull(),
    time: time('time'),
    serviceTypeId: integer('service_type_id')
      .notNull()
      .references(() => serviceTypes.id),
    assignedUserId: integer('assigned_user_id').references(() => users.id),
    zone: text('zone'),
    /** Set when the plan is approved. */
    visitId: integer('visit_id').references(() => visits.id),
    /** Day the service notice must go out (set on approval). */
    noticeDueOn: isoDate('notice_due_on'),
    noticeEmailLogId: integer('notice_email_log_id').references(() => emailLog.id),
    createdAt: createdAt(),
  },
  (t) => [index('route_plan_items_plan_idx').on(t.planId), index('route_plan_items_notice_idx').on(t.noticeDueOn)],
);

/** Key/value application settings (JSON values). */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
});

/** Cached WSAA access ticket (token + sign) per environment and service; reused until it expires. */
export const arcaTokens = pgTable(
  'arca_tokens',
  {
    id: serial('id').primaryKey(),
    env: text('env').notNull(),
    service: text('service').notNull(),
    token: text('token').notNull(),
    sign: text('sign').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('arca_tokens_env_service_uq').on(t.env, t.service)],
);

/** One row per job and business day: the guard that stops a restart from running the daily job twice. */
export const jobRuns = pgTable(
  'job_runs',
  {
    id: serial('id').primaryKey(),
    job: text('job').notNull(),
    runDate: isoDate('run_date').notNull(),
    result: jsonb('result'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('job_runs_job_date_uq').on(t.job, t.runDate)],
);

/** One row per IPC price update applied: what was raised, by how much and by whom. Invoices are never touched. */
export const priceAdjustments = pgTable('price_adjustments', {
  id: serial('id').primaryKey(),
  /** 320 = 3.2 %. */
  percentBasisPoints: integer('percent_basis_points').notNull(),
  /** `none` | `100` | `1000` (see PRICE_ROUNDINGS). */
  rounding: text('rounding').notNull(),
  /** PRICE_SCOPES chosen for this application. */
  scopes: jsonb('scopes').$type<string[]>().notNull(),
  /** Null for the emergency owner session (no user row). */
  userId: integer('user_id').references(() => users.id),
  userName: text('user_name').notNull(),
  itemCount: integer('item_count').notNull(),
  /** Snapshot of every changed price: { scope, id, name, detail, date, oldCents, newCents }[]. */
  items: jsonb('items').notNull(),
  createdAt: createdAt(),
});

/** Quantity in thousandths of the product's unit (2.5 litros = 2500). */
const milli = (name: string) => bigint(name, { mode: 'number' });

/** Products used in the field (insecticides, baits...). Stock is the sum of their movements. */
export const products = pgTable('products', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  unit: productUnitEnum('unit').notNull(),
  /** Low-stock mark below this quantity; null = no minimum. */
  minQuantityMilli: milli('min_quantity_milli'),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
});

/** Stock movement: signed quantity (purchase +, use -, adjustment either way). */
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: serial('id').primaryKey(),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id),
    kind: stockMovementKindEnum('kind').notNull(),
    date: isoDate('date').notNull(),
    quantityMilli: milli('quantity_milli').notNull(),
    /** Visit the product was used at, when registered while closing it. */
    visitId: integer('visit_id').references(() => visits.id),
    userId: integer('user_id').references(() => users.id),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [index('stock_movements_product_idx').on(t.productId, t.date), index('stock_movements_date_idx').on(t.date)],
);

/** Bait stations of a client ("cebaderos"): code, where to find it and an optional photo under FILES_DIR. */
export const baitStations = pgTable(
  'bait_stations',
  {
    id: serial('id').primaryKey(),
    clientId: integer('client_id')
      .notNull()
      .references(() => clients.id),
    code: text('code').notNull(),
    reference: text('reference').notNull().default(''),
    photoKey: text('photo_key'),
    photoType: text('photo_type'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('bait_stations_client_code_uq').on(t.clientId, t.code)],
);

/** PDF documents of a client (e.g. the bait-station plan), stored under FILES_DIR. */
export const clientDocuments = pgTable(
  'client_documents',
  {
    id: serial('id').primaryKey(),
    clientId: integer('client_id')
      .notNull()
      .references(() => clients.id),
    name: text('name').notNull(),
    fileKey: text('file_key').notNull(),
    fileSize: integer('file_size').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('client_documents_client_idx').on(t.clientId)],
);

export type User = typeof users.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
export type Client = typeof clients.$inferSelect;
export type ClientContact = typeof clientContacts.$inferSelect;
export type ServiceType = typeof serviceTypes.$inferSelect;
export type Extra = typeof extras.$inferSelect;
export type Visit = typeof visits.$inferSelect;
export type Certificate = typeof certificates.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type CashEntry = typeof cashEntries.$inferSelect;
export type EmailLog = typeof emailLog.$inferSelect;
export type RoutePlan = typeof routePlans.$inferSelect;
export type RoutePlanItem = typeof routePlanItems.$inferSelect;
export type PriceAdjustment = typeof priceAdjustments.$inferSelect;
