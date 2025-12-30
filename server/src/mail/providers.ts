
export type Provider = 'gmail' | 'zoho';

export interface ProviderConfig {
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
}

export function providerConfig(p: Provider): ProviderConfig {
  switch (p) {
    case 'gmail':
      return {
        imapHost: 'imap.gmail.com',
        imapPort: 993,
        imapSecure: true,
        smtpHost: 'smtp.gmail.com',
        smtpPort: 465,
        smtpSecure: true,
      };
    case 'zoho':
      return {
        imapHost: 'imap.zoho.com',
        imapPort: 993,
        imapSecure: true,
        smtpHost: 'smtp.zoho.com',
        smtpPort: 465,
        smtpSecure: true,
      };
    default:
      throw new Error(`Unknown provider: ${p}`);
  }
}

export function assertAllowlisted(host: string, allow: Set<string>): void {
  if (!allow.has(host)) {
    throw new Error(`Host not allowed: ${host}`);
  }
}
