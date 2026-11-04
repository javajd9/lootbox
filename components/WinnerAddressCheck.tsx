"use client";

// Lets the winner confirm the prize was shipped to THEIR address, without the address ever
// leaving their browser. Everyone else just sees a fingerprint they can't reverse.
import { useState } from "react";
import { checkCommitment } from "@/lib/proofs/commitment";

const FIELDS = [
  ["name", "Full name"],
  ["line1", "Street address"],
  ["line2", "Apt / unit (optional)"],
  ["city", "City"],
  ["state", "State"],
  ["zip", "ZIP"],
] as const;

type Form = Record<(typeof FIELDS)[number][0], string> & { salt: string };

export function WinnerAddressCheck({ commitment }: { commitment: string }) {
  const [form, setForm] = useState<Form>({ name: "", line1: "", line2: "", city: "", state: "", zip: "", salt: "" });
  const [result, setResult] = useState<boolean | null>(null);

  const check = () => {
    const { salt, ...address } = form;
    setResult(checkCommitment(address, salt.trim(), commitment));
  };

  return (
    <div className="card">
      <h2 className="display text-2xl">Winner: check it went to your address</h2>
      <p className="mt-2 text-sm text-cream/60">
        Enter your shipping address and the secret code from your claim page. This runs only in your browser; nothing is sent anywhere.
      </p>
      <p className="hud mt-3 break-all">Published fingerprint · {commitment}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {FIELDS.map(([key, label]) => (
          <input key={key} className="input" placeholder={label} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
        ))}
        <input className="input sm:col-span-2 font-mono" placeholder="Secret code (64 characters)" value={form.salt} onChange={(e) => setForm({ ...form, salt: e.target.value })} />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button onClick={check} className="btn-loot">Check my address</button>
        {result !== null && (
          <span className={result ? "text-ok" : "text-bad"}>
            {result ? "✓ Match: the prize was shipped to this address." : "✕ No match. Check for typos and the secret code."}
          </span>
        )}
      </div>
    </div>
  );
}
