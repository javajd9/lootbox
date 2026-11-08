// What each prize is made of. The engine buys exactly these (lib/engine/drops, lib/orders/price) and
// the homepage shows exactly these, so what's shown is what's bought. No heavy imports: the homepage
// reads this too.

// One thing the prize is made of, as it's bought. `maxPriceCents` is the most the engine will ever
// pay for one, all in (its price plus its share of tax and shipping): the order's spending cap is
// the sum of these, and Zinc refuses any order that would cost more.
export interface PrizeItem {
  name: string;
  asin?: string; // Amazon product ID; bought from https://www.amazon.com/dp/<asin>
  url?: string; // or any product page Zinc can buy from
  quantity: number;
  maxPriceCents: number; // 0 until it's set
  image?: string; // transparent cutout in /public/prizes (made with scripts/cutout.mjs)
}

// The first mainnet drop. Each ASIN and cap is filled in before it opens. Until then the order can't be
// placed (orderCap refuses an item with no ASIN or no cap) and the homepage says the products
// aren't locked yet.
export const GTA_VI_BUNDLE: PrizeItem[] = [
  // Caps leave about 10% over list for the winner's sales tax: $599.99, $749 and $79.99 list, $1,428.98 in all.
  { name: "PS5 Digital Edition", quantity: 1, maxPriceCents: 66_500, image: "/prizes/ps5.webp" },
  { name: "ASUS ROG Swift OLED PG27AQDM", quantity: 1, maxPriceCents: 83_000, image: "/prizes/oled-monitor.webp" },
  { name: "GTA VI Standard Edition", quantity: 1, maxPriceCents: 9_000, image: "/prizes/gta6.webp" },
];
