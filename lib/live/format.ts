export const usd = (n: number) => `$${Math.floor(n).toLocaleString("en-US")}`;
export const dropNo = (n: number) => String(n).padStart(3, "0");
export const shortWallet = (w: string) => `${w.slice(0, 4)}…${w.slice(-4)}`;

// Fees and trade sizes: cents while small, whole dollars once big.
const money = (n: number, wholeFrom: number) => (n >= wholeFrom ? usd(Math.round(n)) : `$${n.toFixed(2)}`);

// A coin's label: "+$4.20 · $3,100 buy" (the fee, then the trade that paid it).
export function feeLabel(t: { usd: number; tradeUsd?: number; side?: "buy" | "sell" }): string {
  const fee = `+${money(t.usd, 100)}`;
  return t.tradeUsd === undefined ? fee : `${fee} · ${money(t.tradeUsd, 10)} ${t.side ?? "trade"}`;
}

// A coin's size in pixels: bigger fees, bigger coins, so whales stand out ($0 → 16px, $200+ → 40px).
export const coinPx = (feeUsd: number) => Math.round(16 + Math.min(1, Math.log10(1 + Math.max(0, feeUsd)) / Math.log10(201)) * 24);

export const txUrl = (signature: string, cluster: "devnet" | "mainnet-beta") =>
  `https://solscan.io/tx/${signature}${cluster === "devnet" ? "?cluster=devnet" : ""}`;
