"use client";

// One live feed for the whole homepage: the stage, the ticker and the proof ledger all read it,
// so a draw on the stage shows up in the ledger at the same moment.
import { createContext, useContext } from "react";
import { useLiveDrop, type LiveDrop, type StageDrop } from "@/lib/live/useLiveDrop";
import type { PastDrop } from "@/lib/live/types";

type Live = ReturnType<typeof useLiveDrop>;
const LiveContext = createContext<Live | null>(null);

export function LiveProvider({
  initial,
  upNext,
  demoHistory,
  children,
}: {
  initial: LiveDrop;
  upNext: StageDrop[];
  demoHistory: PastDrop[];
  children: React.ReactNode;
}) {
  const live = useLiveDrop(initial, upNext, demoHistory);
  return <LiveContext.Provider value={live}>{children}</LiveContext.Provider>;
}

export function useLive(): Live {
  const live = useContext(LiveContext);
  if (!live) throw new Error("useLive must be used inside <LiveProvider>");
  return live;
}
