export enum EmailStatus {
  SENT = 'SENT',
  REPLIED = 'REPLIED',
  NO_REPLY = 'NO_REPLY',
  FOLLOW_UP_DRAFTED = 'FOLLOW_UP_DRAFTED',
  FOLLOW_UP_SENT = 'FOLLOW_UP_SENT',
  SCHEDULED = 'SCHEDULED'
}

export interface FollowUpHistoryItem {
  date: string; // ISO string
  content: string;
  status: 'SENT' | 'SCHEDULED';
}

export interface AutoFollowUp {
  delay: number;
  unit: 'MINUTES' | 'HOURS' | 'DAYS' | 'WEEKS';
  content: string;
}

export interface SequenceStep {
  id: string;
  step: number;
  delayDays: number;
  subject: string;
  body: string;
  autoFollowUps?: AutoFollowUp[];
}

export interface Email {
  id: string;
  subject: string;
  body: string;
  date: string; // ISO string
  status: EmailStatus;
  followUpHistory: FollowUpHistoryItem[];
  threadId?: string;
  messageId?: string;
  to: string;
  from: string;
}

export interface Lead {
  id: string;
  name: string;
  email: string;
  company: string;
  status: 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'CONVERTED' | 'LOST';
  lastContacted: string | null;
  notes: string;
  sequence?: SequenceStep[];
}

export interface Campaign {
  id: string;
  name: string;
  createdAt: string;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETED';
  leads: Lead[];
  templates: EmailTemplate[];
}

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  category?: 'OUTREACH' | 'FOLLOW_UP' | 'CLOSING';
}

export interface Recipient {
  name: string;
  email: string;
}

export interface EmailAnalysisResult {
  score: number; // 0-100 (100 being best/safest)
  spamLikelihood: 'LOW' | 'MEDIUM' | 'HIGH';
  triggerWords: string[];
  suggestions: string[];
  toneAudit: string;
}

export enum FollowUpTone {
  CASUAL = 'Casual',
  PROFESSIONAL = 'Professional',
  FRIENDLY = 'Friendly',
  URGENT = 'Urgent'
}

export interface PublicSettings {
  zohoClientId: string;
  zohoRegion: 'US' | 'EU' | 'CN' | 'IN' | 'AU';
  defaultTone: FollowUpTone;
  emailSignature: string;
  syncLookbackDays: number;
  autoSync: boolean;
  // Real API Configuration
  useRealApi: boolean;
  transportMode: 'gateway-imap-smtp' | 'oauth-api';
  activeProvider: 'ZOHO' | 'GMAIL' | 'MICROSOFT';
  zohoAccountId?: string; // Cached account ID
  googleClientId: string;
}

export type ActiveProvider = PublicSettings['activeProvider'];

export type MailGatewayProviderKey = 'gmail' | 'zoho' | 'microsoft';

export interface SecureState {
  zohoAccessToken: string;
  zohoRefreshToken: string;
  googleAccessToken: string;
  googleRefreshToken: string;
  zohoClientSecret: string;
  googleClientSecret: string;
}

export type UserSettings = PublicSettings & SecureState;

// UPDATED: Default is now GMAIL to prevent missing ZOHO errors
export const DEFAULT_SETTINGS: UserSettings = {
  zohoClientId: '',
  zohoRegion: 'US',
  defaultTone: FollowUpTone.PROFESSIONAL,
  emailSignature: '',
  syncLookbackDays: 30,
  autoSync: true,
  useRealApi: false,
  transportMode: 'gateway-imap-smtp',
  activeProvider: 'GMAIL',
  zohoAccountId: undefined,
  googleClientId: '',
  zohoAccessToken: '',
  zohoRefreshToken: '',
  googleAccessToken: '',
  googleRefreshToken: '',
  zohoClientSecret: '',
  googleClientSecret: '',
};

export enum AppErrorCode {
  NETWORK_ERROR = 'NETWORK_ERROR',
  AUTH_ERROR = 'AUTH_ERROR',
  RATE_LIMIT = 'RATE_LIMIT',
  PROVIDER_ERROR = 'PROVIDER_ERROR',
  INVALID_INPUT = 'INVALID_INPUT',
  NOT_FOUND = 'NOT_FOUND',
  ACCESS_DENIED = 'ACCESS_DENIED',
  UNKNOWN = 'UNKNOWN'
}

export type ProviderId = 'ZOHO' | 'GOOGLE' | 'MICROSOFT' | 'SYSTEM';

export class AppError extends Error {
  code: AppErrorCode;
  provider: ProviderId;

  constructor(code: AppErrorCode, provider: ProviderId, message: string) {
    super(message);
    this.code = code;
    this.provider = provider;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export interface EmailFormData {
  to: string;
  subject: string;
  body: string;
  followUpDays?: number;
  followUpTone?: FollowUpTone;
}

export interface CampaignStats {
  totalEmails: number;
  sent: number;
  opened: number;
  replied: number;
  bounced: number;
  unsubscribed: number;
}

export interface AnalyticsData {
  campaignId: string;
  stats: CampaignStats;
}

export interface FollowUpSuggestion {
  subject: string;
  body: string;
  tone: FollowUpTone;
}

export interface AIConfig {
  tone: FollowUpTone;
  maxFollowUps: number;
  autoAnalyze: boolean;
}

export type View = 'DASHBOARD' | 'TEMPLATES' | 'ANALYTICS';

export interface TemplateCategory {
  id: string;
  name: string;
  description: string;
}

export interface MailboxHealth {
  score: number; // 0-100
  deliverability: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR';
  spamTraps: number;
  blocklists: string[];
  recommendations: string[];
}

export interface SentEmail {
  id: string;
  subject: string;
  body: string;
  to: Recipient;
  from: Recipient;
  sentAt: string; // ISO string
  status: EmailStatus;
}

export interface SyncStatus {
  lastSyncedAt: string | null;
  inProgress: boolean;
  error?: string;
}

export interface ApiErrorResponse {
  code: string;
  message: string;
}

export interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

export interface ZohoAuthConfig {
  clientId: string;
  redirectUri: string;
  scope: string;
  responseType: 'code' | 'token';
  accessType?: 'offline' | 'online';
  prompt?: 'consent' | 'none';
}

export interface GoogleAuthConfig {
  clientId: string;
  redirectUri: string;
  scope: string;
  responseType: 'code' | 'token';
  accessType?: 'offline' | 'online';
  prompt?: 'consent' | 'none';
}

export interface EmailProviderStatus {
  zohoConnected: boolean;
  googleConnected: boolean;
  gatewayConfigured: boolean;
  activeProvider: 'ZOHO' | 'GMAIL' | 'MICROSOFT';
}

export interface HealthCheckResponse {
  ok: boolean;
  gmailConfigured: boolean;
  zohoConfigured: boolean;
  microsoftConfigured: boolean;
}

export interface GatewaySentItem {
  uid: number;
  id: string;
  subject: string;
  from: string;
  to: string[];
  date: string;
  snippet: string;
}
