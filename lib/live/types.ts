// Shared by the server (mock data) and the client (live stage + proof ledger).

// Every drop walks through these steps; each one is backed by a proof.
export const PROOF_STEPS = [
  ["funded", "Funded"],
  ["drawn", "Drawn"],
  ["claimed", "Claimed"],
  ["paid", "Paid"],
  ["ordered", "Ordered"],
  ["shipped", "Shipped"],
  ["delivered", "Delivered"],
  ["received", "Received"],
] as const;

export type StepKey = (typeof PROOF_STEPS)[number][0];

// A drop that has been drawn: its winner and how far its proof chain has got.
export interface PastDrop {
  id: string;
  number: number;
  title: string;
  valueUsd: number;
  wallet: string;
  ticket: number;
  totalTickets: number;
  walletTickets: number; // tickets the winning wallet held
  done: Partial<Record<StepKey, string>>; // step → ISO time it was proven
  sample?: boolean;
  code?: string; // display code instead of the padded number (sample data)
  proofId?: string; // proof page to link, when it differs from id
}

// Winners have this long to claim before the prize is redrawn.
export const CLAIM_DAYS = 14;

export function lastStep(d: PastDrop): StepKey | undefined {
  return [...PROOF_STEPS].reverse().find(([k]) => d.done[k])?.[0];
}

export function nextStep(d: PastDrop): StepKey | undefined {
  return PROOF_STEPS.find(([k]) => !d.done[k])?.[0];
}

// Drawn but not yet signed for by the winner.
export const isOnTheWay = (d: PastDrop) => !!d.done.drawn && !d.done.received;

export function dropCode(d: Pick<PastDrop, "number" | "code">) {
  return d.code ?? String(d.number).padStart(3, "0");
}

// One plain-English line for where a prize is right now.
export function statusText(d: PastDrop, now = Date.now()): string {
  switch (lastStep(d)) {
    case "drawn": {
      const left = Math.max(0, Math.ceil((new Date(d.done.drawn!).getTime() + CLAIM_DAYS * 864e5 - now) / 864e5));
      return `Claim open · ${left}d left`;
    }
    case "claimed":
      return "Claimed · buying now";
    case "paid":
      return "Paid · placing order";
    case "ordered":
      return "Ordered · packing";
    case "shipped":
      return "Shipped · in transit";
    case "delivered":
      return "Delivered · awaiting signature";
    case "received":
      return "Received";
    default:
      return "Drawing";
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// UTC so server and browser render the same text.
export function fmtDay(iso: string) {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
