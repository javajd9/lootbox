// The go / no-go before mainnet: reads .env, the chain, Shopify, Helius, the scheduler and the live
// site, and lists anything that would stop the first drop. Read only: it signs, sends and changes
// nothing, and never prints a secret.
//
//   npm run launch:check
//
// ✗ stops the launch, ! is worth a look, ✓ is fine. Exits 1 if anything is ✗.
import "dotenv/config";
import fs from "node:fs";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import pg from "pg";
import { bondingCurveAddress, decodeBondingCurve, poolAddress, PUMP_PROGRAM_ID } from "@/lib/chain/pump";
import { CLUSTER, connection } from "@/lib/chain/solana";
import { dropQueue } from "@/lib/engine/drops";
import { orderCap, ZINC_ORDER_FEE_CENTS } from "@/lib/orders/price";
import { quoteUsdc } from "@/lib/treasury/swap";

const SITE = "https://www.getlootbox.fun";
const OPS_MIN_SOL = 0.1; // memos, randomness requests, fee collects and the swap's fees
const env = process.env;

let failed = 0;
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const warn = (msg: string) => console.log(`  ! ${msg}`);
const fail = (msg: string) => {
  failed++;
  console.log(`  ✗ ${msg}`);
};
const section = (name: string) => console.log(`\n${name}`);
async function attempt(what: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    fail(`${what}: ${(err instanceof Error ? err.message : String(err)).replace(/api-key=[^&\s"']+/gi, "api-key=…")}`);
  }
}

const keypair = (name: string) => {
  try {
    const kp = Keypair.fromSecretKey(bs58.decode(env[name]!.trim()));
    return kp;
  } catch {
    return undefined;
  }
};
const devnetKeys = new Set(
  fs.existsSync(".keys")
    ? fs
        .readdirSync(".keys")
        .filter((f) => f.startsWith("devnet-") && f.endsWith(".json"))
        .flatMap((f) => {
          try {
            const raw = JSON.parse(fs.readFileSync(`.keys/${f}`, "utf8"));
            return Array.isArray(raw) ? [Keypair.fromSecretKey(Uint8Array.from(raw)).publicKey.toBase58()] : raw.mint ? [String(raw.mint)] : [];
          } catch {
            return [];
          }
        })
    : [],
);

// --- Settings ---
section("Settings (.env, copied to Vercel with npm run vercel:env)");
if (CLUSTER === "mainnet-beta") ok("SOLANA_CLUSTER is mainnet-beta");
else fail(`SOLANA_CLUSTER is ${env.SOLANA_CLUSTER || "unset"}; set it to mainnet-beta`);

const required = [
  "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_URL", "CRON_SECRET",
  "HELIUS_API_KEY", "LOOT_MINT", "TREASURY_WALLET_SECRET", "PRIZE_WALLET", "PRIZE_WALLET_SECRET", "OPS_WALLET_SECRET",
  "LAUNCH_AT", "FEES_WEBHOOK_SECRET", "ALERT_WEBHOOK_URL", "SHOPIFY_STORE_DOMAIN", "SHOPIFY_WEBHOOK_SECRET",
  "RECLAIM_APP_ID", "RECLAIM_APP_SECRET", "ZINC_FALLBACK_PHONE",
];
const missing = required.filter((k) => !env[k]?.trim());
if (missing.length) fail(`not set: ${missing.join(", ")}`);
else ok("every launch setting is filled in");
if (!env.SHOPIFY_ADMIN_TOKEN && !(env.SHOPIFY_CLIENT_ID && env.SHOPIFY_CLIENT_SECRET)) fail("Shopify access: set SHOPIFY_ADMIN_TOKEN, or SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET");
if (!env.X_URL) warn("X_URL isn't set: /docs/addresses tells people the addresses are pinned on X");
if (!env.TELEGRAM_URL) warn("TELEGRAM_URL isn't set (it's left out of the footer)");
if ((env.CRON_SECRET ?? "").length < 32) warn("CRON_SECRET is shorter than 32 characters");
if (env.FEES_WEBHOOK_SECRET && env.FEES_WEBHOOK_SECRET.length < 32) warn("FEES_WEBHOOK_SECRET is shorter than 32 characters");

if (env.LAUNCH_AT) {
  const at = Date.parse(env.LAUNCH_AT);
  if (Number.isNaN(at) || !/Z|[+-]\d\d:\d\d$/.test(env.LAUNCH_AT)) fail(`LAUNCH_AT "${env.LAUNCH_AT}" isn't an ISO time with a zone, e.g. 2026-11-18T17:00:00Z`);
  else if (at < Date.now()) warn(`LAUNCH_AT ${env.LAUNCH_AT} has passed: DROP-001 opens on the first tick`);
  else ok(`DROP-001 opens at ${new Date(at).toISOString()} (in ${((at - Date.now()) / 36e5).toFixed(1)} hours)`);
}

// --- Wallets ---
section("Wallets");
const treasury = keypair("TREASURY_WALLET_SECRET");
const ops = keypair("OPS_WALLET_SECRET");
const prizeKey = keypair("PRIZE_WALLET_SECRET");
let prize: PublicKey | undefined;
try {
  prize = new PublicKey(env.PRIZE_WALLET!.trim());
} catch {}
if (!treasury) fail("TREASURY_WALLET_SECRET isn't a base58 secret key");
if (!ops) fail("OPS_WALLET_SECRET isn't a base58 secret key");
if (!prize) fail("PRIZE_WALLET isn't an address");
if (!prizeKey) fail("PRIZE_WALLET_SECRET isn't a base58 secret key (needed to pay Zinc in USDC)");
else if (prize && !prizeKey.publicKey.equals(prize)) fail("PRIZE_WALLET_SECRET isn't the key for PRIZE_WALLET");
const own = [treasury?.publicKey, ops?.publicKey, prize].filter((k): k is PublicKey => !!k).map((k) => k.toBase58());
if (new Set(own).size !== own.length) fail("the treasury, prize and ops wallets must be three different wallets");
const reused = own.filter((a) => devnetKeys.has(a));
if (reused.length) warn(`${reused.length === 1 ? "one of these wallets is a devnet test wallet" : `${reused.length} of these wallets are devnet test wallets`} from .keys; fresh mainnet keys are safer`);
if (treasury && ops && prize) {
  console.log(`    treasury ${treasury.publicKey.toBase58()}\n    prize    ${prize.toBase58()}\n    ops      ${ops.publicKey.toBase58()}`);
}

// --- On-chain ---
section("Solana mainnet");
const conn = connection("mainnet-beta");
let mint: PublicKey | undefined;
try {
  mint = new PublicKey(env.LOOT_MINT!.trim());
} catch {
  fail("LOOT_MINT isn't an address");
}
if (mint && devnetKeys.has(mint.toBase58())) fail("LOOT_MINT is still the devnet test token");

if (mint && treasury) {
  await attempt("read the $LOOT bonding curve", async () => {
    const info = await conn.getAccountInfo(bondingCurveAddress(mint!));
    if (!info || !info.owner.equals(PUMP_PROGRAM_ID)) return fail("LOOT_MINT isn't a pump.fun coin on mainnet (no bonding curve)");
    const curve = decodeBondingCurve(info.data);
    if (curve.creator.equals(treasury!.publicKey)) ok("the coin's creator is the treasury, so creator fees go to it");
    else fail(`pump.fun pays this coin's creator fees to ${curve.creator.toBase58()}, not the treasury`);
    // Flags after the creator, per the layout in lib/chain/pump.ts.
    const d = info.data;
    if (d.length > 82 && d[82] === 1) warn("the coin is marked as a cashback coin: check its creator fees still reach the treasury");
    if (d.length > 81 && d[81] === 1) warn("the coin is in mayhem mode");
    if (d.length > 124 && d[124] === 1) warn("the coin is marked for holder rewards: check its creator fees still reach the treasury");
    if (d.length >= 123 && d.readBigUInt64LE(115) === 0n) warn("the bonding curve reports a creator fee of 0 bps");
    console.log(`    bonding curve ${bondingCurveAddress(mint!).toBase58()}\n    pool          ${poolAddress(mint!).toBase58()}${curve.complete ? " (graduated)" : ""}`);
  });
}
if (ops) {
  await attempt("read the ops wallet", async () => {
    const sol = (await conn.getBalance(ops!.publicKey)) / LAMPORTS_PER_SOL;
    if (sol >= OPS_MIN_SOL) ok(`ops wallet holds ${sol.toFixed(3)} SOL`);
    else fail(`ops wallet holds ${sol.toFixed(3)} SOL; it pays every memo, randomness request and fee collect, so send it at least ${OPS_MIN_SOL} SOL`);
  });
}

// --- The first drop's prize ---
section("DROP-001 prize");
for (const c of dropQueue("mainnet-beta")) {
  const cap = orderCap(c.prize, c.goalCents, ZINC_ORDER_FEE_CENTS);
  if (cap.ok) ok(`${c.id}: ${cap.lines.length} items, caps add up to $${(cap.maxPriceCents / 100).toFixed(2)} of the $${(c.goalCents / 100).toFixed(2)} pool (plus Zinc's $1)`);
  else fail(`${c.id}: ${cap.reason} (fill in each ASIN and maxPriceCents in lib/config/prizes.ts)`);
}
await attempt("quote the prize swap on Jupiter", async () => {
  const goal = dropQueue("mainnet-beta")[0].goalCents;
  const q = await quoteUsdc(goal);
  ok(`Jupiter quotes $${(goal / 100).toFixed(0)} USDC for ${(Number(q.inAmount) / LAMPORTS_PER_SOL).toFixed(3)} SOL right now`);
});

// --- Shopify ---
section("Shopify claim checkout");
const shop = env.SHOPIFY_STORE_DOMAIN?.trim();
if (shop) {
  await attempt("Shopify Admin API", async () => {
    let token = env.SHOPIFY_ADMIN_TOKEN;
    if (!token && env.SHOPIFY_CLIENT_ID && env.SHOPIFY_CLIENT_SECRET) {
      const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "client_credentials", client_id: env.SHOPIFY_CLIENT_ID, client_secret: env.SHOPIFY_CLIENT_SECRET }),
      });
      if (!res.ok) return fail(`Shopify token: HTTP ${res.status}`);
      token = ((await res.json()) as { access_token: string }).access_token;
    }
    const res = await fetch(`https://${shop}/admin/api/${env.SHOPIFY_API_VERSION || "2026-01"}/graphql.json`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-shopify-access-token": token! },
      body: JSON.stringify({ query: "{ shop { name plan { displayName } } currentAppInstallation { accessScopes { handle } } }" }),
    });
    const body = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || body.errors) return fail(`Shopify Admin API: ${body.errors?.[0]?.message ?? `HTTP ${res.status}`}`);
    const scopes: string[] = body.data.currentAppInstallation.accessScopes.map((s: { handle: string }) => s.handle);
    ok(`signed in to "${body.data.shop.name}" (${body.data.shop.plan.displayName} plan)`);
    if (scopes.includes("write_draft_orders")) ok("the app can create draft orders");
    else fail("the Shopify app is missing the write_draft_orders scope");
    if (/trial|development|partner/i.test(body.data.shop.plan.displayName)) warn("the store looks like it's on a trial plan: a trial store's password page blocks the winner's checkout");
  });
  await attempt("Shopify storefront", async () => {
    const res = await fetch(`https://${shop}/`, { redirect: "manual" });
    if (/\/password/.test(res.headers.get("location") ?? "")) fail("the store has a password page, so winners can't check out. Pick a paid plan and remove the password");
    else ok("no password page");
  });
} else fail("SHOPIFY_STORE_DOMAIN isn't set");
warn("check by hand in Shopify: an Order creation webhook to https://www.getlootbox.fun/api/shopify/orders, shipping to the United States only, and phone number required at checkout");

// --- Helius ---
section("Helius trade webhook (homepage coins)");
if (env.HELIUS_API_KEY && mint) {
  await attempt("Helius webhooks", async () => {
    const res = await fetch(`https://api.helius.xyz/v0/webhooks?api-key=${env.HELIUS_API_KEY}`);
    if (!res.ok) return fail(`Helius webhooks: HTTP ${res.status}`);
    const hooks = (await res.json()) as { webhookURL: string; webhookType: string; accountAddresses: string[]; authHeader?: string }[];
    const url = env.FEES_WEBHOOK_URL || `${SITE}/api/fees`;
    const hook = hooks.find((h) => h.webhookURL === url);
    if (!hook) return fail(`no Helius webhook sends to ${url}; run npm run helius:webhook -- --apply`);
    const watched = [bondingCurveAddress(mint!).toBase58(), poolAddress(mint!).toBase58()];
    if (hook.webhookType !== "raw") fail(`the webhook is "${hook.webhookType}"; mainnet needs "raw" (run npm run helius:webhook -- --apply)`);
    else if (!watched.every((a) => hook.accountAddresses.includes(a))) fail("the webhook doesn't watch this coin's bonding curve and pool (run npm run helius:webhook -- --apply)");
    else ok(`Helius sends this coin's trades to ${url}`);
    if (hook.authHeader !== undefined && hook.authHeader !== env.FEES_WEBHOOK_SECRET) fail("the webhook's auth header isn't FEES_WEBHOOK_SECRET");
    const stale = hooks.filter((h) => h !== hook && /getlootbox\.fun/.test(h.webhookURL));
    if (stale.length) warn(`${stale.length} other Helius webhook(s) also point at getlootbox.fun (old devnet ones?)`);
  });
}

// --- Database and scheduler ---
section("Database and scheduler");
if (env.SUPABASE_DB_URL) {
  await attempt("Supabase", async () => {
    const db = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
    await db.connect();
    try {
      const applied = new Set((await db.query<{ name: string }>("select name from _migrations")).rows.map((r) => r.name));
      const pending = fs.readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql") && !applied.has(f));
      if (pending.length) fail(`migrations not applied: ${pending.join(", ")} (npm run db:migrate)`);
      else ok("every migration is applied");
      const job = (await db.query("select active, schedule, command from cron.job where jobname = 'lootbox-tick'")).rows[0];
      if (!job) fail("no lootbox-tick job: run npm run schedule:tick");
      else if (!job.active) fail("the lootbox-tick job is paused");
      else if (!String(job.command).includes(`${SITE}/api/tick`)) fail(`the lootbox-tick job doesn't call ${SITE}/api/tick`);
      else ok(`the engine is called ${job.schedule === "* * * * *" ? "every minute" : `on "${job.schedule}"`}`);
      const recent = (await db.query("select status_code from net._http_response order by created desc limit 10")).rows.map((r) => r.status_code);
      const bad = recent.filter((s) => s !== 200).length;
      if (!recent.length) warn("no scheduler calls recorded yet");
      else if (bad) fail(`${bad} of the last ${recent.length} engine calls didn't return 200 (npm run schedule:tick -- --status)`);
      else ok(`the last ${recent.length} engine calls all returned 200`);
    } finally {
      await db.end();
    }
  });
}

// --- The live site ---
section(`The live site (${SITE}), after the Vercel redeploy`);
await attempt("/api/live", async () => {
  const live = (await (await fetch(`${SITE}/api/live`, { cache: "no-store" })).json()) as { cluster: string; drop: { id: string; stage: string } | null; lastWinner: unknown };
  if (live.cluster !== "mainnet-beta") return fail(`the site still runs on ${live.cluster}: set SOLANA_CLUSTER=mainnet-beta in Vercel and redeploy`);
  ok("the site runs on mainnet");
  if (live.drop?.id === "DROP-001") ok(`DROP-001 is ${live.drop.stage}`);
  else fail(`the homepage shows ${live.drop ? live.drop.id : "no drop"}, not DROP-001`);
  if (live.lastWinner) warn("the homepage shows a past winner on mainnet; check it isn't a devnet test drop");
});
await attempt("/docs/addresses", async () => {
  const html = await (await fetch(`${SITE}/docs/addresses`, { cache: "no-store" })).text();
  const expected = [mint?.toBase58(), treasury?.publicKey.toBase58(), prize?.toBase58(), ops?.publicKey.toBase58()].filter(Boolean) as string[];
  const shown = expected.filter((a) => html.includes(a));
  if (expected.length && shown.length === expected.length) ok("/docs/addresses shows the same token and wallets as .env, so Vercel has the same keys");
  else fail(`/docs/addresses shows ${shown.length} of ${expected.length} addresses from .env: Vercel's settings differ, or it hasn't redeployed`);
});

console.log(failed ? `\n${failed} thing(s) to fix before launch.` : "\nReady: nothing blocks the launch.");
process.exit(failed ? 1 : 0);
