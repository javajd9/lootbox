// The drop rules, in one place. The code and the docs both read these, so the docs can't
// drift from what the system actually does.
import { TOKENS_PER_TICKET } from "@/lib/draws/tickets";
import { CLAIM_DAYS } from "@/lib/live/types";
import { NONCE_TTL_MS } from "@/lib/claims/claims";

export const RULES = {
  tokensPerTicket: Number(TOKENS_PER_TICKET),
  snapshotMinHours: 2,
  snapshotMaxHours: 8,
  drawPauseMinutes: 2, // between the pool filling and the draw
  claimDays: CLAIM_DAYS,
  claimSigningMinutes: NONCE_TTL_MS / 60_000,
  firstDropGoalUsd: 2000,
};

// The drop rules in plain English, quoted word for word by the docs (<Rule rule="…" />).
export const RULE_TEXT = {
  snapshots: `While a pool fills, holder snapshots are taken at random, unannounced times, one every ${RULES.snapshotMinHours}–${RULES.snapshotMaxHours} hours, plus a final one the moment the pool fills. The ticket list is locked right then, and the draw starts ${RULES.drawPauseMinutes} minutes later.`,
  unclaimed: `If the winner doesn't claim within ${CLAIM_DAYS} days, the prize is redrawn from the same locked ticket list, using new randomness.`,
  leftoverFees: "If the pool goes past its goal before the draw lands, the extra rolls into the next drop's pool.",
  priceChange:
    "If a product's price rises above its cap, the order isn't placed. The fix (a top-up, or an equal-or-better substitute) is announced publicly before anything is bought.",
  shipping: "At launch, prizes ship to addresses in the United States. Options for winners elsewhere are still being worked out.",
};
