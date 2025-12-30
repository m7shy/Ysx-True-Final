import nodemailer from 'nodemailer';
import { Buffer } from 'node:buffer';

export async function sendMail({
  host,
  port = 465,
  secure = true,
  user,
  pass,
  from,
  to,
  subject,
  text,
  html,
  attachments = []
}) {
  const MAX_SIZE = 15 * 1024 * 1024; // 15MB

  // Validate Attachment Size
  if (attachments && Array.isArray(attachments)) {
    for (const att of attachments) {
      let size = 0;
      if (att.content) {
        if (Buffer.isBuffer(att.content)) {
          size = att.content.length;
        } else {
          size = Buffer.byteLength(att.content, att.encoding || 'utf-8');
        }
      }

      if (size > MAX_SIZE) {
        const error = new Error(`Attachment "${att.filename || 'unknown'}" exceeds the 15MB limit.`);
        error.code = 'DENIED';
        throw error;
      }
    }
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass
    },
    tls: {
      rejectUnauthorized: true
    },
    connectionTimeout: 15000, // 15s
    greetingTimeout: 10000,   // 10s
    socketTimeout: 20000      // 20s
  });

  try {
    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text,
      html,
      attachments
    });

    return {
      messageId: info.messageId
    };
  } catch (err) {
    const normalized = new Error(err.message || 'SMTP Error');

    // Normalize Error Codes
    if (err.code === 'EAUTH' || err.responseCode === 535 || err.responseCode === 534 || err.responseCode === 530) {
      normalized.code = 'AUTH';
    } else if (['ETIMEDOUT', 'ESOCKET', 'ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH'].includes(err.code)) {
      normalized.code = 'TIMEOUT';
    } else if (err.responseCode === 421 || (err.responseCode >= 450 && err.responseCode < 500)) {
      normalized.code = 'TRANSIENT';
    } else if (err.responseCode >= 550 && err.responseCode < 600) {
      // 550 (Policy), 552 (Size), 554 (Transaction failed)
      normalized.code = 'DENIED';
    } else {
      normalized.code = 'UNKNOWN';
    }

    throw normalized;
  }
}
