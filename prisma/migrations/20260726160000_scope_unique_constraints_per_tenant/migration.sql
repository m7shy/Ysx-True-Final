-- Scope two accidentally-global unique constraints to their tenant.
--
-- ClientUser.email and CookieFile.name were both declared globally @unique in a
-- schema that is otherwise tenant-scoped throughout. Same defect class as the
-- Receipt.number issue fixed earlier today: a per-tenant identifier constrained
-- across all tenants.
--
-- Safe against current data (verified before writing this migration):
--   ClientUser  — 2 rows, no duplicate (userId, email), no address shared
--                 across tenants.
--   CookieFile  — 4 rows, all carrying a userId, no duplicate (userId, name).
--
-- Dropping a unique index only ever widens what is accepted, so the DROPs
-- cannot fail on existing rows; the new composite uniques were checked for
-- violations above.

-- DropIndex
DROP INDEX "ClientUser_email_key";

-- DropIndex
DROP INDEX "CookieFile_name_key";

-- CreateIndex
CREATE INDEX "ClientUser_userId_idx" ON "ClientUser"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientUser_userId_email_key" ON "ClientUser"("userId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "CookieFile_userId_name_key" ON "CookieFile"("userId", "name");
