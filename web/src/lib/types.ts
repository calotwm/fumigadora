import type {
  AgingBucket,
  ArcaStatus,
  ClientKind,
  IssuerTaxCondition,
  IvaCondition,
  TaxDocType,
  Frequency,
  InvoiceStatus,
  IsoDate,
  IsoMonth,
  PaymentMethod,
  VisitStatus,
} from '@fumigadora/shared';

export interface BalanceFields {
  balanceCents: number;
  openCents: number;
  overdueCents: number;
  creditCents: number;
  daysOverdue: number;
  agingBucket: AgingBucket;
  overdueInvoiceCount: number;
}

export interface ClientRow {
  id: number;
  name: string;
  kind: ClientKind;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  area: string | null;
  notes: string | null;
  taxId: string | null;
  monthlyFeeCents: number | null;
  serviceFrequency: Frequency;
  defaultServiceTypeId: number | null;
  taxDocType: TaxDocType;
  taxDocNumber: string | null;
  ivaCondition: IvaCondition;
  legalName: string | null;
  archivedAt: string | null;
  createdAt: string;
  archived: boolean;
}

export interface NextVisit {
  id: number;
  date: IsoDate;
  time: string | null;
  serviceTypeId: number;
  serviceTypeName: string;
}

export interface ClientListItem extends ClientRow, BalanceFields {
  nextVisit: NextVisit | null;
  lastVisitDate: IsoDate | null;
}

export interface ClientSummary extends BalanceFields {
  nextVisits: NextVisit[];
  lastVisitDate: IsoDate | null;
  lastFrequency: Frequency | null;
  counts: { doneVisits: number; invoices: number; payments: number; certificates: number };
}

export interface ClientDetail extends ClientRow {
  summary: ClientSummary;
}

export interface InvoiceItem {
  description: string;
  quantity: number;
  unitPriceCents: number;
  amountCents: number;
}

export interface Extra {
  id: number;
  name: string;
  priceCents: number;
  active: boolean;
}

/** One extra picked on a visit: `extraId` -> quantity. */
export interface ExtraSelection {
  extraId: number;
  quantity: number;
}

export interface Invoice {
  id: number;
  clientId: number;
  visitId: number | null;
  number: string;
  issuedOn: IsoDate;
  dueOn: IsoDate;
  amountCents: number;
  description: string;
  periodMonth: IsoMonth | null;
  voided: boolean;
  status: InvoiceStatus;
  paidCents: number;
  balanceCents: number;
  isPartial: boolean;
  daysOverdue: number;
  arcaStatus: ArcaStatus;
  cbteType: number | null;
  ptoVta: number | null;
  cbteNumber: number | null;
  cae: string | null;
  caeDueOn: IsoDate | null;
  arcaObservations: { observations: { code: number; msg: string }[]; errors: { code: number; msg: string }[]; message?: string } | null;
  arcaAttemptedAt: string | null;
  /** Always at least one line; invoices without stored lines come as a single line from description and amount. */
  items: InvoiceItem[];
}

export interface Visit {
  id: number;
  clientId: number;
  serviceTypeId: number;
  date: IsoDate;
  time: string | null;
  status: VisitStatus;
  frequency: Frequency;
  notes: string | null;
  completedAt: string | null;
  cancelReason: string | null;
  priceCents: number | null;
  clientName: string;
  clientAddress: string | null;
  clientPhone: string | null;
  clientLatitude: number | null;
  clientLongitude: number | null;
  serviceTypeName: string;
  issuesCertificate: boolean;
  assignedUserId: number | null;
  assigneeName: string | null;
}

export interface Certificate {
  id: number;
  clientId: number;
  clientName: string;
  clientPhone: string | null;
  visitId: number | null;
  number: string;
  issuedOn: IsoDate;
  expiresOn: IsoDate;
  daysLeft: number;
  serviceTypeId: number | null;
  serviceTypeName: string | null;
  superseded: boolean;
  /** A PDF is stored and available at `/api/certificates/:id/file`. */
  hasFile: boolean;
}

export interface Allocation {
  invoiceId: number;
  invoiceNumber: string;
  amountCents: number;
}

export interface Payment {
  id: number;
  clientId: number;
  paidOn: IsoDate;
  amountCents: number;
  method: PaymentMethod;
  notes: string | null;
  createdAt: string;
  allocations: Allocation[];
  unallocatedCents: number;
}

export interface LedgerEntry {
  date: IsoDate;
  type: 'invoice' | 'payment';
  id: number;
  reference: string;
  description: string;
  debitCents: number;
  creditCents: number;
  balanceCents: number;
}

export interface Statement {
  client: ClientRow;
  summary: ClientSummary;
  ledger: LedgerEntry[];
  invoices: Invoice[];
  payments: Payment[];
  visits: Visit[];
  certificates: Certificate[];
}

export interface ServiceType {
  id: number;
  name: string;
  defaultPriceCents: number;
  issuesCertificate: boolean;
  certificateValidityDays: number | null;
}

export interface ExpenseCategory {
  id: number;
  name: string;
}

export interface SearchClient {
  id: number;
  name: string;
  kind: ClientKind;
  address: string | null;
  phone: string | null;
}

export interface MonthFigures {
  month: IsoMonth;
  incomeCents: number;
  expensesCents: number;
  balanceCents: number;
}

export interface Dashboard {
  today: IsoDate;
  month: MonthFigures & { previous: MonthFigures };
  receivables: {
    owedCents: number;
    overdueCents: number;
    debtorCount: number;
    overdueInvoiceCount: number;
  };
  agenda: { today: number; tomorrow: number; thisWeek: number; overdueScheduled: number };
  todayVisits: Visit[];
  topDebtors: {
    clientId: number;
    name: string;
    phone: string | null;
    balanceCents: number;
    overdueCents: number;
    daysOverdue: number;
    agingBucket: AgingBucket;
  }[];
  expiringCertificates: Certificate[];
  services: { doneThisMonth: number; doneLastMonth: number };
  clientsWithoutNextVisit: number;
  tracking: TrackingSummary;
  cashPendingCents: number;
  cashPendingCount: number;
}

export interface PaymentResult {
  payment: Payment;
  allocations: Allocation[];
  creditCents: number;
  client: { id: number } & BalanceFields;
}

export interface CompleteVisitBody {
  completedOn?: IsoDate;
  priceCents?: number;
  createInvoice?: boolean;
  issueCertificate?: boolean;
  certificateNumber?: string;
  scheduleNext?: boolean;
  nextDate?: IsoDate;
  nextTime?: string | null;
  notes?: string;
  extras?: ExtraSelection[];
}

export interface CompleteVisitResult {
  visit: Visit;
  invoice: Invoice | null;
  certificate: { id: number; number: string; expiresOn: IsoDate } | null;
  nextVisit: Visit | null;
}

export interface ClientInput {
  name: string;
  kind: ClientKind;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  area: string;
  notes: string;
  taxId: string;
  monthlyFeeCents: number | null;
  serviceFrequency: Frequency;
  defaultServiceTypeId: number | null;
  taxDocType: TaxDocType;
  taxDocNumber: string;
  ivaCondition: IvaCondition;
  legalName: string;
}

export interface Debtor extends BalanceFields {
  clientId: number;
  name: string;
  phone: string | null;
}

export interface Receivables {
  owedCents: number;
  overdueCents: number;
  openInvoicesCents: number;
  overdueInvoicesCents: number;
  overdueInvoiceCount: number;
  debtorCount: number;
  buckets: { bucket: AgingBucket; totalCents: number; invoiceCount: number; clientCount: number }[];
  debtors: Debtor[];
}

export type InvoiceWithClient = Invoice & { clientName: string };

export interface PaymentWithClient extends Payment {
  clientName: string;
}

export interface BatchPreview {
  month: IsoMonth;
  label: string;
  clients: { clientId: number; name: string; monthlyFeeCents: number }[];
  totalCents: number;
  alreadyInvoicedCount: number;
}

export interface FinanceFigures {
  month: IsoMonth;
  incomeCents: number;
  paymentsCents: number;
  otherIncomeCents: number;
  expensesCents: number;
  balanceCents: number;
}

export interface FinanceSummary extends FinanceFigures {
  byCategory: { categoryId: number; name: string; totalCents: number; share: number }[];
  previous: FinanceFigures;
  series: FinanceFigures[];
}

export interface Movement {
  type: 'payment' | 'income' | 'expense';
  id: number;
  date: IsoDate;
  direction: 'in' | 'out';
  amountCents: number;
  method: PaymentMethod | null;
  description: string | null;
  clientId: number | null;
  clientName: string | null;
  categoryId: number | null;
  categoryName: string | null;
}

export type TrackingStatus = 'pending' | 'scheduled' | 'complete';

export interface TrackingTotals {
  expected: number;
  done: number;
  scheduled: number;
  pendingUnscheduled: number;
  clientsTracked: number;
}

export interface TrackingSummary extends TrackingTotals {
  month: IsoMonth;
}

export interface TrackingRow {
  clientId: number;
  name: string;
  zone: string | null;
  frequency: Frequency;
  serviceTypeId: number | null;
  serviceTypeName: string | null;
  expected: number;
  done: number;
  scheduled: number;
  pendingUnscheduled: number;
  status: TrackingStatus;
  lastDoneOn: IsoDate | null;
  daysSinceLast: number | null;
  nextScheduled: { id: number; date: IsoDate; time: string | null } | null;
}

export interface TrackingBoard {
  month: IsoMonth;
  zones: string[];
  totals: TrackingTotals;
  rows: TrackingRow[];
}

export interface ScheduleTrackingBody {
  month: IsoMonth;
  items: { clientId: number; date: IsoDate; time?: string; serviceTypeId?: number; assignedUserId?: number | null }[];
}

// Employees and cash to hand over -------------------------------------------

export interface AuthUser {
  authenticated: true;
  role: 'admin' | 'employee' | 'client';
  userId?: number;
  /** Client the portal session is bound to (role `client`). */
  clientId?: number;
  name: string;
}

export interface UserRow {
  id: number;
  name: string;
  phone: string | null;
  username: string;
  email: string | null;
  role: 'admin' | 'employee';
  /** Can be picked as the assignee of a visit. */
  assignable: boolean;
  active: boolean;
  createdAt: string;
}

export interface UserInput {
  name: string;
  phone?: string;
  username: string;
  password: string;
  /** Empty string = none. */
  email?: string;
  role: 'admin' | 'employee';
  assignable: boolean;
}

export type NotificationKind =
  | 'day_summary'
  | 'visits_overdue'
  | 'client_email_failed'
  | 'visits_today'
  | 'visits_reminder'
  | 'visit_done'
  | 'cash_collected'
  | 'extras_added';

export interface NotificationItem {
  id: number;
  kind: NotificationKind;
  title: string;
  body: string;
  /** In-app route to open on click. */
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationList {
  unreadCount: number;
  items: NotificationItem[];
}

export interface MyVisit extends Visit {
  /** Service price extras are priced on (each one costs a share of it). */
  extraBaseCents: number;
  /** Everything the employee registered as paid at this visit (any method). */
  paidCents: number;
  /** The cash part of it: the one that is "a rendir". */
  cashCollectedCents: number;
}

export interface PostponeResult {
  visit: Visit;
  previous: { date: IsoDate; time: string | null };
}

export interface CancelResult {
  visit: Visit;
  nextVisit: Visit | null;
}

export type PaymentStatus = 'full' | 'partial' | 'none';
export type FieldPaymentMethod = 'cash' | 'transfer' | 'mercadopago';

export interface MyDoneBody {
  paymentStatus: PaymentStatus;
  method?: FieldPaymentMethod;
  /** Amount received when the payment is partial. */
  amountCents?: number;
  extras?: ExtraSelection[];
  notes?: string;
}

export interface MyVisits {
  date: IsoDate;
  /** Company location where the day route starts; null when not configured. */
  base: { latitude: number; longitude: number } | null;
  visits: MyVisit[];
  cashPending: { cents: number; count: number };
}

export interface HandoverItem {
  paymentId: number;
  date: IsoDate;
  clientId: number;
  clientName: string;
  amountCents: number;
  visitId: number | null;
}

export interface CashHandover {
  pendingCents: number;
  pendingCount: number;
  employees: { userId: number; name: string; pendingCents: number; count: number; items: HandoverItem[] }[];
  recent: (HandoverItem & { userId: number; userName: string; handedOverAt: string })[];
}

// Emails, route planner and reminders --------------------------------------

export type EmailKind = 'service_notice' | 'debt_reminder' | 'test' | 'owner_notification' | 'portal_login';
export type EmailLogStatus = 'sent' | 'simulated' | 'failed';

export interface EmailStatus {
  mode: 'resend' | 'simulated';
  from: string;
}

export interface EmailLogItem {
  id: number;
  kind: EmailKind;
  clientId: number | null;
  clientName: string | null;
  to: string;
  subject: string;
  status: EmailLogStatus;
  error: string | null;
  providerId: string | null;
  refType: string | null;
  refId: string | null;
  sentOn: IsoDate;
  createdAt: string;
  html?: string;
}

export interface EmailLogPage {
  page: number;
  pageSize: number;
  total: number;
  items: EmailLogItem[];
}

export type NoticeMode = 'on_approve' | 'days_before';

export interface AppSettings {
  debtRemindersEnabled: boolean;
  debtReminderEveryDays: number;
  debtReminderMinDaysOverdue: number;
  noticeMode: NoticeMode;
  noticeDaysBefore: number;
  arcaAutoEmit: boolean;
  companyAddress: string | null;
  companyLatitude: number | null;
  companyLongitude: number | null;
  companyPhone: string | null;
}

export interface ArcaStatusInfo {
  configured: boolean;
  env: 'homologacion' | 'produccion' | null;
  cuit: string | null;
  ptoVta: number | null;
  taxCondition: IssuerTaxCondition | null;
  missing: string[];
}

export interface ArcaCheckResult {
  ok: boolean;
  steps: { name: 'dummy' | 'login' | 'last_authorized'; ok: boolean; detail: string }[];
}

export type NoticeState = 'no_email' | 'pending' | 'scheduled' | 'sent' | 'simulated' | 'failed';

export interface RouteItem {
  id: number;
  clientId: number;
  clientName: string;
  hasEmail: boolean;
  email: string | null;
  address: string | null;
  date: IsoDate;
  time: string | null;
  serviceTypeId: number;
  serviceTypeName: string;
  frequency: Frequency;
  assignedUserId: number | null;
  assigneeName: string | null;
  zone: string | null;
  visitId: number | null;
  notice: { state: NoticeState; dueOn: IsoDate | null; emailLogId: number | null };
}

export interface RouteTotals {
  visits: number;
  clients: number;
  withEmail: number;
  withoutEmail: number;
  notices: number;
  noticesSent: number;
  noticesSimulated: number;
  noticesFailed: number;
  noticesScheduled: number;
}

export interface RouteView {
  month: IsoMonth;
  noticeMode: NoticeMode;
  noticeDaysBefore: number;
  plan: { id: number; month: IsoMonth; status: 'draft' | 'approved'; approvedAt: string | null; notifiedAt: string | null } | null;
  totals: RouteTotals;
  zones: { zone: string | null; count: number; dates: { date: IsoDate; items: RouteItem[] }[] }[];
  skipped?: { clientId: number; name: string; reason: string }[];
  notices?: { sent: number; simulated: number; failed: number };
}

export interface ReminderPreview {
  today: IsoDate;
  enabled: boolean;
  everyDays: number;
  minDaysOverdue: number;
  recipients: { clientId: number; name: string; email: string; overdueCents: number; daysOverdue: number; overdueInvoiceCount: number; lastReminderOn: IsoDate | null }[];
  skipped: Record<'disabled' | 'no_email' | 'not_overdue' | 'not_late_enough' | 'too_recent', number>;
}

// Public link and client portal ----------------------------------------------

/** What the public page `/c/:token` shows: no amounts, no tax id, no client contact data. */
export interface PublicClientView {
  name: string;
  nextVisit: { date: IsoDate; time: string | null; serviceTypeName: string } | null;
  lastVisitDate: IsoDate | null;
  certificate: { number: string; issuedOn: IsoDate; expiresOn: IsoDate; valid: boolean; daysLeft: number } | null;
  company: { name: string; phone: string | null };
}

export interface PublicLink {
  token: string;
  url: string;
}

export interface PortalVisit {
  id: number;
  date: IsoDate;
  time: string | null;
  status: VisitStatus;
  serviceTypeName: string;
}

export interface PortalCertificate {
  id: number;
  number: string;
  issuedOn: IsoDate;
  expiresOn: IsoDate;
  serviceTypeName: string | null;
  hasFile: boolean;
  valid: boolean;
  daysLeft: number;
  superseded: boolean;
}

export interface PortalSummary {
  balanceCents: number;
  openCents: number;
  overdueCents: number;
  creditCents: number;
  daysOverdue: number;
  overdueInvoiceCount: number;
  nextVisits: { id: number; date: IsoDate; time: string | null; serviceTypeName: string }[];
  lastVisitDate: IsoDate | null;
  certificate: PortalCertificate | null;
}

export interface PortalInvoice {
  id: number;
  number: string;
  issuedOn: IsoDate;
  dueOn: IsoDate;
  description: string;
  amountCents: number;
  paidCents: number;
  balanceCents: number;
  status: InvoiceStatus;
  daysOverdue: number;
  items: InvoiceItem[];
}

export interface PortalPayment {
  id: number;
  paidOn: IsoDate;
  amountCents: number;
  method: PaymentMethod;
  allocations: { invoiceNumber: string; amountCents: number }[];
}

export interface PortalClient {
  id: number;
  name: string;
}

export type PortalVerifyResult = { status: 'ok'; client: PortalClient } | { status: 'choose'; clients: PortalClient[] };

export interface PlacardItem {
  id: number;
  name: string;
  address: string | null;
  area: string | null;
  token: string;
  url: string;
}

export interface PlacardList {
  /** Zones with at least one active client. */
  zones: string[];
  items: PlacardItem[];
}
