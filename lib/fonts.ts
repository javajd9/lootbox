import localFont from "next/font/local";

// Monospace, for real code and data in the docs and proof pages only. Never on the homepage.
// JetBrains Mono (latin, variable weight), kept in the repo so builds never depend on Google Fonts.
export const mono = localFont({ src: "../app/fonts/jetbrains-mono-latin.woff2", weight: "100 800", display: "swap", variable: "--font-mono" });
