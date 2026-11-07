// Makes LOOTBOX's three wallets and puts them in .env:
//   treasury  creates $LOOT on pump.fun, so every creator fee lands in it, and holds the pool
//   prize     receives each prize's worth in USDC the moment a pool fills, then pays Zinc for the order
//   ops       pays transaction fees and signs every proof fingerprint and randomness request
// Each key is also kept in .keys/mainnet-<name>.json (never committed), and running again reuses
// them, so it never replaces a wallet. Never prints a secret.
//
//   npm run mainnet:wallets
//
// Back up the three .keys files somewhere safe and offline: whoever holds the treasury key holds the pool.
import fs from "node:fs";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

function wallet(name: string): { kp: Keypair; made: boolean } {
  const file = `.keys/mainnet-${name}.json`;
  if (fs.existsSync(file)) return { kp: Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8")))), made: false };
  const kp = Keypair.generate();
  fs.mkdirSync(".keys", { recursive: true });
  fs.writeFileSync(file, JSON.stringify([...kp.secretKey]), { flag: "wx" }); // never overwrites a key
  return { kp, made: true };
}

const wallets = { treasury: wallet("treasury"), prize: wallet("prize"), ops: wallet("ops") };
const values: Record<string, string> = {
  TREASURY_WALLET_SECRET: bs58.encode(wallets.treasury.kp.secretKey),
  PRIZE_WALLET: wallets.prize.kp.publicKey.toBase58(),
  PRIZE_WALLET_SECRET: bs58.encode(wallets.prize.kp.secretKey),
  OPS_WALLET_SECRET: bs58.encode(wallets.ops.kp.secretKey),
};

let env = fs.existsSync(".env") ? fs.readFileSync(".env", "utf8") : "";
for (const [key, value] of Object.entries(values)) {
  const line = new RegExp(`^${key}=.*$`, "m");
  env = line.test(env) ? env.replace(line, () => `${key}=${value}`) : `${env.replace(/\n?$/, "\n")}${key}=${value}\n`;
}
fs.writeFileSync(".env", env);

for (const [name, w] of Object.entries(wallets)) console.log(`${name.padEnd(9)}${w.kp.publicKey.toBase58()}${w.made ? "  (new)" : ""}`);
console.log(`
Saved in .env (TREASURY_WALLET_SECRET, PRIZE_WALLET, PRIZE_WALLET_SECRET, OPS_WALLET_SECRET) and .keys/mainnet-*.json.
Next: back up .keys/mainnet-*.json, send the ops wallet 0.1+ SOL, and import TREASURY_WALLET_SECRET into Phantom
(Add account -> Import private key) to create $LOOT on pump.fun from it.`);
