// "In the box": the current drop's prizes in gold hexagons, at the bottom of the homepage.
import { HexFrame } from "@/components/brand/HexFrame";
import { HudSection } from "@/components/brand/Hud";
import type { Drop } from "@/lib/data/types";

export function InTheBox({ drop }: { drop: Drop }) {
  return (
    <HudSection id="drop" index="02" label="In the box">
      <div className="text-center">
        <p className="eyebrow">{drop.title} — {drop.items.length} items</p>
        <h2 className="display mt-4 text-5xl sm:text-7xl">In the box</h2>
      </div>
      <ul className="mx-auto mt-16 grid max-w-4xl grid-cols-1 gap-12 sm:grid-cols-3">
        {drop.items.map((item, i) => (
          <li key={item.productId} className="mx-auto w-48 text-center sm:w-full">
            <HexFrame>
              {item.image && (
                // eslint-disable-next-line @next/next/no-img-element -- small static cutouts, no optimizer needed
                <img
                  src={item.image}
                  alt={item.name}
                  loading="lazy"
                  className="h-[70%] w-[70%] object-contain drop-shadow-[0_12px_28px_rgba(0,0,0,0.6)]"
                />
              )}
            </HexFrame>
            <p className="hud mt-6 text-cream">
              <span className="text-loot">0{i + 1}</span>&nbsp;&nbsp;{item.name}
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-16 text-center text-sm text-mute">
        Exact products are locked before launch and the order is checked against them automatically.
      </p>
    </HudSection>
  );
}
