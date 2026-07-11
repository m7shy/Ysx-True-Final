import { Lead, LeadStatus } from '../types';
import { apiGet, apiPost, apiPatch, apiDelete, apiUpload, apiDownload } from './apiClient';

/**
 * Real leads data layer, backed by the tenant-scoped /api/leads routes on the
 * Express backend (server/src/leads/routes.ts). Drop-in replacement for the
 * lead CRUD functions previously imported from ./mockZoho — same signatures, so
 * LeadsView only had to swap the import source. Every call carries the JWT via
 * the apiClient wrapper, so results are automatically scoped to the logged-in
 * tenant.
 */

/** Normalize a raw API lead (Prisma row) into the frontend Lead shape. */
function toLead(raw: any): Lead {
  return {
    id: raw.id,
    name: raw.name ?? '',
    email: raw.email ?? '',
    company: raw.company ?? '',
    status: (raw.status ?? 'NEW') as LeadStatus,
    source: raw.source ?? '',
    lastContacted: raw.lastContacted ?? undefined,
    notes: raw.notes ?? undefined,
    score: raw.score ?? undefined,
    intelligence: raw.intelligence ?? undefined,
  };
}

export const fetchLeads = async (): Promise<Lead[]> => {
  const data = await apiGet<{ leads: any[] }>('/api/leads');
  return (data.leads ?? []).map(toLead);
};

export const addLead = async (leadData: Omit<Lead, 'id'>): Promise<Lead> => {
  const data = await apiPost<{ lead: any }>('/api/leads', {
    name: leadData.name,
    email: leadData.email,
    company: leadData.company || undefined,
    source: leadData.source || undefined,
    status: leadData.status,
    notes: leadData.notes,
    score: leadData.score,
    intelligence: leadData.intelligence,
  });
  return toLead(data.lead);
};

export const updateLeadStatus = async (id: string, status: LeadStatus): Promise<void> => {
  await apiPatch(`/api/leads/${id}`, { status });
};

export const updateLeadNotes = async (id: string, notes: string): Promise<void> => {
  await apiPatch(`/api/leads/${id}`, { notes });
};

export const deleteLead = async (id: string): Promise<void> => {
  await apiDelete(`/api/leads/${id}`);
};

export interface ImportLeadsCsvResult {
  created: number;
  updated: number;
  skipped: number;
  total: number;
  errors: Array<{ row: number; message: string }>;
}

/** POST /api/leads/import-csv — header row required, recognizes name/email/company/notes/score. */
export const importLeadsCsv = async (file: File): Promise<ImportLeadsCsvResult> => {
  return apiUpload<ImportLeadsCsvResult>('/api/leads/import-csv', [file], 'file');
};

/** GET /api/leads/export — downloads all of this tenant's leads as leads.csv. */
export const exportLeadsCsv = async (): Promise<void> => {
  await apiDownload('/api/leads/export', 'leads.csv');
};
