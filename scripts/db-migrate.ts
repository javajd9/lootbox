// Sets up (or updates) the database: runs every file in supabase/migrations that hasn't run yet,
// in order, each all-or-nothing, and records it so it never runs twice.
//
//   npm run db:migrate
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const DIR = "supabase/migrations";
const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error("SUPABASE_DB_URL is not set in .env (Supabase -> Connect -> Session pooler).");
  process.exit(1);
}

// Supabase requires TLS; its certificate isn't in Node's default list, so it isn't pinned here.
const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await db.connect();
await db.query(`create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now());
                alter table _migrations enable row level security;`);
const applied = new Set((await db.query<{ name: string }>("select name from _migrations")).rows.map((r) => r.name));

for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()) {
  if (applied.has(file)) {
    console.log(`  ${file} (already applied)`);
    continue;
  }
  try {
    await db.query("begin");
    await db.query(fs.readFileSync(path.join(DIR, file), "utf8"));
    await db.query("insert into _migrations (name) values ($1)", [file]);
    await db.query("commit");
    console.log(`✓ ${file}`);
  } catch (err) {
    await db.query("rollback");
    console.error(`✗ ${file}: ${err instanceof Error ? err.message : err}`);
    await db.end();
    process.exit(1);
  }
}
await db.end();
