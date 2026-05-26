// Animated color-bar rails on both sides of the hero.
//
// Each rail is a stack of N thin horizontal bars. Each bar has a fade
// gradient from transparent (rail-inner edge) to a solid hue (rail-outer
// edge). Colors cycle through the palette top-to-bottom, animation
// shifts the gradient position along each bar with a per-bar phase
// offset — creates a "pulse traveling through the stack" feel.
//
// Usage:
//   <div id="rail-left"  class="rail rail-left"></div>
//   <div id="rail-right" class="rail rail-right"></div>
//   <script type="module">
//     import { ColorRails } from "./bars.js";
//     const rails = new ColorRails([leftEl, rightEl], options);
//     rails.update({ palette: "warm" });
//   </script>
//
// Options:
//   barCount       : number   bars per rail (default 28)
//   palette        : string   "iGMS" | "warm" | "cool" | "rainbow" (default "iGMS")
//   animSeconds    : number   single-pulse duration (default 6)
//   staggerSeconds : number   delay between adjacent bars (default 0.25)

const PALETTES = {
  // iGMS — brand yellow → mint → cyan → blue → soft purple → pink. Stays
  // friendly and bright but anchored on the brand yellow.
  iGMS: [
    "#FFD729",   // brand yellow
    "#E8E66B",
    "#B6E5C3",
    "#9EE9FF",
    "#6B9EFF",
    "#B59EFF",
    "#FFB6D8",
  ],
  warm: [
    "#FFD729", "#FFC07A", "#FFA8B5", "#FF9EC7", "#F4C12A",
  ],
  cool: [
    "#9EE9FF", "#6B9EFF", "#B59EFF", "#A6F0D6", "#7FE0E0",
  ],
  rainbow: [
    "#FFD729", "#B5E853", "#6FE3D6", "#6B9EFF", "#B59EFF", "#FFB6D8", "#FF9E9E",
  ],
};

const DEFAULTS = {
  barCount: 28,
  palette: "iGMS",
  animSeconds: 6,
  staggerSeconds: 0.25,
};

export class ColorRails {
  constructor(railEls, options = {}) {
    this.rails = railEls;
    this.options = { ...DEFAULTS, ...options };
    this._render();
  }

  _render() {
    const { barCount, palette, animSeconds, staggerSeconds } = this.options;
    const colors = PALETTES[palette] || PALETTES.iGMS;

    for (const [railIdx, rail] of this.rails.entries()) {
      // mirror right-side rail so its fade points away from center
      rail.style.setProperty("--rail-dir", railIdx === 0 ? "1" : "-1");
      rail.innerHTML = "";
      for (let i = 0; i < barCount; i++) {
        const t = i / Math.max(1, barCount - 1);
        const color = sampleColor(colors, t);
        const delay = (i * staggerSeconds).toFixed(2);
        const bar = document.createElement("div");
        bar.className = "bar";
        bar.style.setProperty("--c", color);
        bar.style.animationDuration = `${animSeconds}s`;
        bar.style.animationDelay = `-${delay}s`;   // negative → starts mid-cycle
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

/* Interpolate between palette stops to produce smooth gradients across
   arbitrary `barCount`. t ∈ [0,1] → blended hex color. */
function sampleColor(stops, t) {
  if (t <= 0) return stops[0];
  if (t >= 1) return stops[stops.length - 1];
  const i = t * (stops.length - 1);
  const lo = Math.floor(i);
  const f = i - lo;
  return lerpHex(stops[lo], stops[lo + 1], f);
}

function lerpHex(a, b, f) {
  const ar = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(ar + (br - ar) * f);
  const g = Math.round(ag + (bg - ag) * f);
  const bl = Math.round(ab + (bb - ab) * f);
  return "#" + [r, g, bl].map(v => v.toString(16).padStart(2, "0")).join("").toUpperCase();
}

export const RAIL_PALETTES = PALETTES;
