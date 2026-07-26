### Global Unique Constraint on ClientUser Email Blocks Multi-Agency Client Contacts
SEVERITY: HIGH
CONFIDENCE: HIGH
FILE: prisma/schema.prisma:668
WHAT: `ClientUser` defines `email String @unique` globally across the entire database rather than scoping uniqueness per client or per tenant agency.
SCENARIO: 
1. Tenant A (Agency A) invites a client representative with email `contact@acme.com` to access their client portal. A `ClientUser` row is created with `email = "contact@acme.com"`.
2. Tenant B (Agency B), another agency using the platform, also works with Acme Corp and invites `contact@acme.com` to Tenant B's client portal.
3. Prisma / PostgreSQL throws a unique constraint violation (`ClientUser_email_key`).
4. Tenant B receives an unhandled error and cannot onboard their client contact. Additionally, Tenant A can block or probe client emails registered by other agencies on the platform.
FIX: Remove `@unique` from `email` in `ClientUser` and add `@@unique([clientId, email])` or `@@unique([userId, email])`.

### Global Unique Constraint on CookieFile Filename Enables Cross-Tenant Conflict and DoS
SEVERITY: HIGH
CONFIDENCE: HIGH
FILE: prisma/schema.prisma:885
WHAT: `CookieFile` defines `name String @unique` globally across all tenants despite having a tenant-scoping `userId String?` column.
SCENARIO:
1. Tenant A uploads a YouTube cookies file with standard name `youtube_cookies.txt`. A `CookieFile` row is created with `name = "youtube_cookies.txt"` and `userId = "user_A"`.
2. Tenant B uploads their own YouTube cookies file also named `youtube_cookies.txt`.
3. Prisma / PostgreSQL throws a `P2002` unique constraint violation (`CookieFile_name_key`) because `name` must be unique across the entire database.
4. Tenant B's cookie upload fails with a 500 error. Tenant B is unable to use standard cookie filenames if another tenant has already uploaded a file with that name. Furthermore, a malicious tenant can squat common cookie filenames to block other tenants from uploading cookies.
FIX: Remove `@unique` from `name` in `CookieFile` and add `@@unique([userId, name])` (or handle null `userId` for legacy global files).

### Unindexed ClientUser.userId Column Causes Full Table Scans for Tenant Auth and Management
SEVERITY: MEDIUM
CONFIDENCE: HIGH
FILE: prisma/schema.prisma:666
WHAT: `ClientUser` contains a denormalized `userId String` column intended for tenant-scoped access checks, but only defines an index on `@@index([clientId])`.
SCENARIO:
1. Middleware or background jobs query `ClientUser` directly by `userId` (e.g., listing all portal users for a tenant or validating tenant permissions).
2. As the database grows across hundreds of agencies and thousands of client users, PostgreSQL must execute a full table scan over all `ClientUser` rows on every `userId` lookup.
3. Under production traffic, tenant management and authentication routes experience severe latency degradation and database contention.
FIX: Add `@@index([userId])` to `model ClientUser`.

### Missing Compound Unique Constraint on Revision(projectId, roundNumber) Permits Duplicate Round Numbers
SEVERITY: MEDIUM
CONFIDENCE: HIGH
FILE: prisma/schema.prisma:765
WHAT: `Revision` tracks client revision rounds via `roundNumber Int` per project, but lacks a compound unique constraint `@@unique([projectId, roundNumber])`.
SCENARIO:
1. A client submits a revision request for Project X. The application reads the highest current round number (e.g. 1) and calculates the next round number as 2.
2. If two revision submissions occur concurrently (e.g. client double-clicks 'Submit Revision' or two users on the client team submit simultaneously), both requests compute `roundNumber = 2` and execute database inserts.
3. Both rows succeed without constraint failure, producing duplicate `roundNumber = 2` records for Project X.
4. The client portal UI and agency dashboard display duplicate/conflicting "Round 2" revision cards, corrupting sequential round tracking.
FIX: Add `@@unique([projectId, roundNumber])` to `model Revision`.

### Unindexed FollowupJob.nextRetryAt Causes Full Table Scans During Retry Sweeps
SEVERITY: MEDIUM
CONFIDENCE: HIGH
FILE: prisma/schema.prisma:452
WHAT: `FollowupJob` stores retry backoff timestamps in `nextRetryAt DateTime?`, but table indexes only cover `@@index([status, scheduledAt])`, `@@index([userId, status])`, `@@index([campaignId, recipientEmail, status])`, and `@@index([userId, recipientEmail, status])`.
SCENARIO:
1. Cold email campaigns experience transient send failures (e.g. SMTP rate limits, temporary socket errors), causing jobs to enter retry backoff (`status = SCHEDULED`, `nextRetryAt = future_timestamp`).
2. The background `followupScheduler` tick runs periodically across all tenants to query due jobs (`status = SCHEDULED` where `nextRetryAt <= NOW()` or `scheduledAt <= NOW()`).
3. PostgreSQL cannot use the `[status, scheduledAt]` index to filter on `nextRetryAt`, requiring a scan and filter across scheduled jobs.
4. As `FollowupJob` table size increases, scheduler ticks cause high CPU and disk IO, delaying email dispatch across all tenants.
FIX: Add `@@index([status, nextRetryAt])` to `model FollowupJob`.

## CHECKED AND SOUND
- **User**: `stripeSubscriptionId` and `stripeCustomerId` are properly marked `@unique` for webhook resolution.
- **Mailbox**: Correctly enforced multi-tenancy with `@@unique([userId, email])` and hot-path indexes `@@index([userId, isActive])`, `@@index([userId, expiresAt])`. Cascades delete on `User`.
- **Lead**: Correctly enforced multi-tenancy with `@@unique([userId, email])` and status/score/bounce indexes `@@index([userId, status])`, `@@index([userId, score])`, `@@index([userId, isBounced])`. Cascades delete on `User`.
- **Campaign**: Multi-tenant scoped with `userId`, `onDelete: Cascade` on `User`, and indexes `@@index([userId, status])`, `@@index([userId, scheduledAt])`.
- **CampaignRecipient**: Prevents duplicate lead enrollment per campaign with `@@unique([campaignId, leadId])`. Cascades delete on `Campaign`.
- **UsageRecord**: Correctly enforces atomic usage updates and period alignment with `@@unique([userId, periodStart])`.
- **ScraperSchedule & ScraperSettings**: Properly restricted to 1:1 user relations with `userId String @unique` and `onDelete: Cascade` from `User`.
- **Client, Project, Invoice**: Properly tenant-scoped with `userId` and `onDelete: Cascade` from `User`. `Invoice` uses tenant-scoped `@@unique([userId, number])`.
- **Receipt**: Uses tenant-scoped `@@unique([userId, number])` and 1:1 payment link `paymentId String @unique`.
- **ClientLoginToken**: Secure single-use hash with global `tokenHash String @unique` and `onDelete: Cascade` on `ClientUser`.
- **TrackingEvent**: Correct cascade behavior (`onDelete: Cascade` for `User`/`Lead`, `onDelete: SetNull` for `Campaign`) preserving event history structure.
MODEL_USED=gemini-3.1-pro-high VIA=file
