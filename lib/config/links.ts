// LOOTBOX's official links, read from the environment so launch day needs no code change. Once
// LOOT_MINT is set, "Buy $LOOT" goes to the coin's pump.fun page and the contract address is shown;
// until then it goes to /docs/addresses, where the addresses will be published. The X link is left
// out until it's set (and only an x.com / twitter.com link counts). The source code's link is fixed.
// Server only: it reads the same settings as /docs/addresses.
import { publishedAddresses } from "./addresses";
import { GITHUB_URL } from "./source";

export interface OfficialLinks {
  mint?: string; // the $LOOT contract address
  buy: { href: string; external: boolean };
  pumpfun?: string;
  x?: string;
  github: string;
}

const https = (url: string | undefined, hosts: string[]) => {
  try {
    const u = new URL((url ?? "").trim());
    return u.protocol === "https:" && hosts.includes(u.hostname) ? u.toString() : undefined;
  } catch {
    return undefined;
  }
};

export function officialLinks(env: Record<string, string | undefined> = process.env): OfficialLinks {
  const mint = publishedAddresses(env).token;
  const pumpfun = mint ? `https://pump.fun/coin/${mint}` : undefined;
  return {
    mint,
    buy: pumpfun ? { href: pumpfun, external: true } : { href: "/docs/addresses", external: false },
    pumpfun,
    x: https(env.X_URL, ["x.com", "twitter.com", "www.x.com", "www.twitter.com"]),
    github: GITHUB_URL,
  };
}
