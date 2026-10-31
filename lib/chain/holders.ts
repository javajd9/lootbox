// Every holder of a token, read through Helius (getTokenAccounts), for snapshots.
import type { TokenAccount } from "@/lib/draws/snapshot";
import { CLUSTER, heliusUrl, type Cluster } from "./solana";

interface HeliusPage {
  cursor?: string;
  token_accounts: { owner: string; amount: number | string }[];
}

export async function readHolders(mint: string, cluster: Cluster = CLUSTER): Promise<TokenAccount[]> {
  const url = heliusUrl(cluster);
  if (!url) throw new Error("HELIUS_API_KEY is not set");
  const accounts: TokenAccount[] = [];
  let cursor: string | undefined;
  do {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "snapshot",
        method: "getTokenAccounts",
        params: { mint, limit: 1000, cursor, options: { showZeroBalance: false } },
      }),
    });
    const body = (await res.json()) as { result?: HeliusPage; error?: { message: string } };
    if (!res.ok || body.error || !body.result) throw new Error(`Helius getTokenAccounts: ${body.error?.message ?? res.status}`);
    for (const a of body.result.token_accounts) accounts.push({ owner: a.owner, amount: BigInt(a.amount) });
    cursor = body.result.token_accounts.length ? body.result.cursor : undefined;
  } while (cursor);
  return accounts;
}
