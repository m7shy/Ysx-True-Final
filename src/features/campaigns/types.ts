// Shared types for the campaign creation wizard.

export type MappingField =
  | 'first_name'
  | 'last_name'
  | 'email'
  | 'phone'
  | 'company'
  | 'website'
  | 'linkedin'
  | 'location'
  | 'custom'
  | 'ignore';

export interface MappingOption {
  value: MappingField;
  label: string;
}

export interface Lead {
  // Canonical fields (populated from mapped columns when present).
  first_name?: string;
  last_name?: string;
  email: string;
  phone?: string;
  company?: string;
  website?: string;
  linkedin?: string;
  location?: string;
  // All raw CSV values keyed by original header so {{variables}} can resolve.
  custom: Record<string, string>;
}

export interface CsvData {
  headers: string[];
  rows: string[][]; // parallel to headers
}

export interface SequenceVariant {
  id: string;
  subject: string;
  body: string;
}

export interface SequenceStage {
  id: string;
  label: string;
  waitDays: number; // wait before this stage (stage 1 = 0)
  isThreadReply: boolean;
  variants: SequenceVariant[];
}

export interface ScheduleConfig {
  timezone: string;
  sendDays: {
    mon: boolean;
    tue: boolean;
    wed: boolean;
    thu: boolean;
    fri: boolean;
    sat: boolean;
    sun: boolean;
  };
  startTime: string; // "09:00"
  endTime: string;   // "18:00"
  intervalMinutes: number;
  maxNewLeadsPerDay: number;
}

export interface CampaignSettings {
  followUpPercent: number; // 0 = new leads first, 100 = follow-ups first
  stopOnReply: boolean;
  stopOnClick: boolean;
  stopOnOpen: boolean;
  plainTextMode: boolean;
}

export interface CampaignDraft {
  name: string;
  mapping: Record<string, MappingField>; // csvHeader -> field
  leads: Lead[];
  sequence: SequenceStage[];
  schedule: ScheduleConfig;
  settings: CampaignSettings;
}
