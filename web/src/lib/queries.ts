import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from './api';
import type {
  ClientDetail,
  ClientInput,
  ClientListItem,
  ClientRow,
  CompleteVisitBody,
  CompleteVisitResult,
  Dashboard,
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
  filter: 'all' | 'debt' | 'overdue';
  sort: 'name' | 'balance' | 'overdue';
}

export function useClients(params: ClientListParams) {
  return useQuery({
    queryKey: ['clients', params],
    queryFn: () =>
      api<ClientListItem[]>('/clients', {
        query: { search: params.search.trim(), filter: params.filter, sort: params.sort },
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

export interface ExpenseInput {
  kind: 'expense';
  amountCents: number;
  date: string;
  categoryId: number;
  description?: string;
  method: PaymentMethod;
}

export function useCreateExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ExpenseInput) => api('/cash-entries', { body }),
    onSuccess: () => invalidateData(queryClient),
  });
}
