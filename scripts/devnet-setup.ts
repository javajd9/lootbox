// Sets up the devnet wallets the engine uses and fills them into .env (only where blank):
// the treasury (where the pool collects), the prize wallet, and the tLOOT mint. Never prints a
// secret. Safe to run again.
//
//   npm run devnet:setup
import fs from "node:fs";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

function keypair(file: string): Keypair {
  if (fs.existsSync(file)) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8"))));
  const kp = Keypair.generate();
  fs.mkdirSync(".keys", { recursive: true });
  fs.writeFileSync(file, JSON.stringify([...kp.secretKey]));
  return kp;
}

const treasury = keypair(".keys/devnet-treasury.json");
const prize = keypair(".keys/devnet-prize.json");
const { mint } = JSON.parse(fs.readFileSync(".keys/devnet-token.json", "utf8")) as { mint: string };

const values: Record<string, string> = {
  TREASURY_WALLET_SECRET: bs58.encode(treasury.secretKey),
  PRIZE_WALLET: prize.publicKey.toBase58(),
  LOOT_MINT: mint,
};

let env = fs.readFileSync(".env", "utf8");
for (const [key, value] of Object.entries(values)) {
  const line = new RegExp(`^${key}=.*$`, "m");
  if (!line.test(env)) env += `\n${key}=${value}`;
  else if (new RegExp(`^${key}=\\s*$`, "m").test(env)) env = env.replace(line, `${key}=${value}`);
  else continue;
  console.log(`set ${key}`);
}
fs.writeFileSync(".env", env);
console.log(`treasury ${treasury.publicKey.toBase58()}\nprize    ${prize.publicKey.toBase58()}\ntLOOT    ${mint}`);
