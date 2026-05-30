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

export interface SenderAccount {
  id: string;
  email: string;
  provider: 'gmail' | 'zoho' | 'microsoft' | 'other';
  warmupReputation: number; // 0-100
  dailyLimit: number;
  campaignsUsed: number;
  connected: boolean;
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
  followUpPercent: number; // 0-100, "100% Follow up leads"
}

export interface CampaignDraft {
  name: string;
  mapping: Record<string, MappingField>; // csvHeader -> field
  leads: Lead[];
  sequence: SequenceStage[];
  senderAccountIds: string[];
  schedule: ScheduleConfig;
  settings: CampaignSettings;
}

export interface CampaignPayload {
  name: string;
  leads: Lead[];
  sequence: SequenceStage[];
  senderAccountIds: string[];
  schedule: ScheduleConfig;
  settings: CampaignSettings;
}
