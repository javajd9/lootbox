// Makes Supabase call the drop engine every minute (pg_cron + pg_net), with the secret kept in
// Supabase's encrypted vault rather than in the job itself. Safe to run again.
//
//   npm run schedule:tick              turn it on (or update it)
//   npm run schedule:tick -- --off     turn it off
//   npm run schedule:tick -- --status  show the last few calls
import "dotenv/config";
import pg from "pg";

const URL = process.env.TICK_URL || "https://www.getlootbox.fun/api/tick";
const JOB = "lootbox-tick";
const SECRET_NAME = "lootbox_cron_secret";

const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
try {
  if (process.argv.includes("--off")) {
    await db.query("select cron.unschedule($1)", [JOB]);
    console.log(`Stopped: ${JOB}`);
  } else if (process.argv.includes("--status")) {
    const { rows } = await db.query(
      `select r.created, r.status_code, left(coalesce(r.error_msg, r.content::text), 160) as result
         from net._http_response r order by r.created desc limit 5`,
    );
    for (const r of rows) console.log(`${new Date(r.created).toISOString().slice(11, 19)}  ${r.status_code ?? "-"}  ${r.result ?? ""}`);
  } else {
    const secret = process.env.CRON_SECRET;
    if (!secret) throw new Error("CRON_SECRET is not set in .env");
    await db.query("create extension if not exists pg_cron");
    await db.query("create extension if not exists pg_net with schema extensions");

    const existing = await db.query("select id from vault.secrets where name = $1", [SECRET_NAME]);
    if (existing.rows.length) await db.query("select vault.update_secret($1, $2)", [existing.rows[0].id, secret]);
    else await db.query("select vault.create_secret($1, $2, 'Lets the scheduler call the LOOTBOX drop engine')", [secret, SECRET_NAME]);

    const call = `select net.http_get(
        url := '${URL}',
        headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = '${SECRET_NAME}')),
        timeout_milliseconds := 60000)`;
    await db.query("select cron.schedule($1, '* * * * *', $2)", [JOB, call]);
    console.log(`Scheduled: ${JOB} calls ${URL} every minute`);
  }
} finally {
  await db.end();
}
