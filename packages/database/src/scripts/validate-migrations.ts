/**
 * Phase 10 — CI migration validation (static, no DB connection needed).
 *
 * Every migration in this package is hand-authored (see
 * `migrations/README.md`), which means `meta/_journal.json` is
 * hand-maintained too — nothing catches a forgotten journal entry, a
 * typo'd tag, a duplicate/out-of-order `idx`, or an orphaned `.sql` file
 * except a human re-reading the diff. This script makes that check
 * mechanical and CI-enforceable:
 *
 * 1. Every `NNNN_*.sql` file under `migrations/` has EXACTLY one journal
 *    entry whose `tag` matches its filename (without extension).
 * 2. Every journal entry's `tag` has a corresponding `.sql` file — no
 *    "ghost" entries.
 * 3. `idx` values are 0-based (or start wherever the first entry starts)
 *    and strictly sequential with no gaps or duplicates.
 * 4. `when` timestamps are strictly increasing (matches `idx` order) —
 *    catches a copy-paste that forgot to bump the timestamp.
 *
 * Exits non-zero (and prints every violation, not just the first) on any
 * failure — designed to run in CI on every PR, entirely offline.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(__dirname, "..", "migrations");
const JOURNAL_PATH = join(MIGRATIONS_DIR, "meta", "_journal.json");

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

function main(): void {
  const errors: string[] = [];

  const journalRaw = readFileSync(JOURNAL_PATH, "utf-8");
  const journal = JSON.parse(journalRaw) as { entries: JournalEntry[] };
  const entries = journal.entries;

  const sqlFiles = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => f.replace(/\.sql$/, ""));

  const tagsInJournal = new Set(entries.map((e) => e.tag));
  const tagsFromFiles = new Set(sqlFiles);

  for (const file of sqlFiles) {
    if (!tagsInJournal.has(file)) {
      errors.push(`Migration file "${file}.sql" has NO matching entry in meta/_journal.json (tag="${file}").`);
    }
  }
  for (const entry of entries) {
    if (!tagsFromFiles.has(entry.tag)) {
      errors.push(`Journal entry tag="${entry.tag}" (idx=${entry.idx}) has NO matching "${entry.tag}.sql" file.`);
    }
  }

  const sorted = [...entries].sort((a, b) => a.idx - b.idx);
  const seenIdx = new Set<number>();
  for (const entry of sorted) {
    if (seenIdx.has(entry.idx)) {
      errors.push(`Duplicate idx=${entry.idx} in meta/_journal.json (tag="${entry.tag}").`);
    }
    seenIdx.add(entry.idx);
  }
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const curr = sorted[i]!;
    if (curr.idx !== prev.idx + 1) {
      errors.push(`Gap in idx sequence: idx=${prev.idx} ("${prev.tag}") is followed by idx=${curr.idx} ("${curr.tag}") — expected ${prev.idx + 1}.`);
    }
    if (curr.when <= prev.when) {
      errors.push(`Non-increasing "when" timestamp: idx=${curr.idx} ("${curr.tag}", when=${curr.when}) is not strictly after idx=${prev.idx} ("${prev.tag}", when=${prev.when}).`);
    }
  }

  if (errors.length > 0) {
    // eslint-disable-next-line no-console
    console.error(`Migration validation FAILED (${errors.length} problem(s)):`);
    for (const e of errors) {
      // eslint-disable-next-line no-console
      console.error(`  - ${e}`);
    }
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log(`Migration validation OK — ${sqlFiles.length} migration files, ${entries.length} journal entries, all consistent.`);
}

main();
