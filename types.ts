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
  subject: string;
  body: string;
  scheduledFor: string; // ISO String
  status: 'PENDING' | 'SENT' | 'SKIPPED';
  type: 'INITIAL' | 'FOLLOW_UP';
}

export interface Email {
  id: string;
  recipient: string;
  recipientName: string;
  subject: string;
  body: string;
  sentDate: string; // ISO string
  status: EmailStatus;
  company?: string;
  scheduledDate?: string; // ISO string for when the follow-up should be sent
  followupHistory?: FollowUpHistoryItem[];
  autoFollowUps?: AutoFollowUp[];
  provider?: 'ZOHO' | 'GMAIL' | 'MICROSOFT';
}

export interface Recipient {
  email: string;
  name: string;
  company: string;
}

export interface Campaign {
  id: string;
  name: string; // Usually subject
  status: 'DRAFT' | 'SCHEDULED' | 'SENT' | 'ACTIVE' | 'PAUSED' | 'COMPLETED';
  recipients: Recipient[];
  subject: string;
  body: string;
  scheduledAt: string; // ISO date string
  createdAt: string;
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
}

export enum FollowUpTone {
  PROFESSIONAL = 'Professional',
  FRIENDLY = 'Friendly',
  URGENT = 'Urgent',
  CASUAL = 'Casual'
}

export interface GeneratedDraft {
  subject: string;
  body: string;
  tone: FollowUpTone;
}

export interface SmartCampaignResult {
  recipientEmail?: string;
  recipientName?: string;
  subject?: string;
  body?: string;
  scheduledDate?: string;
  followUps?: {
    content: string;
    targetDate?: string; 
    delay?: number;
    unit?: 'MINUTES' | 'HOURS' | 'DAYS' | 'WEEKS';
  }[];
}

export interface EmailAnalysisResult {
  score: number; // 0-100 (100 being best/safest)
  spamLikelihood: 'LOW' | 'MEDIUM' | 'HIGH';
  triggerWords: string[];
  suggestions: string[];
  toneAudit: string;
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

export interface SecureState {
  zohoAccessToken: string;
  zohoRefreshToken: string;
  googleAccessToken: string;
  googleRefreshToken: string;
  zohoClientSecret: string;
  googleClientSecret: string;
}

export type UserSettings = PublicSettings & SecureState;

/**
 * Keys holding sensitive OAuth/credential material (access tokens, refresh
 * tokens, client secrets). These are kept in memory for the active session
 * only and must NEVER be written to localStorage. See context/SettingsContext.
 */
export const SECRET_SETTING_KEYS: ReadonlyArray<keyof SecureState> = [
  'zohoAccessToken',
  'zohoRefreshToken',
  'googleAccessToken',
  'googleRefreshToken',
  'zohoClientSecret',
  'googleClientSecret',
];

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
  googleClientId: '',
  zohoAccessToken: '',
  zohoRefreshToken: '',
  googleAccessToken: '',
  googleRefreshToken: '',
  zohoClientSecret: '',
  googleClientSecret: ''
};

export type LeadStatus = 'NEW' | 'CONTACTED' | 'REPLIED' | 'CALL_BOOKED' | 'TRIAL' | 'CLIENT_CLOSED' | 'LOST';

export interface LeadIntelligence {
  postingFrequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'SPORADIC';
  hasPaidCommunity: boolean;
  offerType: 'HIGH_TICKET' | 'COURSE' | 'CONSULTING' | 'SAAS';
  targetKeywords: string[];
  lastPostDate: string;
}

export interface OfferFitAnalysis {
  product: string;
  maturity: 'Beginner' | 'Mid' | 'Pro';
  score: number;
  angle: string;
}

export interface Lead {
  id: string;
  name: string;
  email: string;
  company: string;
  status: LeadStatus;
  source: string;
  lastContacted?: string;
  notes?: string;
  score?: number;
  intelligence?: LeadIntelligence;
}

export interface BrandBible {
  voiceProfile: {
    archetype: string;
    keywords: string[];
    description: string;
  };
  visualRules: {
    colorPalette: string[]; // Hex codes
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
  id: string; // generated locally
  hook: string;
  coreStory: string;
  emotion: 'Funny' | 'Painful' | 'Inspiring' | 'Educational' | 'Controversial';
  format: 'Reel' | 'Long-form' | 'Carousel' | 'Story';
}

export interface CampaignSettings {
  accounts: string[];
  stopOnReply: boolean;
  openTracking: boolean;
  linkTracking: boolean;
  textOnly: boolean;
  firstEmailTextOnly: boolean;
  dailyLimit: number;
  stopOnAutoReply: boolean;
  unsubscribeHeader: boolean;
  allowRisky: boolean;
  disableBounceProtect: boolean;
  prioritizeNewLeads: boolean;
}

// --- UNIBOX TYPES ---

export interface ThreadMessage {
  id: string;
  sender: 'ME' | 'LEAD';
  content: string;
  date: string; // ISO string
}

export type ThreadStatus = 'UNREAD' | 'READ' | 'ARCHIVED';
export type ThreadLeadStatus = 'INTERESTED' | 'NOT_INTERESTED' | 'MEETING_BOOKED' | 'LEFT_HANGING';

export interface Thread {
  id: string;
  leadId: string;
  leadName: string;
  leadEmail: string;
  leadCompany: string;
  subject: string;
  status: ThreadStatus;
  leadStatus: ThreadLeadStatus;
  lastMessageDate: string; // ISO string
  messages: ThreadMessage[];
}

// --- ERROR TYPES ---

export enum AppErrorCode {
  AUTH_EXPIRED = 'AUTH_EXPIRED',
  NETWORK_ERROR = 'NETWORK_ERROR',
  RATE_LIMIT = 'RATE_LIMIT',
  UNKNOWN = 'UNKNOWN',
  ACCESS_DENIED = 'ACCESS_DENIED',
  NOT_FOUND = 'NOT_FOUND',
  VALIDATION = 'VALIDATION'
}

export class AppError extends Error {
  code: AppErrorCode;
  provider: 'ZOHO' | 'GOOGLE' | 'MICROSOFT' | 'SYSTEM';

  constructor(code: AppErrorCode, provider: 'ZOHO' | 'GOOGLE' | 'MICROSOFT' | 'SYSTEM', message: string) {
    super(message);
    this.code = code;
    this.provider = provider;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}
