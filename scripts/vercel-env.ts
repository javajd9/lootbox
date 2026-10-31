// Writes .keys/vercel.env: exactly the lines the live site needs, copied from .env, ready to paste
// into Vercel (Settings -> Environment Variables -> paste into the Key box). Leaves out what only
// this computer uses (the database password, test details, gate scripts). Never prints a value.
//
//   npm run vercel:env
import fs from "node:fs";

const NEEDED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CRON_SECRET",
  "SOLANA_CLUSTER",
  "HELIUS_API_KEY",
  "LOOT_MINT",
  "TREASURY_WALLET_SECRET",
  "PRIZE_WALLET",
  "OPS_WALLET_SECRET",
  "EXCLUDED_WALLETS",
  "LAUNCH_AT",
  "ALERT_WEBHOOK_URL",
];

const env = new Map(
  fs
    .readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()] as const),
);
const lines = NEEDED.filter((k) => env.get(k)).map((k) => `${k}=${env.get(k)}`);
fs.mkdirSync(".keys", { recursive: true });
fs.writeFileSync(".keys/vercel.env", lines.join("\n") + "\n");
console.log(`Wrote .keys/vercel.env with ${lines.length} keys:\n  ${NEEDED.filter((k) => env.get(k)).join("\n  ")}`);
const missing = NEEDED.filter((k) => !env.get(k));
if (missing.length) console.log(`Blank in .env, so left out (fine for now): ${missing.join(", ")}`);
