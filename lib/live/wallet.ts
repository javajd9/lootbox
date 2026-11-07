// The visitor's browser wallet: connect, and sign a message. Phantom, Solflare and any wallet that
// injects window.solana; their APIs differ a little (what connect() and signMessage() return), so
// both calls are normalized here. Browser only.
//
// Phone browsers (Safari, Chrome) have no wallet in them, so on a phone the page offers to open
// itself inside the Phantom or Solflare app, whose built-in browser has the wallet.

interface Injected {
  connect(): Promise<unknown>;
  publicKey?: { toString(): string } | null;
  signMessage(message: Uint8Array, display?: "utf8"): Promise<unknown>;
  isSolflare?: boolean;
}

export interface BrowserWallet {
  name: string;
  connect(): Promise<string>; // the wallet's address
  signMessage(message: string): Promise<Uint8Array>; // the 64-byte signature
}

function injected(): { name: string; provider: Injected } | undefined {
  const w = window as unknown as { phantom?: { solana?: Injected }; solflare?: Injected; solana?: Injected };
  if (w.phantom?.solana) return { name: "Phantom", provider: w.phantom.solana };
  if (w.solflare?.isSolflare) return { name: "Solflare", provider: w.solflare };
  if (w.solana) return { name: "your wallet", provider: w.solana };
  return undefined;
}

export function findWallet(): BrowserWallet | undefined {
  const found = injected();
  if (!found) return undefined;
  const p = found.provider;
  return {
    name: found.name,
    async connect() {
      const r = (await p.connect()) as { publicKey?: { toString(): string } } | undefined;
      const key = (r && typeof r === "object" && r.publicKey) || p.publicKey;
      if (!key) throw new Error("The wallet didn't share an address. Try connecting again.");
      return key.toString();
    },
    async signMessage(message) {
      const r = (await p.signMessage(new TextEncoder().encode(message), "utf8")) as Uint8Array | { signature?: Uint8Array };
      const sig = ArrayBuffer.isView(r) ? (r as Uint8Array) : r?.signature;
      if (!sig) throw new Error("The wallet didn't return a signature. Try again.");
      return new Uint8Array(sig);
    },
  };
}

// What to tell the visitor when the wallet said no or something broke.
export function walletError(err: unknown): string {
  const e = err as { code?: number; message?: string } | undefined;
  if (e?.code === 4001 || /reject|cancel|denied|declined/i.test(e?.message ?? "")) return "Cancelled in the wallet. Nothing was signed.";
  return e?.message ? `The wallet ran into a problem: ${e.message}` : "The wallet ran into a problem. Try again.";
}

export const onPhone = () => typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

// Links that open this page inside a wallet app's own browser.
export function openInWalletLinks(url = window.location.href): { name: string; href: string }[] {
  const page = encodeURIComponent(url);
  const ref = encodeURIComponent(window.location.origin);
  return [
    { name: "Phantom", href: `https://phantom.app/ul/browse/${page}?ref=${ref}` },
    { name: "Solflare", href: `https://solflare.com/ul/v1/browse/${page}?ref=${ref}` },
  ];
}
