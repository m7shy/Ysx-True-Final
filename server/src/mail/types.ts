export interface SimpleCredentials {
  type: 'simple';
  user: string;
  pass: string;
}

export interface OAuth2Credentials {
  type: 'oauth2';
  user: string;
  // XOAUTH2 with a pre-fetched access token (tokens live/rotate in the DB).
  accessToken?: string;
  // Alternatively, let nodemailer mint tokens from an app registration.
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
}

export type Credentials = SimpleCredentials | OAuth2Credentials;

export interface ImapConfig {
  auth: Credentials;
  host: string;
  port?: number;
  secure?: boolean;
}

export interface SmtpConfig {
  auth: Credentials;
  host: string;
  port?: number;
  secure?: boolean;
}

export interface MailMessage {
  uid: number;
  internalDate: Date;
  subject: string;
  from: string;
  to: string[];
  snippet: string;
  messageId?: string;
}

export interface Attachment {
  filename: string;
  content: string;
  encoding?: 'base64' | 'utf-8';
  contentType?: string;
}

export interface SendMailOptions {
  from: string;
  to: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: Attachment[];
  replyTo?: string;
  inReplyTo?: string;
  references?: string;
  /** Extra RFC-822 headers (e.g. List-Unsubscribe). */
  headers?: Record<string, string>;
}

export interface ProviderConfig {
  imapHost: string;
  smtpHost: string;
}

export type ProviderName = 'gmail' | 'zoho' | 'microsoft';
