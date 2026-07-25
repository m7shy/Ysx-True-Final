-- CreateTable
CREATE TABLE "ScraperSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "minSubs" INTEGER NOT NULL DEFAULT 1000,
    "maxSubs" INTEGER NOT NULL DEFAULT 50000,
    "recentDays" INTEGER NOT NULL DEFAULT 15,
    "minAvgViews" INTEGER NOT NULL DEFAULT 1000,
    "minLongformRatio" DOUBLE PRECISION NOT NULL DEFAULT 0.40,
    "longformMinSecs" INTEGER NOT NULL DEFAULT 60,
    "searchResults" INTEGER NOT NULL DEFAULT 50,
    "uploadsSample" INTEGER NOT NULL DEFAULT 15,
    "faceCheckSample" INTEGER NOT NULL DEFAULT 3,
    "recheckDays" INTEGER NOT NULL DEFAULT 30,
    "strongSignals" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "weakSignals" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "keywordsPerAutoRun" INTEGER NOT NULL DEFAULT 4,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScraperSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScraperSettings_userId_key" ON "ScraperSettings"("userId");

-- AddForeignKey
ALTER TABLE "ScraperSettings" ADD CONSTRAINT "ScraperSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
