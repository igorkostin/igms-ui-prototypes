// Refold-style color rails — two vertical stacks of horizontal bars at the
// page edges. Each bar shares the same horizontal gradient (brand color on
// the outer edge → soft accent → white toward the center). What animates is
// the *width* of each bar: they breathe in/out independently with staggered
// phase, so the inner silhouette ripples like a sound-level meter.
//
// Usage:
//   <div id="rail-left"  class="rail rail-left"></div>
//   <div id="rail-right" class="rail rail-right"></div>
//   <script type="module">
//     import { ColorRails } from "./bars.js";
//     new ColorRails([leftEl, rightEl], options);
//   </script>
//
// Options:
//   barCount       : number   bars per rail (default 48)
//   barHeight      : number   px (default 16)
//   minWidth       : number   percent — min bar extension (default 25)
//   maxWidth       : number   percent — max bar extension (default 95)
//   animSeconds    : number   breathe cycle (default 5.0)
//   staggerSeconds : number   delay between adjacent bars (default 0.10)
//   palette        : string   "iGMS" | "warm-mono" | "cool" (default "iGMS")
//   seed           : number   PRNG seed for width jitter (default 1)

const PALETTES = {
  // brand yellow → mint accent → white (transparent)
  iGMS:      { brand: "#FFD729", accent: "#B6E5C3" },
  // brand yellow → soft peach → white
  "warm-mono": { brand: "#FFD729", accent: "#FFD0A8" },
  // cool — using blue brand + cyan accent (for A/B comparison)
  cool:      { brand: "#3B82F6", accent: "#9EE9FF" },
};

const DEFAULTS = {
  barCount: 48,
  barHeight: 16,
  minWidth: 25,
  maxWidth: 95,
  animSeconds: 5.0,
  staggerSeconds: 0.10,
  palette: "iGMS",
  seed: 1,
};

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export class ColorRails {
  constructor(railEls, options = {}) {
    this.rails = railEls;
    this.options = { ...DEFAULTS, ...options };
    this._render();
  }

  _render() {
    const o = this.options;
    const pal = PALETTES[o.palette] || PALETTES.iGMS;
    const rand = mulberry32(o.seed);

    // Apply gradient colors and bar height via CSS variables on each rail.
    for (const rail of this.rails) {
      rail.style.setProperty("--brand", pal.brand);
      rail.style.setProperty("--accent", pal.accent);
      rail.style.setProperty("--bar-h", `${o.barHeight}px`);
      rail.innerHTML = "";

      for (let i = 0; i < o.barCount; i++) {
        // Each bar gets two width "anchor" values (min/max) and animates
        // between them. We add some per-bar jitter so the visual rhythm
        // isn't a perfect sine wave across the rail.
        const jitter1 = (rand() - 0.5) * 12;   // ±6%
        const jitter2 = (rand() - 0.5) * 12;
        const wMin = Math.max(5,  o.minWidth + jitter1);
        const wMax = Math.min(100, o.maxWidth + jitter2);
        const delay = (i * o.staggerSeconds).toFixed(2);

        const bar = document.createElement("div");
        bar.className = "bar";
        bar.style.setProperty("--w-min", `${wMin.toFixed(1)}%`);
        bar.style.setProperty("--w-max", `${wMax.toFixed(1)}%`);
        bar.style.animationDuration = `${o.animSeconds}s`;
        bar.style.animationDelay = `-${delay}s`;       // negative → start mid-cycle
        rail.appendChild(bar);
      }
    }
  }

  update(partial) {
    this.options = { ...this.options, ...partial };
    this._render();
  }

  destroy() {
    for (const r of this.rails) r.innerHTML = "";
  }
}

export const RAIL_PALETTES = PALETTES;
