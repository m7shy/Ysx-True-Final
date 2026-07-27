-- Server-side refresh tokens: rotation with reuse detection.
--
-- Refresh tokens were stateless JWTs, so a stolen one worked for its full
-- 30-day life and the only remedy (bumping tokenVersion) logged the victim out
-- of every device at once. Each login now opens a FAMILY; each refresh consumes
-- one token and mints its successor in the same family; a second consumption of
-- an already-used token means two parties hold it, and the family is revoked.
--
-- Only sha256(token) is stored — a dump of this table must not be a set of
-- working credentials.
--
-- Additive: one new table, no existing column touched. It cannot fail on
-- current data.
--
-- ⚠️ DEPLOY CONSEQUENCE: every existing session is stateless and therefore has
-- no row here, so the first refresh after deploy returns 401 and EVERY USER IS
-- LOGGED OUT ONCE. That is expected and unavoidable — the whole point is that a
-- refresh token with no server-side record is no longer trusted.

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "clientUserId" TEXT,
    "familyId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_clientUserId_idx" ON "RefreshToken"("clientUserId");

-- CreateIndex
CREATE INDEX "RefreshToken_familyId_idx" ON "RefreshToken"("familyId");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_clientUserId_fkey" FOREIGN KEY ("clientUserId") REFERENCES "ClientUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
