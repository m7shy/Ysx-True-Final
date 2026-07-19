import { apiGet, apiPost, apiPatch, apiDelete } from './apiClient';

/** Admin-side API for the client portal (clients / projects / invoices). */

export type ProjectStage = 'ONBOARDING' | 'EDITING' | 'REVISION' | 'FINAL_DELIVERY' | 'COMPLETE';
export type RevisionStatus = 'OPEN' | 'IN_PROGRESS' | 'SUBMITTED' | 'APPROVED';
export type InvoiceStatus = 'DRAFT' | 'SENT' | 'VIEWED' | 'PAID' | 'OVERDUE' | 'CANCELLED';
export type FileType = 'BRAND_ASSET' | 'FILE_LINK' | 'DELIVERABLE';

export const STAGES: ProjectStage[] = ['ONBOARDING', 'EDITING', 'REVISION', 'FINAL_DELIVERY', 'COMPLETE'];

export interface AdminClient {
  id: string;
  name: string;
  companyName: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
  createdAt: string;
  projectCount: number;
  invoiceCount: number;
  portalUsers: { id: string; email: string; lastLoginAt: string | null; hasPassword: boolean }[];
}

export interface AdminProject {
  id: string;
  clientId: string;
  name: string;
  status: 'ACTIVE' | 'ARCHIVED';
  stage: ProjectStage;
  progressPct: number;
  etaAt: string | null;
  nextStepNote: string | null;
  waitingOnClient: boolean;
  waitingOnClientNote: string | null;
  scopeSummary: string | null;
  updatedAt: string;
  client?: { id: string; name: string; companyName: string | null };
  _count?: { revisions: number; messages: number; fileLinks: number };
  fileLinks?: { id: string; type: FileType; label: string; url: string; version: number }[];
  revisions?: { id: string; roundNumber: number; note: string; status: RevisionStatus; respondedNote: string | null; createdAt: string }[];
  messages?: { id: string; authorType: string; authorLabel: string; body: string; createdAt: string }[];
  activities?: { id: string; type: string; summary: string; createdAt: string }[];
  invoices?: { id: string; number: string; status: InvoiceStatus; amountCents: number; dueAt: string | null }[];
}

export interface AdminInvoice {
  id: string;
  clientId: string;
  number: string;
  status: InvoiceStatus;
  amountCents: number;
  currency: string;
  dueAt: string | null;
  paidAt: string | null;
  notes: string | null;
  client?: { id: string; name: string; companyName: string | null };
  project?: { id: string; name: string } | null;
  payments?: { id: string; amountCents: number; reference: string | null; receipt: { number: string } | null }[];
}

// Clients
export const fetchAdminClients = () => apiGet<{ clients: AdminClient[] }>('/api/clients');
export const createClient = (name: string, companyName?: string) =>
  apiPost<{ client: AdminClient }>('/api/clients', { name, companyName: companyName || undefined });
export const updateClient = (id: string, data: Partial<Pick<AdminClient, 'name' | 'companyName' | 'status'>>) =>
  apiPatch<{ client: AdminClient }>(`/api/clients/${id}`, data);
export const inviteClientUser = (clientId: string, email: string) =>
  apiPost<{ clientUser: { id: string; email: string } }>(`/api/clients/${clientId}/invite`, { email });

// Projects
export const fetchAdminProjects = (status?: 'ACTIVE' | 'ARCHIVED') =>
  apiGet<{ projects: AdminProject[] }>(`/api/projects${status ? `?status=${status}` : ''}`);
export const fetchAdminProject = (id: string) => apiGet<{ project: AdminProject }>(`/api/projects/${id}`);
export const createProject = (data: { clientId: string; name: string; scopeSummary?: string; etaAt?: string }) =>
  apiPost<{ project: AdminProject }>('/api/projects', data);
export const updateProject = (id: string, data: Record<string, unknown>) =>
  apiPatch<{ project: AdminProject }>(`/api/projects/${id}`, data);
export const archiveProject = (id: string) => apiPost<{ project: AdminProject }>(`/api/projects/${id}/archive`);
export const addFileLink = (projectId: string, data: { type: FileType; label: string; url: string }) =>
  apiPost<{ file: unknown }>(`/api/projects/${projectId}/files`, data);
export const deleteFileLink = (projectId: string, fileId: string) =>
  apiDelete<{ ok: boolean }>(`/api/projects/${projectId}/files/${fileId}`);
export const updateRevision = (
  projectId: string,
  revisionId: string,
  data: { status?: RevisionStatus; respondedNote?: string | null }
) => apiPatch<{ revision: unknown }>(`/api/projects/${projectId}/revisions/${revisionId}`, data);
export const postAdminMessage = (projectId: string, body: string) =>
  apiPost<{ message: unknown }>(`/api/projects/${projectId}/messages`, { body });

// Invoices
export const fetchAdminInvoices = (clientId?: string) =>
  apiGet<{ invoices: AdminInvoice[] }>(`/api/invoices${clientId ? `?clientId=${clientId}` : ''}`);
export const createInvoice = (data: {
  clientId: string;
  projectId?: string;
  amountCents: number;
  currency?: string;
  dueAt?: string;
  notes?: string;
}) => apiPost<{ invoice: AdminInvoice }>('/api/invoices', data);
export const sendInvoice = (id: string) => apiPost<{ invoice: AdminInvoice }>(`/api/invoices/${id}/send`);
export const markInvoicePaid = (id: string, reference?: string) =>
  apiPost<{ invoice: AdminInvoice; payment: unknown }>(`/api/invoices/${id}/mark-paid`, { reference });
export const cancelInvoice = (id: string) =>
  apiPatch<{ invoice: AdminInvoice }>(`/api/invoices/${id}`, { status: 'CANCELLED' });
