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
  delayDays?: number;
  subject: string;
  body: string;
  autoFollowUps?: AutoFollowUp[];
  // Real shape persisted by server/src/campaigns/routes.ts (Campaign.sequence
  // JSON column) and built client-side in context/CampaignContext.tsx.
  scheduledFor: string; // ISO string
  status: 'PENDING' | 'SENT' | 'SKIPPED';
  type: 'INITIAL' | 'FOLLOW_UP';
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
  // Extra display fields used by the simulated-mode data source
  // (services/mockZoho.ts) — absent on emails fetched via the mailbox
  // gateway (services/mailGateway.ts).
  recipientName?: string;
  company?: string;
  scheduledDate?: string;
  autoFollowUps?: AutoFollowUp[];
  provider?: string;
}

// Mirrors the backend's Prisma LeadStatus enum. DNC = do-not-contact: the
// backend hard-blocks every automated send (campaigns + follow-ups) for it.
export type LeadStatus =
  | 'NEW'
  | 'CONTACTED'
  | 'REPLIED'
  | 'INTERESTED'
  | 'CALL_BOOKED'
  | 'TRIAL'
  | 'CLIENT_CLOSED'
  | 'LOST'
  | 'DNC';

export interface Lead {
  id: string;
  name: string;
  email: string;
  company: string;
  status: LeadStatus;
  source?: string;
  lastContacted: string | null;
  notes: string;
  score?: number;
  intelligence?: Record<string, unknown>;
  sequence?: SequenceStep[];
}

// Unibox (universal inbox) thread shapes — mirror server/src/unibox/routes.ts.
export type ThreadStatus = 'UNREAD' | 'READ' | 'ARCHIVED';
export type ThreadLeadStatus = 'INTERESTED' | 'NOT_INTERESTED' | 'MEETING_BOOKED' | 'LEFT_HANGING' | 'DNC';

export interface ThreadMessage {
  id: string;
  sender: 'ME' | 'LEAD';
  content: string;
  date: string;
}

export interface Thread {
  id: string;
  leadId: string;
  leadName: string;
  leadEmail: string;
  leadCompany: string;
  subject: string;
  status: ThreadStatus;
  leadStatus: ThreadLeadStatus;
  lastMessageDate: string;
  messages: ThreadMessage[];
}

// Mirrors server/src/campaigns/routes.ts's toClientCampaign() response shape
// exactly (see prisma/schema.prisma's Campaign model for the backing columns).
export interface Campaign {
  id: string;
  name: string;
  createdAt: string;
  status: 'DRAFT' | 'SCHEDULED' | 'SENT' | 'ACTIVE' | 'PAUSED' | 'COMPLETED';
  recipients: Recipient[];
  subject: string;
  body: string;
  scheduledAt: string; // ISO string
  progress: number; // 0-100
  stats: {
    sent: number;
    clicked: number;
    replied: number;
    opportunities: number;
  };
  distributionMethod: 'INDIVIDUAL' | 'GROUP';
  autoFollowUps: AutoFollowUp[];
  sequence?: SequenceStep[];
  sendWindowStart?: number | null; // minutes from local midnight, 0-1439
  sendWindowEnd?: number | null;
  sendDays?: number | null; // bitmask Mon=1<<0 ... Sun=1<<6; null = every day
  timezone?: string | null; // IANA zone; null = UTC
  dailyLimit?: number | null;
  stopOnReply?: boolean;
  openTracking?: boolean;
  linkTracking?: boolean;
  sendIntervalMinutes?: number | null;
  stopOnClick?: boolean;
  stopOnOpen?: boolean;
  plainTextMode?: boolean;
  followUpPercent?: number;
  bouncedCount?: number;
  pausedReason?: string | null;
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
  company?: string;
  customFields?: Record<string, string>;
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
  defaultTone: FollowUpTone;
  emailSignature: string;
  syncLookbackDays: number;
  autoSync: boolean;
  // Real API Configuration.
  // transportMode is now single-valued: everything goes through the backend
  // IMAP/SMTP gateway. The old 'oauth-api' mode (Gmail/Zoho called straight
  // from the browser) was removed — the routes it called were never mounted
  // server-side, so it had never worked, and it was the only thing that
  // required the tenant's OAuth client secret to sit in localStorage.
  useRealApi: boolean;
  transportMode: 'gateway-imap-smtp';
  activeProvider: 'ZOHO' | 'GMAIL' | 'MICROSOFT';
  zohoAccountId?: string; // Cached account ID
}

export type ActiveProvider = PublicSettings['activeProvider'];

export type MailGatewayProviderKey = 'gmail' | 'zoho' | 'microsoft';

// UserSettings used to be PublicSettings & SecureState, where SecureState held
// the Google/Zoho OAuth access tokens, refresh tokens and client secrets. All
// six were removed with the 'oauth-api' transport: mailbox credentials live
// server-side (encrypted, see server/src/creds/) and never reach the browser.
export type UserSettings = PublicSettings;

// UPDATED: Default is now GMAIL to prevent missing ZOHO errors
export const DEFAULT_SETTINGS: UserSettings = {
  defaultTone: FollowUpTone.PROFESSIONAL,
  emailSignature: '',
  syncLookbackDays: 30,
  autoSync: true,
  useRealApi: false,
  transportMode: 'gateway-imap-smtp',
  activeProvider: 'GMAIL',
  zohoAccountId: undefined,
};

export enum AppErrorCode {
  NETWORK_ERROR = 'NETWORK_ERROR',
  AUTH_ERROR = 'AUTH_ERROR',
  // Distinct from AUTH_ERROR: a provider OAuth token is expired or revoked and
  // the caller should prompt a reconnect rather than treat it as a generic
  // auth failure. (Its original client-side raisers were removed with the
  // 'oauth-api' transport; retained for the gateway/mailbox paths.)
  AUTH_EXPIRED = 'AUTH_EXPIRED',
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

// ── AI (Gemini) result shapes — services/gemini.ts ──────────────────────────
// Each mirrors that function's Gemini responseSchema exactly.

export interface GeneratedDraft {
  subject: string;
  body: string;
  tone: FollowUpTone;
}

// parseSmartCampaign can return `{}` on failure, so every field is optional.
export interface SmartCampaignResult {
  recipientEmail?: string;
  recipientName?: string;
  subject?: string;
  body?: string;
  scheduledDate?: string; // ISO YYYY-MM-DD
  followUps?: Array<{ content: string; delayDays: number }>;
}

export interface BrandBible {
  voiceProfile: {
    archetype: string;
    keywords: string[];
    description: string;
  };
  visualRules: {
    colorPalette: string[]; // hex codes
    typography: string;
    vibeDescription: string;
  };
  doAndDonts: {
    dos: string[];
    donts: string[];
  };
  exampleScriptPrompts: string[];
}

export interface StoryIdea {
  id: string;
  hook: string;
  coreStory: string;
  emotion: 'Funny' | 'Painful' | 'Inspiring' | 'Educational' | 'Controversial';
  format: 'Reel' | 'Long-form' | 'Carousel' | 'Story';
}

export interface OfferFitAnalysis {
  product: string;
  maturity: 'Beginner' | 'Mid' | 'Pro';
  score: number;
  angle: string;
}

// Scraped-channel intelligence attached to a Lead (services/mockZoho.ts's
// analyzeLead simulates this; the real scraper populates Lead.intelligence
// with a similar but not identical shape — see scraper/ and Lead.intelligence
// above, kept as Record<string, unknown> there since real intelligence varies
// by source).
export interface LeadIntelligence {
  postingFrequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'SPORADIC';
  hasPaidCommunity: boolean;
  offerType: 'HIGH_TICKET' | 'COURSE' | 'CONSULTING' | 'SAAS';
  targetKeywords: string[];
  lastPostDate: string; // ISO string
}
