/**
 * Portal static content: FAQ, contact card, and bank-transfer payment
 * instructions. Config-driven on purpose (no DB table) — edit here, redeploy.
 * Sensitive values (bank account details) come from env so they never land in
 * git; unset fields are simply omitted from the client response.
 */

export interface FaqItem {
  q: string;
  a: string;
}

export const FAQ_ITEMS: FaqItem[] = [
  {
    q: 'How do I know what stage my project is in?',
    a: 'Your dashboard shows the live stage, progress, and estimated delivery for every project. The "What happens next" card on each project page tells you exactly what we are working on right now.',
  },
  {
    q: 'How do revisions work?',
    a: 'Open your project and use the Revisions panel to tell us what to change. You will see each round tracked with its status, and you approve the final cut right from the portal.',
  },
  {
    q: 'Where do I upload my footage and brand assets?',
    a: 'Share a link (Google Drive, Dropbox, WeTransfer, Frame.io — anything) in the project Files section or send it via the project messages. We keep every version organized for you.',
  },
  {
    q: 'How long does a typical edit take?',
    a: 'Most projects move from footage-in to first cut within 3–5 business days. Your project page always shows the current estimated delivery date.',
  },
  {
    q: 'How do I pay an invoice?',
    a: 'Open the invoice in the portal — payment details are right on it. Once your transfer arrives we mark it paid and your receipt appears automatically.',
  },
  {
    q: 'What if I need something urgently?',
    a: 'Post a message on your project — it goes straight to the team. For anything time-critical, use the direct contact below.',
  },
];

export const CONTACT_INFO = {
  email: process.env.PORTAL_CONTACT_EMAIL || 'hello@ysxvisuals.com',
  officeHours: process.env.PORTAL_OFFICE_HOURS || 'Mon–Fri, 10:00–18:00 (GMT+2)',
  responseTime: 'We reply within one business day.',
};

export const BANK_TRANSFER_INSTRUCTIONS = {
  method: 'BANK_TRANSFER' as const,
  title: 'Pay by bank transfer',
  lines: [
    process.env.PORTAL_BANK_NAME ? `Bank: ${process.env.PORTAL_BANK_NAME}` : null,
    process.env.PORTAL_BANK_BENEFICIARY ? `Beneficiary: ${process.env.PORTAL_BANK_BENEFICIARY}` : null,
    process.env.PORTAL_BANK_IBAN ? `IBAN: ${process.env.PORTAL_BANK_IBAN}` : null,
    process.env.PORTAL_BANK_SWIFT ? `SWIFT/BIC: ${process.env.PORTAL_BANK_SWIFT}` : null,
    'Please include the invoice number as the transfer reference.',
  ].filter((l): l is string => Boolean(l)),
};
