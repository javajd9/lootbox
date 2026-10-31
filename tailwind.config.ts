import type { Config } from "tailwindcss";

// Brand: taken from the LOOTBOX logo, banner and reel.
export default {
  content: ["./app/**/*.{ts,tsx,mdx}", "./components/**/*.{ts,tsx}", "./mdx-components.tsx"],
  theme: {
    extend: {
      colors: {
        ink: "#0E0E10", // background
        panel: "#141417", // raised surfaces
        line: "#2A2A30", // borders, the big background hexagon
        cream: { DEFAULT: "#F2EFE8", dim: "#E6E2D8" }, // logo white, light sections
        mute: "#8C8A84", // secondary text
        loot: { DEFAULT: "#E3A82E", dim: "#B98420" }, // the gold check
        ok: "#E3A82E", // a passed check is the brand's gold check
        bad: "#FF5C5C",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      letterSpacing: {
        hud: "0.32em",
      },
      keyframes: {
        glow: {
          "0%, 100%": { filter: "drop-shadow(0 0 18px rgba(227,168,46,0.35))" },
          "50%": { filter: "drop-shadow(0 0 34px rgba(227,168,46,0.6))" },
        },
        ticker: {
          "0%": { transform: "translateY(0)" },
          "100%": { transform: "translateY(-50%)" },
        },
        marquee: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
        pop: {
          "0%": { opacity: "0", transform: "translateY(10px) scale(0.9)" },
          "15%": { opacity: "1", transform: "translateY(0) scale(1)" },
          "100%": { opacity: "0", transform: "translateY(-70px) scale(1)" },
        },
        wave: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-200px)" },
        },
        shake: {
          "0%, 100%": { transform: "translate(0, 0) rotate(0)" },
          "20%": { transform: "translate(-3px, 1px) rotate(-1.5deg)" },
          "40%": { transform: "translate(3px, -1px) rotate(1.5deg)" },
          "60%": { transform: "translate(-2px, 0) rotate(-1deg)" },
          "80%": { transform: "translate(2px, 1px) rotate(1deg)" },
        },
        roll: {
          "0%": { transform: "translateY(0)" },
          "100%": { transform: "translateY(-50%)" },
        },
        flash: {
          "0%": { opacity: "0.9" },
          "100%": { opacity: "0" },
        },
        draw: {
          "0%": { strokeDashoffset: "420" },
          "100%": { strokeDashoffset: "0" },
        },
        "rise-in": {
          "0%": { opacity: "0", transform: "translateY(40px) scale(0.96)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        stamp: {
          "0%": { opacity: "0", transform: "scale(2.2) rotate(-12deg)" },
          "60%": { opacity: "1", transform: "scale(0.92) rotate(-12deg)" },
          "100%": { opacity: "1", transform: "scale(1) rotate(-12deg)" },
        },
        "count-in": {
          "0%": { opacity: "0", transform: "scale(1.8)" },
          "35%": { opacity: "1", transform: "scale(1)" },
          "100%": { opacity: "1", transform: "scale(0.94)" },
        },
        // a fee lands: the liquid lifts and settles
        slosh: {
          "0%": { transform: "translateY(0)" },
          "30%": { transform: "translateY(-14px)" },
          "60%": { transform: "translateY(6px)" },
          "100%": { transform: "translateY(0)" },
        },
        // a coin drops into the box
        coin: {
          "0%": { opacity: "0", transform: "translate(var(--x), -150px) scale(0.6)" },
          "15%": { opacity: "1" },
          "80%": { opacity: "1", transform: "translate(0, 0) scale(1)" },
          "100%": { opacity: "0", transform: "translate(0, 10px) scale(0.4)" },
        },
        // a big buy's label rises and fades
        "float-off": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "15%": { opacity: "1", transform: "translateY(0)" },
          "75%": { opacity: "1", transform: "translateY(-6px)" },
          "100%": { opacity: "0", transform: "translateY(-20px)" },
        },
        // a milestone word lands on the stub
        milestone: {
          "0%": { opacity: "0", transform: "scale(1.4)" },
          "18%": { opacity: "1", transform: "scale(1)" },
          "80%": { opacity: "1", transform: "scale(1)" },
          "100%": { opacity: "0", transform: "scale(0.96)" },
        },
        // final stretch: the number beats
        heartbeat: {
          "0%, 100%": { transform: "scale(1)" },
          "12%": { transform: "scale(1.035)" },
          "24%": { transform: "scale(1)" },
          "36%": { transform: "scale(1.02)" },
        },
        // gold dust drifting up behind the ticket
        dust: {
          "0%": { opacity: "0", transform: "translate(0, 0)" },
          "12%": { opacity: "var(--o)" },
          "85%": { opacity: "var(--o)" },
          "100%": { opacity: "0", transform: "translate(var(--dx), -105vh)" },
        },
        // the stage light breathes
        breathe: {
          "0%, 100%": { opacity: "0.75", transform: "scale(1)" },
          "50%": { opacity: "1", transform: "scale(1.06)" },
        },
        // a whale buy nudges the whole ticket
        nudge: {
          "0%, 100%": { transform: "translate(0, 0)" },
          "25%": { transform: "translate(-4px, 2px)" },
          "50%": { transform: "translate(4px, -2px)" },
          "75%": { transform: "translate(-2px, 1px)" },
        },
      },
      animation: {
        glow: "glow 4s ease-in-out infinite",
        ticker: "ticker 18s linear infinite",
        marquee: "marquee 45s linear infinite",
        pop: "pop 2.6s ease-out forwards",
        wave: "wave 3.2s linear infinite",
        shake: "shake 0.35s linear infinite",
        roll: "roll 0.45s linear infinite",
        flash: "flash 1.4s ease-out forwards",
        draw: "draw 0.9s cubic-bezier(.6,0,.2,1) forwards",
        "rise-in": "rise-in 0.8s cubic-bezier(.2,.8,.2,1) both",
        stamp: "stamp 0.5s cubic-bezier(.2,.8,.2,1) both",
        "count-in": "count-in 1s ease-out both",
        slosh: "slosh 0.7s cubic-bezier(.22,1,.36,1)",
        coin: "coin 0.85s cubic-bezier(.55,.06,.68,.19) forwards",
        "float-off": "float-off 2.4s cubic-bezier(.22,1,.36,1) forwards",
        milestone: "milestone 2.8s cubic-bezier(.16,1,.3,1) forwards",
        heartbeat: "heartbeat 1.1s ease-in-out infinite",
        nudge: "nudge 0.4s ease-in-out",
        dust: "dust linear infinite",
        breathe: "breathe 7s ease-in-out infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
