-- Revision round numbers: one per project, enforced by the database.
--
-- portal/routes.ts derives the next round as "read the current max, add one".
-- Two concurrent submissions on the same project — a double-click, or two
-- people on the same client team — both read round N and both insert N+1,
-- giving a client-facing list with two "Round 3" entries and making any
-- approve/deliver action that refers to a round by number ambiguous. No amount
-- of application code fixes a read-then-write race; the constraint does, and
-- the route now retries on the conflict it raises.
--
-- NOT purely additive, unlike the two migrations ahead of it in the queue.
-- Production could already hold duplicates created by exactly this race, and a
-- bare CREATE UNIQUE INDEX would then abort partway through a deploy. Neon was
-- quota-suspended while this was written, so the live data could not be
-- inspected to rule that out — hence the renumber below rather than an
-- assumption that it is unnecessary.
--
-- The renumber is deliberately conservative: within each duplicate group the
-- EARLIEST row keeps the number the client has already seen, and only the later
-- collisions are moved to the end of that project's sequence. It is a no-op on
-- clean data, and re-running it finds nothing left to do.

WITH ranked AS (
    SELECT
        id,
        "projectId",
        ROW_NUMBER() OVER (
            PARTITION BY "projectId", "roundNumber"
            ORDER BY "createdAt", id
        ) AS dup_rank
    FROM "Revision"
),
to_fix AS (
    SELECT
        id,
        "projectId",
        ROW_NUMBER() OVER (PARTITION BY "projectId" ORDER BY id) AS shift
    FROM ranked
    WHERE dup_rank > 1
),
maxes AS (
    SELECT "projectId", MAX("roundNumber") AS max_round
    FROM "Revision"
    GROUP BY "projectId"
)
UPDATE "Revision" AS rev
SET "roundNumber" = maxes.max_round + to_fix.shift
FROM to_fix
JOIN maxes ON maxes."projectId" = to_fix."projectId"
WHERE rev.id = to_fix.id;

-- CreateIndex
CREATE UNIQUE INDEX "Revision_projectId_roundNumber_key" ON "Revision"("projectId", "roundNumber");
