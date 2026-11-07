import { describe, expect, it } from "vitest";
import { parseFingerprint } from "../lib/chain/memo";
import type { DropConfig, PrizeItem } from "../lib/engine/drops";
import { apply, decide } from "../lib/engine/decide";
import { memoryStore, tick } from "../lib/engine/run";
import type { DropRecord, Effects, EngineState } from "../lib/engine/types";
import { orderPackage, orderStep, revealedOf, zincAddress, type OrderDeps, type OrderRow } from "../lib/orders/order";
import { orderCap, overCap } from "../lib/orders/price";
import { orderFacts, revealedSpans, winnerPII, zkFetchOptions } from "../lib/orders/redact";
import { ZincError, zincClient, zincSettings, type ZincOrder, type ZincOrderRequest, type ZincStatus } from "../lib/orders/zinc";
import type { ShippingAddress } from "../lib/proofs/commitment";
import { findPII } from "../lib/proofs/pii-guard";

const NOW = new Date("2026-11-20T12:00:00Z");
const HOUR = 3_600_000;
const WINNER = "AzUgD27BWinnerWallet11111111111111111111111";
const TEST_URL = "https://zinc.com/shop/products/test-success";

const ADDRESS: ShippingAddress = {
  name: "Jordan Q Testperson",
  line1: "4821 Willowbrook Lane",
  line2: "Apt 7",
  city: "Spokane",
  state: "WA",
  zip: "99201",
  phone: "509-555-0143",
};

const item = (extra: Partial<PrizeItem> = {}): PrizeItem => ({ name: "Test item", url: TEST_URL, quantity: 1, maxPriceCents: 500, ...extra });

const claimed = (extra: Partial<DropRecord> = {}): DropRecord => ({
  id: "DROP-003",
  goalCents: 1_000,
  stage: "claiming",
  snapshotsTaken: 3,
  snapshotDue: [],
  round: 1,
  winner: WINNER,
  ticket: 39_535,
  claimDeadline: new Date(NOW.getTime() + 14 * 24 * HOUR).toISOString(),
  claimedAt: NOW.toISOString(),
  ...extra,
});

// Zinc's order object, shaped from its v2 docs (GET /orders/{id}), shipping address and all.
function zincOrder(id: string, req: ZincOrderRequest, status: ZincStatus): ZincOrder & Record<string, unknown> {
  const placed = status === "order_placed";
  return {
    id,
    status,
    max_price: req.max_price,
    attempts: 1,
    items: req.products.map((p, i) => ({ id: `item-${i}`, url: p.url, quantity: p.quantity, status: placed ? "ordered" : "pending" })),
    shipping_address: req.shipping_address,
    metadata: req.metadata ?? {},
    po_number: req.po_number ?? null,
    merchant_order_ids: placed ? ["TEST-112-4419920-7781234"] : [],
    tracking_numbers: placed
      ? [{ id: "t1", carrier: "UPS", tracking_number: "1Z999AA10123456784", status: "pending", checkpoints: [{ checkpoint_time: "2026-11-20T12:00:00Z", status: "pending", message: "Label created", city: req.shipping_address.city, zip: req.shipping_address.postal_code }] }]
      : [],
    customer_notifications: { email: "jordan.testperson@example.com" },
    job_result: placed
      ? { success: true, error: null, error_type: null, price_components: { subtotal: 399, tax: 33, shipping: 0, total: 432, currency: "USD", cart_items: [{ name: "Test Product", product_id: "test-success", quantity: 1, unit_price: 399, line_total: 399 }] } }
      : null,
    created_at: "2026-11-20T12:00:00Z",
    updated_at: "2026-11-20T12:05:00Z",
  };
}

// A fake Zinc that keeps its orders, refuses a second order for the same key (as Zinc does), and
// can be told to move an order on.
function fakeZinc() {
  const orders = new Map<string, { req: ZincOrderRequest; status: ZincStatus }>();
  const byKey = new Map<string, string>();
  const z = {
    orders,
    creates: 0,
    async createOrder(req: ZincOrderRequest) {
      z.creates++;
      const existing = byKey.get(req.idempotency_key);
      if (existing) throw new ZincError(409, "already_exists", "Order with idempotency key already exists", { resource: "Order", identifier: existing });
      if (req.max_price <= 0) throw new ZincError(422, "validation_error", "max_price");
      const id = `ord-${orders.size + 1}-0000-4000-8000-000000000000`.slice(0, 36);
      orders.set(id, { req, status: "pending" });
      byKey.set(req.idempotency_key, id);
      return zincOrder(id, req, "pending");
    },
    async getOrder(id: string) {
      const o = orders.get(id);
      if (!o) throw new ZincError(404, "not_found", "no such order");
      return zincOrder(id, o.req, o.status);
    },
    set(status: ZincStatus) {
      for (const o of orders.values()) o.status = status;
    },
  };
  return z;
}

// A fake zkFetch: does what Reclaim's does with our options, on the fake Zinc's full response.
function fakeProve(z: ReturnType<typeof fakeZinc>, auth: string) {
  return async (order: ZincOrder) => {
    const full = JSON.stringify(await z.getOrder(order.id));
    const { publicOptions, privateOptions } = zkFetchOptions(order, auth);
    const facts = privateOptions.responseRedactions.map((r, i) => ({ name: String(i), regex: r.regex }));
    const { values } = revealedSpans(full, facts);
    return {
      claimData: {
        provider: "http",
        parameters: JSON.stringify({ method: publicOptions.method, url: `https://api.zinc.com/orders/${order.id}`, responseMatches: privateOptions.responseMatches, responseRedactions: privateOptions.responseRedactions }),
        context: JSON.stringify({ extractedParameters: values }),
        owner: "0xowner",
        timestampS: 1_795_000_000,
        epoch: 1,
      },
      identifier: "0xid",
      signatures: ["0xsig"],
      extractedParameterValues: values,
      witnesses: [{ id: "0xw", url: "wss://attestor.reclaimprotocol.org/ws" }],
    };
  };
}

function fakeDeps(over: Partial<OrderDeps> = {}) {
  const z = fakeZinc();
  const rows = new Map<string, OrderRow>();
  const memos: string[] = [];
  const proofs: { revealed: Record<string, unknown>; proof: unknown; hash: string }[] = [];
  let keys = 0;
  const config: DropConfig = { id: "DROP-003", number: 3, title: "Test drop", goalCents: 1_000, prize: [item()] };
  const deps: OrderDeps = {
    config: (id) => (id === config.id ? config : undefined),
    winner: async () => ({ claimId: "claim-1", address: ADDRESS, email: "jordan.testperson@example.com" }),
    load: async (id) => (rows.has(id) ? { ...rows.get(id)! } : null),
    create: async (row) => {
      if (!rows.has(row.drop_id)) rows.set(row.drop_id, { ...row });
      return { ...rows.get(row.drop_id)! };
    },
    update: async (id, patch) => void rows.set(id, { ...rows.get(id)!, ...patch }),
    zinc: z,
    prove: fakeProve(z, "Bearer zn_test_secretkey"),
    saveProof: async (d, revealed, proof) => {
      const { hash } = orderPackage(d, revealed, proof, NOW.toISOString());
      proofs.push({ revealed, proof, hash });
      return { hash };
    },
    postMemo: async (text) => (memos.push(text), `memo-tx-${memos.length}`),
    newKey: () => `key-${++keys}`,
    now: () => NOW,
    ...over,
  };
  return { deps, z, rows, memos, proofs, config };
}

describe("orders: the price cap", () => {
  it("caps the order at the sum of its items' caps", () => {
    const cap = orderCap([item({ maxPriceCents: 300, quantity: 2 }), item({ asin: "B07JGBW826", url: undefined, maxPriceCents: 250 })], 1_000);
    expect(cap).toMatchObject({ ok: true, maxPriceCents: 850 });
    if (cap.ok) expect(cap.lines[1].url).toBe("https://www.amazon.com/dp/B07JGBW826");
  });

  it("never lets the caps add up to more than the drop's pool", () => {
    expect(orderCap([item({ maxPriceCents: 600 }), item({ maxPriceCents: 500 })], 1_000)).toMatchObject({ ok: false });
    expect(orderCap([item({ maxPriceCents: 1_000 })], 1_000)).toMatchObject({ ok: true, maxPriceCents: 1_000 });
  });

  it("refuses items with no cap, a bad quantity, or no product", () => {
    expect(orderCap(undefined, 1_000).ok).toBe(false);
    expect(orderCap([], 1_000).ok).toBe(false);
    expect(orderCap([item({ maxPriceCents: 0 })], 1_000).ok).toBe(false);
    expect(orderCap([item({ maxPriceCents: 4.5 })], 1_000).ok).toBe(false);
    expect(orderCap([item({ quantity: 0 })], 1_000).ok).toBe(false);
    expect(orderCap([item({ url: undefined, asin: "not-an-asin" })], 1_000).ok).toBe(false);
    expect(orderCap([item({ url: "http://insecure.example/x" })], 1_000).ok).toBe(false);
  });

  it("sends the cap to Zinc as max_price, and holds if Zinc's total is somehow over it", async () => {
    const f = fakeDeps();
    await orderStep(claimed(), f.deps);
    expect([...f.z.orders.values()][0].req.max_price).toBe(500);
    expect(overCap(501, 500)).toBe(true);
    expect(overCap(500, 500)).toBe(false);
    expect(overCap(null, 500)).toBe(false);
  });

  it("holds without asking Zinc when the drop has no prize items", async () => {
    const f = fakeDeps();
    f.config.prize = undefined;
    expect(await orderStep(claimed(), f.deps)).toMatchObject({ ok: false });
    expect(f.z.creates).toBe(0);
    expect(f.rows.size).toBe(0);
  });
});

describe("orders: never two orders for one drop", () => {
  it("saves the order record before asking Zinc, then only checks its status", async () => {
    const f = fakeDeps();
    expect(await orderStep(claimed(), f.deps)).toEqual({ waiting: "Zinc is still placing the order (pending)" });
    expect(await orderStep(claimed(), f.deps)).toMatchObject({ waiting: expect.any(String) });
    expect(await orderStep(claimed({ round: 2 }), f.deps)).toMatchObject({ waiting: expect.any(String) }); // even after a redraw
    expect(f.z.creates).toBe(1);
    expect(f.z.orders.size).toBe(1);
    expect(f.rows.get("DROP-003")).toMatchObject({ idempotency_key: "key-1", zinc_status: "pending", claim_id: "claim-1" });
  });

  it("re-sends the same key after a crash, and Zinc's refusal leads back to the one order", async () => {
    const f = fakeDeps();
    let crash = true;
    const update = f.deps.update;
    f.deps.update = async (id, patch) => {
      if (crash && patch.zinc_request_id) {
        crash = false;
        throw new Error("database went away"); // Zinc has the order; we never saved its id
      }
      return update(id, patch);
    };
    await expect(orderStep(claimed(), f.deps)).rejects.toThrow("database went away");
    expect(f.rows.get("DROP-003")!.zinc_request_id).toBeNull();
    await orderStep(claimed(), f.deps);
    expect(f.z.creates).toBe(2); // asked twice, with the same key...
    expect(f.z.orders.size).toBe(1); // ...and still one order
    expect(f.rows.get("DROP-003")!.zinc_request_id).toBe([...f.z.orders.keys()][0]);
  });

  it("never re-orders a failed order; a human has to look", async () => {
    const f = fakeDeps();
    await orderStep(claimed(), f.deps);
    f.z.set("order_failed");
    expect(await orderStep(claimed(), f.deps)).toMatchObject({ ok: false });
    expect(await orderStep(claimed(), f.deps)).toMatchObject({ ok: false, reason: expect.stringContaining("failed") });
    expect(f.z.creates).toBe(1);
  });

  it("keeps only Zinc's error code when it refuses an order (messages can echo the address)", async () => {
    const f = fakeDeps();
    f.z.createOrder = async () => {
      throw new ZincError(422, "invalid_shipping_address", `Address ${ADDRESS.line1}, ${ADDRESS.city} failed validation`);
    };
    const r = await orderStep(claimed(), f.deps);
    expect(r).toEqual({ ok: false, reason: "Zinc refused the order (invalid_shipping_address)" });
    expect(f.rows.get("DROP-003")).toMatchObject({ status: "failed", error: "invalid_shipping_address" });
    expect(findPII(JSON.stringify([r, f.rows.get("DROP-003")]), winnerPII(ADDRESS))).toEqual([]);
  });

  it("tries again next tick when Zinc is down, without marking the order failed", async () => {
    const f = fakeDeps();
    f.z.createOrder = async () => {
      throw new ZincError(503, "service_unavailable", "try later");
    };
    await expect(orderStep(claimed(), f.deps)).rejects.toThrow("service_unavailable");
    expect(f.rows.get("DROP-003")!.status).toBe("pending");
  });
});

describe("orders: nothing personal in a proof", () => {
  const req: ZincOrderRequest = {
    products: [{ url: TEST_URL, quantity: 1 }],
    max_price: 500,
    shipping_address: zincAddress(ADDRESS).ok ? (zincAddress(ADDRESS) as any).value : null,
    idempotency_key: "k",
    metadata: { lootbox_drop: "DROP-003" },
    po_number: "DROP-003",
  };
  const order = zincOrder("3f1c9a52-8d2e-4b7a-9c1f-2a6e5d4b8f10", req, "order_placed");
  const full = JSON.stringify(order, null, 2);

  it("the full Zinc response does have the winner's details (so the check below means something)", () => {
    expect(findPII(full, winnerPII(ADDRESS, "jordan.testperson@example.com")).sort()).toEqual(["city", "email", "line1", "line2", "name", "phone", "zip"]);
  });

  it("reveals only the order's facts, with none of the winner's details", () => {
    const { spans, values } = revealedSpans(full, orderFacts(order));
    expect(values).toEqual({ orderId: order.id, status: "order_placed", maxPrice: "500", total: "432", merchantOrderIds: expect.stringContaining('"TEST-112-4419920-7781234"') });
    expect(spans).toContain(`"url": "${TEST_URL}"`);
    expect(findPII(JSON.stringify(spans), winnerPII(ADDRESS, "jordan.testperson@example.com"))).toEqual([]);
  });

  it("asks zkFetch to reveal only those facts, with the API key in a private header", () => {
    const { publicOptions, privateOptions } = zkFetchOptions(order, "Bearer zn_test_secretkey");
    expect(JSON.stringify(publicOptions)).not.toContain("zn_test_");
    expect(privateOptions.headers.Authorization).toBe("Bearer zn_test_secretkey");
    expect(privateOptions.responseRedactions.length).toBe(orderFacts(order).length);
    for (const r of privateOptions.responseRedactions) expect(r.regex).not.toMatch(/shipping|address|phone|tracking|email|metadata|name/);
  });

  it("a finished (mock) proof carries the facts and nothing personal or secret", async () => {
    const f = fakeDeps();
    await orderStep(claimed(), f.deps);
    f.z.set("order_placed");
    expect(await orderStep(claimed(), f.deps)).toEqual({ ok: true });
    const { proof, revealed } = f.proofs[0];
    const text = JSON.stringify(f.proofs[0]);
    expect(findPII(text, winnerPII(ADDRESS, "jordan.testperson@example.com"))).toEqual([]);
    expect(text).not.toContain("zn_test_secretkey");
    expect(revealed).toMatchObject({ status: "order_placed", maxPrice: "500", total: "432", products: [TEST_URL] });
    expect(revealedOf(proof)).toEqual(revealed);
  });

  it("throws a proof away, and holds the drop, if any personal detail turns up in it", async () => {
    const f = fakeDeps();
    const prove = f.deps.prove;
    f.deps.prove = async (o) => ({ ...((await prove(o)) as object), extractedParameterValues: { leaked: ADDRESS.line1 } });
    await orderStep(claimed(), f.deps);
    f.z.set("order_placed");
    const r = await orderStep(claimed(), f.deps);
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining("line1") });
    expect(f.proofs).toHaveLength(0);
    expect(f.memos).toHaveLength(0);
  });

  it("splits the name for Zinc and needs a phone number", () => {
    expect(zincAddress(ADDRESS)).toMatchObject({ ok: true, value: { first_name: "Jordan Q", last_name: "Testperson", postal_code: "99201", phone_number: "509-555-0143", country: "US" } });
    expect(zincAddress({ ...ADDRESS, phone: undefined }).ok).toBe(false);
    expect(zincAddress({ ...ADDRESS, phone: undefined }, "+1 800 555 0100")).toMatchObject({ ok: true, value: { phone_number: "+1 800 555 0100" } });
  });
});

describe("orders: Zinc's API", () => {
  it("uses a Bearer key against api.zinc.com by default", async () => {
    const s = zincSettings({ ZINC_API_KEY: "zn_test_abc" });
    expect(s).toMatchObject({ baseUrl: "https://api.zinc.com", authHeader: "Bearer zn_test_abc" });
    const seen: { url: string; init: RequestInit }[] = [];
    const client = zincClient(s, (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ code: "already_exists", message: "exists", details: { identifier: "ord-1" } }), { status: 409 });
    }) as any);
    const err = await client.createOrder({ products: [], max_price: 1, shipping_address: {} as any, idempotency_key: "k" }).catch((e) => e);
    expect(err).toBeInstanceOf(ZincError);
    expect(err).toMatchObject({ status: 409, code: "already_exists", details: { identifier: "ord-1" } });
    expect(seen[0]).toMatchObject({ url: "https://api.zinc.com/orders", init: { method: "POST", headers: { Authorization: "Bearer zn_test_abc" } } });
  });
});

describe("orders: in the engine", () => {
  it("waiting leaves the drop as it is; done moves it to fulfilling; a refusal holds it", () => {
    const d = claimed();
    expect(apply(d, { type: "placeOrder" }, { waiting: "still placing" }, NOW, Math.random)).toBe(d);
    expect(apply(d, { type: "placeOrder" }, { ok: true }, NOW, Math.random)).toMatchObject({ stage: "fulfilling", orderedAt: NOW.toISOString() });
    expect(apply(d, { type: "placeOrder" }, { ok: false, reason: "no" }, NOW, Math.random)).toMatchObject({ stage: "claiming", hold: "no" });
  });

  it("alerts once if the order still isn't placed a day after the claim", () => {
    const state: EngineState = { drops: [claimed()], treasuryCents: 0, sentAlerts: ["no-next-drop:DROP-003"] };
    expect(decide(state, new Date(NOW.getTime() + HOUR)).map((s) => s.effect.type)).toEqual(["placeOrder"]);
    const late = decide(state, new Date(NOW.getTime() + 25 * HOUR));
    expect(late.map((s) => s.effect.type)).toContain("alert");
    expect(decide({ ...state, sentAlerts: [...state.sentAlerts, "slow-order:DROP-003"] },new Date(NOW.getTime() + 25 * HOUR)).map((s) => s.effect.type)).not.toContain("alert");
  });

  it("a mocked run: claimed -> ordered -> proof saved -> memo posted -> fulfilling", async () => {
    const f = fakeDeps();
    const store = memoryStore({ drops: [claimed()], treasuryCents: 0, sentAlerts: [] });
    const effects = {
      readTreasury: async () => 0,
      placeOrder: (d: DropRecord) => orderStep(d, f.deps),
      alert: async () => {},
    } as unknown as Effects;

    const first = await tick(store, effects, new Date(NOW.getTime() + 60_000));
    expect(first!.errors).toEqual([]);
    expect(store.peek().drops[0]).toMatchObject({ stage: "claiming" });
    expect(store.peek().drops[0].hold).toBeUndefined();
    expect(f.z.orders.size).toBe(1);

    f.z.set("in_progress");
    await tick(store, effects, new Date(NOW.getTime() + 2 * 60_000));
    expect(store.peek().drops[0].stage).toBe("claiming");

    f.z.set("order_placed");
    await tick(store, effects, new Date(NOW.getTime() + 3 * 60_000));
    const d = store.peek().drops[0];
    expect(d).toMatchObject({ stage: "fulfilling", orderedAt: new Date(NOW.getTime() + 3 * 60_000).toISOString() });
    expect(f.z.creates).toBe(1);
    expect(f.proofs).toHaveLength(1);
    expect(f.memos).toEqual([`LOOTBOX|v1|DROP-003|ordered|${f.proofs[0].hash}`]);
    expect(parseFingerprint(f.memos[0])).toEqual({ dropId: "DROP-003", kind: "ordered", values: [f.proofs[0].hash] });
    expect(f.rows.get("DROP-003")).toMatchObject({ status: "placed", total_cents: 432, proof_hash: f.proofs[0].hash, memo_tx: "memo-tx-1" });

    // Later ticks leave it alone: fulfilling waits for delivery.
    await tick(store, effects, new Date(NOW.getTime() + 4 * 60_000));
    expect(f.z.creates).toBe(1);
    expect(f.memos).toHaveLength(1);
  });

  it("picks up where it left off if the memo post failed", async () => {
    const f = fakeDeps();
    await orderStep(claimed(), f.deps);
    f.z.set("order_placed");
    const post = f.deps.postMemo;
    f.deps.postMemo = async () => {
      throw new Error("RPC down");
    };
    await expect(orderStep(claimed(), f.deps)).rejects.toThrow("RPC down");
    f.deps.postMemo = post;
    expect(await orderStep(claimed(), f.deps)).toEqual({ ok: true });
    expect(f.proofs).toHaveLength(1); // the proof wasn't made twice
    expect(f.memos).toHaveLength(1);
  });
});
