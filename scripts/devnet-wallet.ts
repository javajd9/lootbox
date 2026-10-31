// The devnet ops wallet, kept in .keys/ (never committed; it only ever holds free test SOL).
import fs from "node:fs";
import { Keypair } from "@solana/web3.js";

const KEY_FILE = ".keys/devnet-ops.json";

export function devnetWallet(): Keypair {
  if (fs.existsSync(KEY_FILE)) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(KEY_FILE, "utf8"))));
  const kp = Keypair.generate();
  fs.mkdirSync(".keys", { recursive: true });
  fs.writeFileSync(KEY_FILE, JSON.stringify([...kp.secretKey]));
  return kp;
}
