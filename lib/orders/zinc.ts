// Zinc buys the prize from Amazon (or any retailer it supports) and ships it to the winner.
// This is its v2 API (https://www.zinc.com/docs): POST /orders places an order, GET /orders/{id}
// reads it back. Every amount is in cents.
//
// Spending is capped twice: `max_price` on the order (Zinc fails the order rather than pay more),
// and the engine's own cap check before it ever sends one (see ./price).

export type ZincStatus = "pending" | "in_progress" | "order_placed" | "order_failed" | "cancelled" | "cancelled_by_retailer";

export interface ZincAddress {
  first_name: string;
  last_name: string;
  address_line1: string;
  address_line2?: string | null;
  city: string;
  state?: string | null;
  postal_code: string;
  phone_number: string;
  country?: string; // ISO alpha-2, defaults to US
}

export interface ZincOrderRequest {
  products: { url: string; quantity: number }[];
  max_price: number;
  shipping_address: ZincAddress;
  idempotency_key: string; // at most 36 characters; Zinc makes at most one order per key
  metadata?: Record<string, string>;
  po_number?: string;
}

export interface ZincPriceComponents {
  subtotal?: number | null;
  tax?: number | null;
  shipping?: number | null;
  discount?: number | null;
  fees?: number | null;
  total?: number | null;
  currency?: string | null;
  cart_items?: { name?: string | null; product_id?: string | null; quantity?: number | null; unit_price?: number | null; line_total?: number | null }[] | null;
}

// A package's carrier-reported state. Not final until `delivered`: one waiting for pickup can still
// go back out, and an undeliverable one can still be returned.
export type TrackingStatus = "pending" | "in_transit" | "available_for_pickup" | "delivered" | "undeliverable";

// One package. Zinc also returns its tracking number and carrier scans (with locations); the engine
// never reads or keeps those, since a carrier's page can show where it was delivered.
export interface ZincPackage {
  id: string;
  carrier: string;
  status?: TrackingStatus | null;
  [unread: string]: unknown; // tracking_number, checkpoints, ...
}

// GET /orders/{id}/timeline: the order's milestones, oldest first. `delivered` appears once every
// package on the order has been delivered. Its `detail` holds the delivery location: never read.
export interface ZincTimeline {
  order_id: string;
  current_status: ZincStatus;
  milestones: { type: string; label: string; occurred_at: string; source: string }[];
}

// The parts of Zinc's order object the engine reads.
export interface ZincOrder {
  id: string;
  status: ZincStatus;
  max_price: number;
  items: { id: string; url: string; quantity: number; status: string }[];
  merchant_order_ids?: string[];
  tracking_numbers?: ZincPackage[] | null;
  job_result?: {
    success?: boolean | null;
    error?: string | null;
    error_type?: string | null;
    price_components?: ZincPriceComponents | null;
  } | null;
  created_at: string;
  updated_at: string;
}

export class ZincError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: Record<string, unknown>) {
    super(`Zinc ${code} (HTTP ${status}): ${message}`);
    this.name = "ZincError";
  }
}

export interface ZincClient {
  createOrder(req: ZincOrderRequest): Promise<ZincOrder>;
  getOrder(id: string): Promise<ZincOrder>;
}

// Following a placed order's packages until they're delivered.
export interface ZincTracker {
  getOrder(id: string): Promise<ZincOrder>;
  getTimeline(id: string): Promise<ZincTimeline>;
}

export interface ZincSettings {
  apiKey: string;
  baseUrl: string;
  authHeader: string;
}

export function zincSettings(env: Record<string, string | undefined> = process.env): ZincSettings {
  const apiKey = env.ZINC_API_KEY;
  if (!apiKey) throw new Error("ZINC_API_KEY is not set");
  const baseUrl = (env.ZINC_BASE_URL || "https://api.zinc.com").replace(/\/+$/, "");
  // v2 keys (zn_...) are Bearer tokens; the old v1 API used the key as a Basic username.
  const authHeader = env.ZINC_AUTH === "basic" ? `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}` : `Bearer ${apiKey}`;
  return { apiKey, baseUrl, authHeader };
}

// zn_test_ keys run in Zinc's sandbox: no real orders, no charges.
export const isTestKey = (apiKey: string) => apiKey.startsWith("zn_test_");

export const orderUrl = (s: ZincSettings, id: string) => `${s.baseUrl}/orders/${encodeURIComponent(id)}`;
export const timelineUrl = (s: ZincSettings, id: string) => `${orderUrl(s, id)}/timeline`;

export function zincClient(s: ZincSettings = zincSettings(), fetcher: typeof fetch = fetch): ZincClient & ZincTracker {
  async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
    const res = await fetcher(url, {
      method,
      headers: { Authorization: s.authHeader, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const text = await res.text();
    let json: any;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = {};
    }
    if (!res.ok) throw new ZincError(res.status, json.code ?? "http_error", json.message ?? (text.slice(0, 200) || res.statusText), json.details);
    return json as T;
  }
  return {
    createOrder: (req) => call<ZincOrder>("POST", `${s.baseUrl}/orders`, req),
    getOrder: (id) => call<ZincOrder>("GET", orderUrl(s, id)),
    getTimeline: (id) => call<ZincTimeline>("GET", timelineUrl(s, id)),
  };
}
