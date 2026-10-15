import type {
  AgingBucket,
  ClientKind,
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
  priceCents: number | null;
  clientName: string;
  clientAddress: string | null;
  clientPhone: string | null;
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
  role: 'admin' | 'employee';
  userId?: number;
  name: string;
}

export interface UserRow {
  id: number;
  name: string;
  phone: string | null;
  username: string;
  role: 'admin' | 'employee';
  active: boolean;
  createdAt: string;
}

export interface UserInput {
  name: string;
  phone?: string;
  username: string;
  password: string;
}

export interface MyVisit extends Visit {
  clientBalanceCents: number;
  cashCollectedCents: number;
}

export interface MyVisits {
  date: IsoDate;
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
