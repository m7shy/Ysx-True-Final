import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { hasRecipientReplied } from '../replyCheck.js';
import { ImapFlow } from 'imapflow';

// Mock imapflow
vi.mock('imapflow', () => {
  const ImapFlow = vi.fn();
  ImapFlow.prototype.connect = vi.fn().mockResolvedValue(undefined);
  ImapFlow.prototype.mailboxOpen = vi.fn().mockResolvedValue(undefined);
  ImapFlow.prototype.search = vi.fn().mockResolvedValue([]);
  ImapFlow.prototype.logout = vi.fn().mockResolvedValue(undefined);
  ImapFlow.prototype.fetch = vi.fn();
  return { ImapFlow };
});

// Mock dependencies
vi.mock('../smtpGateway.js', () => ({
  getImapConfig: vi.fn().mockReturnValue({
    host: 'imap.example.com',
    port: 993,
    secure: true,
    auth: { user: 'user@example.com', pass: 'secret' }
  })
}));

describe('hasRecipientReplied', () => {
  let mockClient: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = new ImapFlow({} as any);
  });

  it('should detect reply when sender and message-id match', async () => {
    // Setup mock to return a match for the In-Reply-To search
    // The implementation checks:
    // 1. In-Reply-To
    // 2. References
    // 3. Fallback (Subject)

    // We simulate a match on the first search (In-Reply-To)
    // The implementation currently combines sender + header in the search criteria.
    (mockClient.search as any).mockImplementation((criteria: any) => {
        // Log criteria for debugging if needed
        // console.log('Search criteria:', criteria);
        
        // Update: The code now sends { header: { ... } } WITHOUT 'from' for ID checks.
        // So we should return a match if the ID matches.
        
        if (criteria.header && criteria.header['in-reply-to'] === 'original-id') {
            return [1]; // Match found
        }
        return [];
    });

    const result = await hasRecipientReplied({
      userId: 'test-user',
      provider: 'gmail',
      recipientEmail: 'recipient@test.com',
      initialSentAt: new Date().toISOString(),
      originalMessageId: 'original-id'
    });

    expect(result).toBe(true);
  });

  it('should SUCCEED to detect reply when sender is different (alias) but message-id matches', async () => {
    // This represents the bug we want to fix.
    // The user replies from 'alias@test.com', but the ID matches.
    
    (mockClient.search as any).mockImplementation((criteria: any) => {
        // If the code searches ONLY by ID (no from), this would pass.
        // If the code searches by ID AND from, this will fail if we check for 'recipient@test.com'.
        
        // Current implementation logic simulation:
        // It includes 'from: recipient@test.com' in the criteria.
        
        const hasIdMatch = criteria.header && criteria.header['in-reply-to'] === 'original-id';
        // In the real world, IMAP would return the message if it matches criteria.
        // Since the sender is 'alias@test.com', a search for 'FROM recipient@test.com' would NOT return it.
        
        // So we simulate IMAP returning empty for the strict check
        if (hasIdMatch && criteria.from === 'recipient@test.com') {
             return []; // No match because sender doesn't match criteria
        }
        
        // If the code were improved to search ONLY by ID, criteria.from would be undefined/ignored,
        // and we would return a match.
        if (hasIdMatch && !criteria.from) {
            return [1];
        }

        return [];
    });

    const result = await hasRecipientReplied({
      userId: 'test-user',
      provider: 'gmail',
      recipientEmail: 'recipient@test.com', // Expected sender
      initialSentAt: new Date().toISOString(),
      originalMessageId: 'original-id'
    });

    // We now expect this to be true because we removed the sender constraint for ID checks.
    expect(result).toBe(true); 
  });
});
