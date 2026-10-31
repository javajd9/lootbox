// Runs the drop engine against devnet from this computer, exactly as the scheduler does online.
//
//   npm run devnet:tick                              one tick
//   npm run devnet:tick -- --every 20 --for 300      a tick every 20 seconds for 5 minutes
import "dotenv/config";
import { liveEffects, liveStore } from "@/lib/engine/live";
import { tick } from "@/lib/engine/run";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : 0;
};
const every = arg("every");
const until = Date.now() + arg("for") * 1000;
const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

do {
  const report = await tick(liveStore(), liveEffects());
  const state = await liveStore().load();
  const time = new Date().toISOString().slice(11, 19);
  if (!report) console.log(`${time}  skipped: another tick is running`);
  else {
    const drops = state.drops.map((d) => `${d.id} ${d.stage}${d.hold ? ` (hold: ${d.hold})` : ""}`).join(" | ");
    console.log(`${time}  pool ${usd(report.poolCents)}  ${drops}`);
    for (const s of report.steps) console.log(`          ✓ ${s.dropId} ${s.effect.type}${s.effect.type === "alert" ? `: ${s.effect.message}` : ""}`);
    for (const e of report.errors) console.log(`          ✗ ${e.what}: ${e.error}`);
  }
  if (every && Date.now() + every * 1000 < until) await new Promise((r) => setTimeout(r, every * 1000));
  else break;
} while (true);
