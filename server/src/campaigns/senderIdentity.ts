// FILE: server/src/campaigns/senderIdentity.ts
//
// Resolves and enforces the tenant's legal sender identity for commercial
// sends. Every campaign email and every campaign follow-up must carry a
// physical postal address (CAN-SPAM §7704(a)(5)) and a sourcing disclosure
// (GDPR Art 14) — neither of which existed anywhere in this codebase before.

import { prisma } from '../db/prisma.js';
import type { SenderIdentity } from './trackedHtml.js';

/**
 * Thrown when a tenant tries to dispatch commercial mail without a configured
 * postal address.
 *
 * A dedicated error type, not a generic throw, because the campaign worker
 * must treat it like the other capacity/quota conditions — release the
 * recipient claim, stop this campaign for the tick, and NOT burn a retry or
 * mark the lead as bounced. A missing address is an operator problem; the
 * recipient did nothing wrong.
 */
export class MissingSenderIdentityError extends Error {
  status = 409;
  code = 'MISSING_SENDER_IDENTITY';
  constructor() {
    super(
      'This account has no business name and postal address configured. ' +
        'Commercial email must include a physical postal address by law, so sending is blocked until you add one in Settings → Sender identity.',
    );
    this.name = 'MissingSenderIdentityError';
  }
}

export function isMissingSenderIdentityError(err: unknown): boolean {
  return (
    err instanceof MissingSenderIdentityError ||
    (typeof err === 'object' &&
      err !== null &&
      (err as { code?: unknown }).code === 'MISSING_SENDER_IDENTITY')
  );
}

/**
 * The tenant's sender identity, or null when it is not fully configured.
 *
 * "Fully" means both fields non-empty after trimming. A whitespace-only
 * address satisfies a NOT NULL check and satisfies nothing else — it would
 * render as a blank footer line and still be non-compliant, so it is treated
 * as absent here rather than passed through to the renderer.
 */
export async function getSenderIdentity(userId: string): Promise<SenderIdentity | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { businessName: true, businessAddress: true, senderProvenance: true },
  });
  if (!user) return null;

  const businessName = user.businessName?.trim() ?? '';
  const businessAddress = user.businessAddress?.trim() ?? '';
  if (!businessName || !businessAddress) return null;

  return { businessName, businessAddress, senderProvenance: user.senderProvenance };
}

/**
 * Resolve the identity or refuse to send.
 *
 * Deliberately fail-closed. The alternative — send anyway, omit the footer —
 * is the exact behaviour that made every campaign email this system has sent
 * non-compliant, and its failure mode is silent: nothing errors, nothing logs,
 * and you find out from a complaint. Blocking the send is loud, immediately
 * fixable, and cannot accrue liability per message while nobody is looking.
 */
export async function assertSenderIdentity(userId: string): Promise<SenderIdentity> {
  const identity = await getSenderIdentity(userId);
  if (!identity) throw new MissingSenderIdentityError();
  return identity;
}
