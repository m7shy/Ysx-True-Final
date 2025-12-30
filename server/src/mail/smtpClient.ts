
import nodemailer from 'nodemailer';
import { Buffer } from 'node:buffer';
import { logger } from '../logger.js';
import { SmtpConfig, SendMailOptions } from './types.js';
import { maskEmail } from '../util/redact.js';
import { MailError } from '../httpErrors.js';
import { sendDuration, sendTotal } from '../metrics.js';

interface SmtpSendOptions extends SmtpConfig, SendMailOptions {}

export async function sendMail(options: SmtpSendOptions): Promise<string> {
  const { host, port = 465, secure = true, auth, from, to, subject, text, html, attachments } = options;

  const start = performance.now();

  // Validate Attachment Size (15MB Limit)
  if (attachments) {
    const LIMIT = 15 * 1024 * 1024; // 15MB
    for (const att of attachments) {
      let size = 0;
      if (att.encoding === 'base64') {
        size = Buffer.byteLength(att.content, 'base64');
      } else {
        size = Buffer.byteLength(att.content, 'utf-8');
      }

      if (size > LIMIT) {
        throw new MailError('DENIED', `Attachment "${att.filename}" exceeds the 15MB limit.`);
      }
    }
  }

  let transporterAuth: any;

  if (auth.type === 'oauth2') {
    transporterAuth = {
      type: 'OAuth2',
      user: auth.user,
      clientId: auth.clientId,
      clientSecret: auth.clientSecret,
      refreshToken: auth.refreshToken,
    };
  } else {
    transporterAuth = {
      user: auth.user,
      pass: auth.pass,
    };
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure, // true for 465, false for other ports
    auth: transporterAuth,
    // Robustness settings
    connectionTimeout: 15000, // 15s
    greetingTimeout: 15000,
    socketTimeout: 15000,
  });

  // Listen for token updates if using OAuth2 (optional logging or handling)
  if (auth.type === 'oauth2') {
    transporter.on('token', (token) => {
      logger.debug({ user: maskEmail(auth.user) }, 'SMTP OAuth2 token refreshed');
    });
  }

  try {
    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text,
      html,
      attachments,
    });

    const duration = performance.now() - start;
    sendDuration.observe(duration);
    sendTotal.inc();

    logger.info({ messageId: info.messageId, user: maskEmail(auth.user), to: maskEmail(to), hasAttachments: !!attachments, duration }, 'Email sent successfully');
    return info.messageId;
  } catch (err: any) {
    logger.error({ err, user: maskEmail(auth.user) }, 'SMTP Error');
    // Normalize authentication errors
    if (err.code === 'EAUTH' || err.responseCode === 535) {
       // Re-throw as something routes layer might recognize if we had custom error classes here,
       // but routes layer checks err message/code
    }
    throw err;
  }
}
