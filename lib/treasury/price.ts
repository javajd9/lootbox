// The SOL price in US dollars, from Jupiter's public price API.
const SOL_MINT = "So11111111111111111111111111111111111111112";

export async function solPriceUsd(): Promise<number> {
  const res = await fetch(`https://lite-api.jup.ag/price/v3?ids=${SOL_MINT}`, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as Record<string, { usdPrice?: number } | undefined>;
  const price = body[SOL_MINT]?.usdPrice;
  if (!res.ok || !price || !(price > 0)) throw new Error("SOL price unavailable");
  return price;
}
