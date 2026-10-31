export const usd = (n: number) => `$${Math.floor(n).toLocaleString("en-US")}`;
export const dropNo = (n: number) => String(n).padStart(3, "0");
export const shortWallet = (w: string) => `${w.slice(0, 4)}…${w.slice(-4)}`;
