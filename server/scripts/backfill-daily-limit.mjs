// One-off data repair: give pre-existing mailboxes (created before
// upsertMailbox set a default) a working daily send budget so campaign
// rotation can pick them. Safe to re-run — only touches rows still at 0.
//
// Usage (from server/): node scripts/backfill-daily-limit.mjs
import { PrismaClient } from '@prisma/client';

const DEFAULT_DAILY_LIMIT = 30;

const prisma = new PrismaClient();
try {
  const result = await prisma.mailbox.updateMany({
    where: { dailyLimit: 0 },
    data: { dailyLimit: DEFAULT_DAILY_LIMIT },
  });
  console.log(`backfilled dailyLimit=${DEFAULT_DAILY_LIMIT} on ${result.count} mailbox(es)`);
} finally {
  await prisma.$disconnect();
}
