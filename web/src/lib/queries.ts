import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from './api';
import type {
  CashHandover,
  MyVisits,
  UserInput,
  UserRow,
  ClientDetail,
  ClientInput,
  ClientListItem,
  ClientRow,
  CompleteVisitBody,
  CompleteVisitResult,
  BatchPreview,
  Dashboard,
  FinanceSummary,
  InvoiceWithClient,
  Movement,
  PaymentWithClient,
  ScheduleTrackingBody,
  TrackingBoard,
  TrackingStatus,
  Receivables,
  ExpenseCategory,
  Invoice,
  PaymentResult,
  SearchClient,
  ServiceType,
  Statement,
  Visit,
} from './types';
import type { Frequency, PaymentMethod } from '@fumigadora/shared';

/** Keys that hold reference data and never change as a result of a business mutation. */
const STATIC_KEYS = new Set(['auth', 'service-types', 'expense-categories', 'search']);

/** After any write, every derived view (client, ledger, lists, dashboard, receivables, finance...) refreshes. */
export function invalidateData(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({
    predicate: (query) => !STATIC_KEYS.has(String(query.queryKey[0])),
  });
}

export function useDashboard() {
  return useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/dashboard') });
}

export interface ClientListParams {
  search: string;
  filter: 'all' | 'debt' | 'overdue' | 'archived';
  sort: 'name' | 'balance' | 'overdue';
}

export function useClients(params: ClientListParams) {
  return useQuery({
    queryKey: ['clients', params],
    queryFn: () =>
      api<ClientListItem[]>('/clients', {
        query: {
          search: params.search.trim(),
          filter: params.filter === 'archived' ? 'all' : params.filter,
          sort: params.sort,
          archived: params.filter === 'archived' ? 'true' : undefined,
        },
      }),
    placeholderData: (previous) => previous,
  });
}

export function useClient(id: number | null) {
  return useQuery({
    queryKey: ['client', id],
    queryFn: () => api<ClientDetail>(`/clients/${id}`),
    enabled: id !== null,
  });
}

export function useStatement(id: number | null) {
  return useQuery({
    queryKey: ['statement', id],
    queryFn: () => api<Statement>(`/clients/${id}/statement`),
    enabled: id !== null,
  });
}

export function useServiceTypes() {
  return useQuery({
    queryKey: ['service-types'],
    queryFn: () => api<ServiceType[]>('/service-types'),
    staleTime: 5 * 60_000,
  });
}

export function useExpenseCategories() {
  return useQuery({
    queryKey: ['expense-categories'],
    queryFn: () => api<ExpenseCategory[]>('/expense-categories'),
    staleTime: 5 * 60_000,
  });
}

export function useClientSearch(query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: ['search', q],
    queryFn: () => api<{ clients: SearchClient[] }>('/search', { query: { q } }),
    enabled: q.length > 0,
    placeholderData: (previous) => previous,
  });
}

export interface PaymentInput {
  clientId: number;
  amountCents: number;
  paidOn: string;
  method: PaymentMethod;
  notes?: string;
  invoiceId?: number;
}

export function useCreatePayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: PaymentInput) => api<PaymentResult>('/payments', { body }),
    onSuccess: () => invalidateData(queryClient),
  });
}

export interface InvoiceInput {
  clientId: number;
  amountCents: number;
  issuedOn: string;
  dueOn: string;
  description?: string;
}

export function useCreateInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: InvoiceInput) => api<Invoice>('/invoices', { body }),
    onSuccess: () => invalidateData(queryClient),
  });
}

export interface VisitInput {
  clientId: number;
  serviceTypeId: number;
  date: string;
  time?: string;
  frequency: Frequency;
  notes?: string;
  assignedUserId?: number | null;
}

export function useCreateVisit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: VisitInput) => api<Visit>('/visits', { body }),
    onSuccess: () => invalidateData(queryClient),
  });
}

export function useCompleteVisit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: CompleteVisitBody }) =>
      api<CompleteVisitResult>(`/visits/${id}/complete`, { body }),
    onSuccess: () => invalidateData(queryClient),
  });
}

export function useSaveClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: number; input: ClientInput }) =>
      id === undefined
        ? api<ClientRow>('/clients', { body: input })
        : api<ClientRow>(`/clients/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => invalidateData(queryClient),
  });
}

export function useArchiveClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<ClientRow>(`/clients/${id}/archive`, { method: 'POST', body: {} }),
    onSuccess: () => invalidateData(queryClient),
  });
}

export function useAgendaSummary() {
  return useQuery({
    queryKey: ['agenda', 'summary'],
    queryFn: () => api<{ today: number; tomorrow: number; thisWeek: number; overdueScheduled: number }>('/agenda/summary'),
  });
}

export function useVisits(
  params: { from?: string; to?: string; status?: string; clientId?: number; assignedUserId?: number },
  enabled = true,
) {
  return useQuery({
    queryKey: ['visits', params],
    queryFn: () => api<Visit[]>('/visits', { query: params }),
    placeholderData: (previous) => previous,
    enabled,
  });
}

export function useTracking(params: { month: string; zone?: string; status?: TrackingStatus }) {
  return useQuery({
    queryKey: ['tracking', params],
    queryFn: () => api<TrackingBoard>('/tracking', { query: params }),
    placeholderData: (previous) => previous,
  });
}

export function useScheduleTracking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ScheduleTrackingBody) => api<{ created: Visit[] }>('/tracking/schedule', { body }),
    onSuccess: () => invalidateData(queryClient),
  });
}

export function useRescheduleVisit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, date, time, assignedUserId }: { id: number; date: string; time: string | null; assignedUserId?: number | null }) =>
      api<Visit>(`/visits/${id}`, { method: 'PATCH', body: { date, time, ...(assignedUserId === undefined ? {} : { assignedUserId }) } }),
    onSuccess: () => invalidateData(queryClient),
  });
}

export function useCancelVisit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<Visit>(`/visits/${id}/cancel`, { method: 'POST', body: {} }),
    onSuccess: () => invalidateData(queryClient),
  });
}

export function useReceivables() {
  return useQuery({ queryKey: ['receivables'], queryFn: () => api<Receivables>('/receivables') });
}

export function useInvoices(status: string) {
  return useQuery({
    queryKey: ['invoices', status],
    queryFn: () => api<InvoiceWithClient[]>('/invoices', { query: { status } }),
    placeholderData: (previous) => previous,
  });
}

export function usePayments(from: string | undefined) {
  return useQuery({
    queryKey: ['payments', from ?? 'all'],
    queryFn: () => api<PaymentWithClient[]>('/payments', { query: { from } }),
    placeholderData: (previous) => previous,
  });
}

export function useVoidInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<Invoice>(`/invoices/${id}/void`, { method: 'POST', body: {} }),
    onSuccess: () => invalidateData(queryClient),
  });
}

export function useDeletePayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api(`/payments/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateData(queryClient),
  });
}

export function useBatchPreview(month: string) {
  return useQuery({
    queryKey: ['batch-preview', month],
    queryFn: () => api<BatchPreview>('/invoices/monthly-batch/preview', { method: 'POST', query: { month }, body: {} }),
    gcTime: 0,
  });
}

export function useCreateBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { month: string; clientIds: number[] }) =>
      api<{ created: Invoice[]; skipped: { clientId: number; reason: string }[]; totalCents: number }>(
        '/invoices/monthly-batch',
        { body },
      ),
    onSuccess: () => invalidateData(queryClient),
  });
}

export function useFinanceSummary(month: string) {
  return useQuery({
    queryKey: ['finance', 'summary', month],
    queryFn: () => api<FinanceSummary>('/finance/summary', { query: { month } }),
    placeholderData: (previous) => previous,
  });
}

export function useMovements(month: string) {
  return useQuery({
    queryKey: ['finance', 'movements', month],
    queryFn: () => api<{ month: string; movements: Movement[] }>('/finance/movements', { query: { month } }),
    placeholderData: (previous) => previous,
  });
}

export interface CashEntryInput {
  kind: 'expense' | 'income';
  amountCents: number;
  date: string;
  categoryId?: number;
  description?: string;
  method: PaymentMethod;
}

export function useSaveCashEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: number; body: CashEntryInput }) =>
      id === undefined
        ? api('/cash-entries', { body })
        : api(`/cash-entries/${id}`, {
            method: 'PATCH',
            body: {
              amountCents: body.amountCents,
              date: body.date,
              categoryId: body.categoryId,
              description: body.description ?? '',
              method: body.method,
            },
          }),
    onSuccess: () => invalidateData(queryClient),
  });
}

export function useDeleteCashEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api(`/cash-entries/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateData(queryClient),
  });
}

export function useUnarchiveClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<ClientRow>(`/clients/${id}/unarchive`, { method: 'POST', body: {} }),
    onSuccess: () => invalidateData(queryClient),
  });
}

// Settings (reference data) -------------------------------------------------

export interface ServiceTypeInput {
  name: string;
  defaultPriceCents: number;
  issuesCertificate: boolean;
  certificateValidityDays?: number | null;
}

export function useSaveServiceType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: number; body: ServiceTypeInput }) =>
      id === undefined
        ? api<ServiceType>('/service-types', { body })
        : api<ServiceType>(`/service-types/${id}`, { method: 'PATCH', body }),
    onSuccess: () => queryClient.invalidateQueries(),
  });
}

export function useDeleteServiceType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api(`/service-types/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['service-types'] }),
  });
}

export function useSaveCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id?: number; name: string }) =>
      id === undefined
        ? api<ExpenseCategory>('/expense-categories', { body: { name } })
        : api<ExpenseCategory>(`/expense-categories/${id}`, { method: 'PATCH', body: { name } }),
    onSuccess: () => queryClient.invalidateQueries(),
  });
}

export function useDeleteCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api(`/expense-categories/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['expense-categories'] }),
  });
}

// Employees ------------------------------------------------------------------

export function useUsers() {
  return useQuery({ queryKey: ['users'], queryFn: () => api<UserRow[]>('/users'), staleTime: 60_000 });
}

export interface UserPatch {
  name?: string;
  phone?: string;
  username?: string;
  active?: boolean;
}

export function useSaveUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: number; body: UserInput | UserPatch }) =>
      id === undefined ? api<UserRow>('/users', { body }) : api<UserRow>(`/users/${id}`, { method: 'PATCH', body }),
    // Assignee names appear on visits, so refresh everything that is not static.
    onSuccess: () => Promise.all([queryClient.invalidateQueries({ queryKey: ['users'] }), invalidateData(queryClient)]),
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: ({ id, password }: { id: number; password: string }) =>
      api<{ ok: true }>(`/users/${id}/password`, { body: { password } }),
  });
}

export function useCashHandover() {
  return useQuery({ queryKey: ['cash-handover'], queryFn: () => api<CashHandover>('/cash-handover') });
}

export function useConfirmHandover() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (paymentIds: number[]) =>
      api<{ confirmed: number; handedOverAt: string }>('/cash-handover/confirm', { body: { paymentIds } }),
    onSuccess: () => invalidateData(queryClient),
  });
}

// Employee app (/api/me) -----------------------------------------------------

export function useMyVisits(date: string) {
  return useQuery({
    queryKey: ['me', 'visits', date],
    queryFn: () => api<MyVisits>('/me/visits', { query: { date } }),
    placeholderData: (previous) => previous,
    refetchInterval: 60_000,
  });
}

export function useMarkMyVisitDone() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cashCollectedCents }: { id: number; cashCollectedCents?: number }) =>
      api<CompleteVisitResult>(`/me/visits/${id}/done`, { body: { cashCollectedCents } }),
    onSuccess: () => invalidateData(queryClient),
  });
}
