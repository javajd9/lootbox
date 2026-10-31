import { JetBrains_Mono } from "next/font/google";

// Monospace, for real code and data in the docs and proof pages only. Never on the homepage.
export const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });
