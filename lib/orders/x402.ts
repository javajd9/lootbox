// Paying Zinc for each order in USDC on Solana, straight from the prize wallet, through Zinc's
// agent endpoint (POST /agent/orders, https://www.zinc.com/docs/v2/mpp). No prepaid Zinc balance
// and no API key: every order carries its own payment, made with the x402 protocol.
//
//   1. send the order with no payment       -> 402, Zinc's price in the PAYMENT-REQUIRED header
//   2. check that price before signing       -> USDC on Solana mainnet, at most max_price + $1
//   3. sign a USDC transfer for exactly that -> Zinc's facilitator adds the network fee and settles it
//   4. send the order again with it          -> 201: the order, and a key for following it
//
// Never paid twice: a repeat with the same idempotency key gets 409 with the existing order, and Zinc
// checks that before it settles anything. Whatever the retailer doesn't charge comes back to the prize
// wallet (all of it, if the order fails).
//
// Zinc has no test mode on this endpoint ("Test mode is not available on /agent/orders"). Checked
// against the live endpoint: its 402 offers USDC on Solana mainnet for exactly max_price + $1, with
// Zinc's facilitator as the fee payer.
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey, type Connection, type Keypair } from "@solana/web3.js";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { x402Client } from "@x402/core/client";
import { decodePaymentRequiredHeader, decodePaymentResponseHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { SOLANA_MAINNET_CAIP2 } from "@x402/svm";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { ZINC_ORDER_FEE_CENTS } from "./price";
import { ZincError, type ZincClient, type ZincOrder, type ZincOrderRequest, type ZincTimeline, type ZincTracker } from "./zinc";

export const USDC = { network: SOLANA_MAINNET_CAIP2, mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" } as const;

const UNITS_PER_CENT = 10_000n; // USDC has 6 decimals

// The most an order may cost the prize wallet: its cap plus Zinc's flat fee, in USDC base units.
export const maxPaymentUnits = (maxPriceCents: number) => (BigInt(maxPriceCents) + BigInt(ZINC_ORDER_FEE_CENTS)) * UNITS_PER_CENT;
const dollars = (units: bigint) => `$${(Number(units) / 1e6).toFixed(2)}`;

// Where each order's key is kept (the private orders table), so the order can be followed later.
export interface AgentKeys {
  get(orderId: string): Promise<string | null>;
  save(dropId: string, orderId: string, apiKey: string, paymentTx: string | null): Promise<void>;
}

export interface AgentZincOptions {
  baseUrl: string;
  payer: Keypair; // the prize wallet
  conn: Connection;
  rpcUrl?: string;
  keys: AgentKeys;
  fetcher?: typeof fetch;
}

// Of what Zinc's 402 offers, the one to pay: USDC on Solana mainnet, at most the order's cap plus fee.
export function pickRequirement(required: PaymentRequired, maxPriceCents: number): PaymentRequirements {
  const { network, mint } = USDC;
  const ours = required.accepts.find((r) => r.scheme === "exact" && r.network === network && r.asset === mint);
  if (!ours) throw new ZincError(402, "no_usdc_on_solana", `Zinc didn't offer USDC on ${network}; it offered ${required.accepts.map((r) => `${r.asset}@${r.network}`).join(", ") || "nothing"}`);
  const amount = BigInt(ours.amount);
  if (amount > maxPaymentUnits(maxPriceCents)) {
    throw new ZincError(402, "price_over_cap", `Zinc asked for ${dollars(amount)}, more than the order's cap plus fee (${dollars(maxPaymentUnits(maxPriceCents))})`);
  }
  return ours;
}

export function agentZincClient(o: AgentZincOptions): ZincClient & ZincTracker {
  const fetcher = o.fetcher ?? fetch;
  const known = new Map<string, string>(); // order id -> key, for this tick
  const signer = createKeyPairSignerFromBytes(o.payer.secretKey);

  async function send(url: string, init: RequestInit & { headers?: Record<string, string> }) {
    const res = await fetcher(url, {
      ...init,
      headers: { accept: "application/json", ...init.headers },
      cache: "no-store",
    });
    const text = await res.text();
    let json: any = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      // not JSON
    }
    return { res, json };
  }

  const failure = (status: number, json: any, fallback: string) => {
    const e = json?.error && typeof json.error === "object" ? json.error : json;
    return new ZincError(status, e?.code ?? "http_error", e?.message ?? fallback, e?.details);
  };

  async function keyFor(orderId: string): Promise<string> {
    const key = known.get(orderId) ?? (await o.keys.get(orderId));
    if (!key) throw new Error(`no Zinc key saved for order ${orderId}`);
    known.set(orderId, key);
    return key;
  }

  async function read<T>(path: string, orderId: string): Promise<T> {
    const { res, json } = await send(`${o.baseUrl}${path}`, { method: "GET", headers: { Authorization: `Bearer ${await keyFor(orderId)}` } });
    if (!res.ok) throw failure(res.status, json, res.statusText);
    return json as T;
  }
  const getOrder = (id: string) => read<ZincOrder>(`/orders/${encodeURIComponent(id)}`, id);

  // The 201 or 409 that ends a paid request: remember the order's key, then hand back the order.
  async function settled(req: ZincOrderRequest, res: Response, json: any, paymentTx: string | null): Promise<ZincOrder> {
    const apiKey = res.headers.get("x-api-key");
    const dropId = req.po_number ?? req.metadata?.lootbox_drop;
    if (res.status === 409) {
      const e = json?.error && typeof json.error === "object" ? json.error : json;
      const id = String(e?.details?.order_id ?? "");
      if (!id || !apiKey) throw failure(409, json, "Zinc says this order exists but didn't say which");
      known.set(id, apiKey);
      if (dropId) await o.keys.save(dropId, id, apiKey, null);
      return getOrder(id);
    }
    const order = json as ZincOrder;
    if (!order?.id || !apiKey) throw new Error("Zinc accepted the payment but sent back no order or key; the next tick asks again with the same key");
    known.set(order.id, apiKey);
    if (dropId) await o.keys.save(dropId, order.id, apiKey, paymentTx);
    return order;
  }

  return {
    async createOrder(req) {
      const url = `${o.baseUrl}/agent/orders?method=x402`;
      const body = JSON.stringify(req);
      const headers = { "content-type": "application/json" };

      // 1. Unpaid: Zinc answers with its price (or 409 if this order was already placed and paid).
      const first = await send(url, { method: "POST", body, headers });
      if (first.res.status === 409 || first.res.status === 201) return settled(req, first.res, first.json, null);
      if (first.res.status !== 402) throw failure(first.res.status, first.json, first.res.statusText);
      const header = first.res.headers.get("payment-required");
      if (!header) throw new Error("Zinc asked for payment but sent no PAYMENT-REQUIRED header");
      const required = decodePaymentRequiredHeader(header);

      // 2. Check the price, and that the prize wallet can pay it, before anything is signed.
      const requirement = pickRequirement(required, req.max_price);
      const amount = BigInt(requirement.amount);
      const ata = getAssociatedTokenAddressSync(new PublicKey(requirement.asset), o.payer.publicKey, true);
      const held = await o.conn.getTokenAccountBalance(ata).then((b) => BigInt(b.value.amount), () => 0n);
      if (held < amount) throw new Error(`the prize wallet holds ${dollars(held)} USDC; this order needs ${dollars(amount)} (its price cap plus Zinc's $1 fee)`);

      // 3. Sign a USDC transfer for exactly that amount, and nothing else.
      const client = x402Client.fromConfig({
        schemes: [{ network: requirement.network, client: new ExactSvmScheme(await signer, o.rpcUrl ? { rpcUrl: o.rpcUrl } : undefined) }],
        spendControls: { maxAmountPerPayment: false, allowedAssets: [{ network: requirement.network, asset: requirement.asset, maxAmountPerPayment: amount.toString() }] },
      });
      const payment = await client.createPaymentPayload({ ...required, accepts: [requirement] });

      // 4. Paid: the order and its key (or 409: placed before, never charged twice).
      const paid = await send(url, { method: "POST", body, headers: { ...headers, "PAYMENT-SIGNATURE": encodePaymentSignatureHeader(payment) } });
      if (paid.res.status === 201 || paid.res.status === 409) {
        const receipt = paid.res.headers.get("payment-response");
        const tx = receipt ? (decodePaymentResponseHeader(receipt).transaction || null) : null;
        return settled(req, paid.res, paid.json, tx);
      }
      if (paid.res.status === 402) {
        // Payment refused (say the facilitator couldn't settle it): nothing was taken, so try again next tick.
        const again = paid.res.headers.get("payment-required");
        const reason = again ? decodePaymentRequiredHeader(again).error : undefined;
        throw new Error(`Zinc didn't accept the USDC payment${reason ? ` (${reason})` : ""}; nothing was charged`);
      }
      throw failure(paid.res.status, paid.json, paid.res.statusText); // 400: can't be fulfilled, and not charged
    },
    getOrder,
    getTimeline: (id) => read<ZincTimeline>(`/orders/${encodeURIComponent(id)}/timeline`, id),
  };
}
