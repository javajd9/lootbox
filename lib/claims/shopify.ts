// The $0 Shopify checkout. Shopify collects the winner's shipping address on its own checkout
// page, so it never passes through LOOTBOX's site. Each claim gets a draft order: one $0 line for
// the drop's prize, free shipping, and the claim token as a hidden attribute that comes back on
// the order webhook.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { ShippingAddress } from "@/lib/proofs/commitment";

export const CLAIM_ATTRIBUTE = "lootbox_claim";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-01";

// Shopify signs every webhook: base64 HMAC-SHA256 of the raw body with the webhook secret.
export function verifyShopifyHmac(rawBody: string, header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  let given: Buffer;
  try {
    given = Buffer.from(header, "base64");
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// The parts of Shopify's orders/create payload this uses.
export interface ShopifyOrder {
  id: number | string;
  note_attributes?: { name: string; value: string }[];
  shipping_address?: {
    name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    address1?: string | null;
    address2?: string | null;
    city?: string | null;
    province?: string | null;
    province_code?: string | null;
    zip?: string | null;
    country_code?: string | null;
    phone?: string | null;
  } | null;
  phone?: string | null;
}

export function claimTokenOf(order: ShopifyOrder): string | null {
  return order.note_attributes?.find((a) => a.name === CLAIM_ATTRIBUTE)?.value || null;
}

export function shippingAddressOf(order: ShopifyOrder): ShippingAddress | null {
  const a = order.shipping_address;
  if (!a?.address1 || !a.city || !a.zip) return null;
  const name = a.name || [a.first_name, a.last_name].filter(Boolean).join(" ");
  return {
    name,
    line1: a.address1,
    line2: a.address2 || undefined,
    city: a.city,
    state: a.province_code || a.province || "",
    zip: a.zip,
    // Zinc needs a phone number for the carrier; it stays private like the rest.
    phone: a.phone || order.phone || undefined,
    country: a.country_code || undefined,
  };
}

// An Admin API token: pasted in directly, or fetched with the app's client ID and secret (apps
// made in Shopify's Dev Dashboard). Fetched tokens last a day; one is reused until near its end.
let cached: { token: string; until: number } | undefined;

async function adminToken(domain: string): Promise<string> {
  if (process.env.SHOPIFY_ADMIN_TOKEN) return process.env.SHOPIFY_ADMIN_TOKEN;
  const id = process.env.SHOPIFY_CLIENT_ID;
  const secret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Shopify is not configured (SHOPIFY_ADMIN_TOKEN, or SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET)");
  if (cached && Date.now() < cached.until) return cached.token;
  const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Shopify token: HTTP ${res.status}`);
  const body = (await res.json()) as { access_token: string; expires_in?: number };
  cached = { token: body.access_token, until: Date.now() + ((body.expires_in ?? 3600) - 300) * 1000 };
  return cached.token;
}

export function shopifyConfigured(): boolean {
  return Boolean(process.env.SHOPIFY_STORE_DOMAIN && (process.env.SHOPIFY_ADMIN_TOKEN || (process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET)));
}

const CREATE_DRAFT = `mutation($input: DraftOrderInput!) {
  draftOrderCreate(input: $input) {
    draftOrder { id invoiceUrl }
    userErrors { field message }
  }
}`;

// A $0 draft order for this claim. Its invoice URL is a normal Shopify checkout with nothing to pay.
export async function createClaimCheckout(dropId: string, title: string, token: string): Promise<{ draftOrderId: string; checkoutUrl: string }> {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  if (!domain) throw new Error("SHOPIFY_STORE_DOMAIN is not set");
  const input = {
    lineItems: [{ title: `LOOTBOX ${dropId}: ${title}`, sku: dropId, originalUnitPrice: "0.00", quantity: 1, requiresShipping: true, taxable: false }],
    shippingLine: { title: "Free shipping", price: "0.00" },
    customAttributes: [
      { key: CLAIM_ATTRIBUTE, value: token },
      { key: "lootbox_drop", value: dropId },
    ],
    tags: ["lootbox", dropId],
  };
  const res = await fetch(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-shopify-access-token": await adminToken(domain) },
    body: JSON.stringify({ query: CREATE_DRAFT, variables: { input } }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Shopify draft order: HTTP ${res.status}`);
  const body = (await res.json()) as {
    errors?: { message: string }[];
    data?: { draftOrderCreate: { draftOrder: { id: string; invoiceUrl: string } | null; userErrors: { message: string }[] } };
  };
  const out = body.data?.draftOrderCreate;
  const problem = body.errors?.[0]?.message ?? out?.userErrors[0]?.message;
  if (problem || !out?.draftOrder) throw new Error(`Shopify draft order: ${problem ?? "no draft order returned"}`);
  return { draftOrderId: out.draftOrder.id, checkoutUrl: out.draftOrder.invoiceUrl };
}
