import { apiGet, apiPost, saveAuth, type PortalAuthState } from './apiClient';

/** Typed calls + shared types for the portal API. */

export type ProjectStage = 'ONBOARDING' | 'EDITING' | 'REVISION' | 'FINAL_DELIVERY' | 'COMPLETE';
export type RevisionStatus = 'OPEN' | 'IN_PROGRESS' | 'SUBMITTED' | 'APPROVED';
export type InvoiceStatus = 'SENT' | 'VIEWED' | 'PAID' | 'OVERDUE' | 'CANCELLED';
export type FileType = 'BRAND_ASSET' | 'FILE_LINK' | 'DELIVERABLE';

export interface ProjectCard {
  id: string;
  name: string;
  stage: ProjectStage;
  progressPct: number;
  etaAt: string | null;
  waitingOnClient: boolean;
  waitingOnClientNote: string | null;
  awaitingApprovalCount: number;
  lastActivity: { summary: string; createdAt: string } | null;
  updatedAt: string;
}

export interface FileLink {
  id: string;
  type: FileType;
  label: string;
  url: string;
  version: number;
  addedByAdmin: boolean;
  createdAt: string;
}

export interface Revision {
  id: string;
  roundNumber: number;
  note: string;
  status: RevisionStatus;
  respondedNote: string | null;
  createdAt: string;
}

export interface Message {
  id: string;
  authorType: 'ADMIN' | 'CLIENT';
  authorLabel: string;
  body: string;
  createdAt: string;
}

export interface ActivityItem {
  id: string;
  type: string;
  summary: string;
  createdAt: string;
}

export interface ProjectDetail {
  id: string;
  name: string;
  stage: ProjectStage;
  status: 'ACTIVE' | 'ARCHIVED';
  progressPct: number;
  etaAt: string | null;
  nextStepNote: string | null;
  waitingOnClient: boolean;
  waitingOnClientNote: string | null;
  scopeSummary: string | null;
  fileLinks: FileLink[];
  revisions: Revision[];
  messages: Message[];
  activities: ActivityItem[];
  updatedAt: string;
}

export interface Invoice {
  id: string;
  number: string;
  status: InvoiceStatus;
  amountCents: number;
  currency: string;
  dueAt: string | null;
  sentAt: string | null;
  paidAt: string | null;
  lineItemsJson: { label: string; amountCents: number }[] | null;
  notes: string | null;
  project: { id: string; name: string } | null;
  payments: {
    id: string;
    amountCents: number;
    reference: string | null;
    createdAt: string;
    receipt: { number: string; createdAt: string } | null;
  }[];
}

export interface PaymentInstructions {
  method: 'BANK_TRANSFER';
  title: string;
  lines: string[];
}

export interface FaqItem {
  q: string;
  a: string;
}

export interface ContactInfo {
  email: string;
  officeHours: string;
  responseTime: string;
}

// ── Auth ──────────────────────────────────────────────────────────────────

type SessionResponse = PortalAuthState;

async function storeSession(p: Promise<SessionResponse>): Promise<SessionResponse> {
  const session = await p;
  saveAuth(session);
  return session;
}

export const login = (email: string, password: string) =>
  storeSession(apiPost<SessionResponse>('/api/portal/auth/login', { email, password }));

export const requestMagicLink = (email: string) =>
  apiPost<{ ok: boolean; message: string }>('/api/portal/auth/magic-link', { email });

export const consumeMagicLink = (token: string) =>
  storeSession(apiPost<SessionResponse>('/api/portal/auth/magic-link/consume', { token }));

export const setPassword = (token: string, password: string) =>
  storeSession(apiPost<SessionResponse>('/api/portal/auth/set-password', { token, password }));

// ── Data ──────────────────────────────────────────────────────────────────

export const fetchProjects = (status: 'ACTIVE' | 'ARCHIVED' = 'ACTIVE') =>
  apiGet<{ projects: ProjectCard[] }>(`/api/portal/projects?status=${status}`);

export const fetchProject = (id: string) =>
  apiGet<{ project: ProjectDetail }>(`/api/portal/projects/${id}`);

export const requestRevision = (projectId: string, note: string) =>
  apiPost<{ revision: Revision }>(`/api/portal/projects/${projectId}/revisions`, { note });

export const approveRevision = (projectId: string, revisionId: string) =>
  apiPost<{ revision: Revision }>(`/api/portal/projects/${projectId}/revisions/${revisionId}/approve`);

export const postMessage = (projectId: string, body: string) =>
  apiPost<{ message: Message }>(`/api/portal/projects/${projectId}/messages`, { body });

export const requestNewProject = (title: string, details: string) =>
  apiPost<{ ok: boolean; message: string }>('/api/portal/requests', { title, details });

export const fetchInvoices = () =>
  apiGet<{ invoices: Invoice[]; outstandingCents: number }>('/api/portal/invoices');

export const fetchInvoice = (id: string) =>
  apiGet<{ invoice: Invoice; paymentInstructions: PaymentInstructions }>(`/api/portal/invoices/${id}`);

export const fetchFaq = () => apiGet<{ faq: FaqItem[]; contact: ContactInfo }>('/api/portal/faq');

// ── Formatting helpers ────────────────────────────────────────────────────

export function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(
    cents / 100
  );
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return formatDate(iso);
}
