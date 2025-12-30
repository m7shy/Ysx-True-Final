import { ImapFlow } from 'imapflow';

export async function fetchSent({
  host,
  port = 993,
  secure = true,
  user,
  pass,
  limit = 20
}) {
  const client = new ImapFlow({
    host,
    port,
    secure,
    auth: {
      user,
      pass
    },
    logger: false,
    emitLogs: false,
    tls: {
      rejectUnauthorized: true
    },
    // Shorter timeouts for responsiveness
    connectionTimeout: 15000,
    greetingTimeout: 15000
  });

  try {
    // 1. Connect with race against explicit timeout
    await Promise.race([
      client.connect(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timed out')), 15000))
    ]);

    // 2. Discover Sent Mailbox
    let sentPath = '';
    const mailboxes = await client.list();

    const sentBox = mailboxes.find(box => box.specialUse === '\\Sent');
    if (sentBox) {
      sentPath = sentBox.path;
    } else {
      const commonNames = new Set(['Sent', 'Sent Mail', 'Sent Items', 'Enviados', '[Gmail]/Sent Mail']);
      // Check path or name
      const found = mailboxes.find(box => commonNames.has(box.name) || commonNames.has(box.path));
      if (found) sentPath = found.path;
    }

    if (!sentPath) {
      const err = new Error('Could not locate Sent mailbox');
      err.code = 'CONFIG'; // Internal mapping
      throw err;
    }

    // 3. Select Mailbox & Calculate Range
    const lock = await client.getMailboxLock(sentPath);
    const results = [];

    try {
      const status = await client.status(sentPath, { messages: true });
      const total = status.messages || 0;

      if (total > 0) {
        // IMAP is 1-based. To get last 'limit' messages:
        const startIdx = Math.max(1, total - limit + 1);
        const range = `${startIdx}:*`;

        const fetchStream = client.fetch(range, {
          envelope: true,
          internalDate: true,
          bodyStructure: true,
          uid: true,
          headers: ["message-id"]
        });

        const messages = [];
        for await (const msg of fetchStream) {
          messages.push(msg);
        }

        // 4. Process Messages & Extract Snippets
        // We do this in parallel to speed up snippet fetching
        const processed = await Promise.all(messages.map(async (msg) => {
          const { uid, envelope, internalDate, bodyStructure } = msg;
          
          const subject = envelope.subject || '(No Subject)';
          const from = envelope.from?.[0]?.address || 'unknown';
          const to = envelope.to?.map(t => t.address).filter(Boolean) || [];
          const messageId = msg.headers?.['message-id']?.[0];
          const date = internalDate ? new Date(internalDate).toISOString() : new Date().toISOString();

          // Determine Part ID for Snippet
          let partIdToFetch;
          let isHtml = false;

          const findPart = (struct, type) => {
            if (!struct) return undefined;
            if (struct.type === type) return struct.part;
            if (struct.childNodes) {
              for (const child of struct.childNodes) {
                const found = findPart(child, type);
                if (found) return found;
              }
            }
            return undefined;
          };

          const plainPart = findPart(bodyStructure, 'text/plain');
          if (plainPart) {
            partIdToFetch = plainPart;
          } else {
            const htmlPart = findPart(bodyStructure, 'text/html');
            if (htmlPart) {
              partIdToFetch = htmlPart;
              isHtml = true;
            }
          }

          let snippet = '';
          if (partIdToFetch) {
            try {
              // Retrieve specific part content
              const partData = await client.fetchOne(uid, {
                bodyParts: [partIdToFetch]
              });
              
              if (partData && partData.bodyParts) {
                const buffer = partData.bodyParts.get(partIdToFetch);
                if (buffer) {
                  let text = buffer.toString('utf8');
                  if (isHtml) {
                    // Strip tags
                    text = text.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim();
                  }
                  snippet = text.slice(0, 200).trim();
                }
              }
            } catch (e) {
              // Ignore snippet fetch errors, return email without snippet
            }
          }

          return {
            uid,
            id: messageId,
            subject,
            from,
            to,
            date,
            snippet
          };
        }));

        results.push(...processed);
      }
    } finally {
      lock.release();
    }

    await client.logout();

    // Sort Descending
    return results.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  } catch (err) {
    client.close();

    const normalized = new Error(err.message || 'IMAP Error');
    const msg = err.message ? err.message.toLowerCase() : '';

    if (
      err.authenticationFailed || 
      msg.includes('authentication failed') || 
      msg.includes('invalid credentials') || 
      msg.includes('log in')
    ) {
      normalized.code = 'AUTH';
    } else if (
      msg.includes('timed out') || 
      err.code === 'ETIMEDOUT' || 
      err.code === 'ESOCKET'
    ) {
      normalized.code = 'TIMEOUT';
    } else if (
      err.code === 'ECONNRESET' || 
      err.code === 'ECONNREFUSED' || 
      err.code === 'EHOSTUNREACH'
    ) {
      normalized.code = 'TRANSIENT';
    } else if (
      msg.includes('not allowed') || 
      msg.includes('security')
    ) {
      normalized.code = 'DENIED';
    } else {
      normalized.code = 'UNKNOWN';
    }

    throw normalized;
  }
}
