// Refold-style color rails — two vertical stacks of horizontal bars at the
// page edges. Bars are width-animated; the gradient direction goes from a
// "cool" anchor color at the OUTER page edge, through the brand yellow,
// fading to white at the INNER edge near content. The brand sits inside
// the cool, so the eye reads the brand last (cleaner separation from the
// page edge).
//
// All palette colors are sampled from the iGMS Figma main page.
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
//   barCount       : number   bars per rail (default 60)
//   barHeight      : number   px height of each bar (default 24)
//   minWidth       : number   percent — min bar extension (default 25)
//   maxWidth       : number   percent — max bar extension (default 95)
//   animSeconds    : number   breathe cycle (default 5.0)
//   staggerSeconds : number   delay between adjacent bars (default 0.10)
//   palette        : string   key from PALETTES (default "yellow-blue")
//   seed           : number   PRNG seed for width jitter (default 1)

// Palettes use { outer, brand } — outer sits at the page edge, brand is the
// "warmer/closer-to-content" stop. The gradient fades to transparent after.
const PALETTES = {
  // blue → yellow — cool outer anchor, warm brand inside. Strong contrast.
  "yellow-blue":   { outer: "#1F88E5", brand: "#FFD729" },
  // green → yellow — fresh, growth-y, softer transition (analogous hues).
  "yellow-green":  { outer: "#62B970", brand: "#FFD729" },
  // coral → yellow — warm-on-warm, energetic.
  "yellow-coral":  { outer: "#FD5C63", brand: "#FFD729" },
  // dark yellow → bright yellow — monochrome, most reserved.
  "yellow-mono":   { outer: "#C79100", brand: "#FFD729" },
  // purple → yellow — high-contrast complementary, more decorative.
  "yellow-purple": { outer: "#5363AA", brand: "#FFD729" },
  // blue-mono — no yellow, all cool. For A/B comparison if yellow feels off.
  "blue-mono":     { outer: "#245ABC", brand: "#96C8FF" },
};

const DEFAULTS = {
  barCount: 60,
  barHeight: 24,
  minWidth: 25,
  maxWidth: 95,
  animSeconds: 5.0,
  staggerSeconds: 0.10,
  palette: "yellow-blue",
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
    const pal = PALETTES[o.palette] || PALETTES["yellow-blue"];
    const rand = mulberry32(o.seed);

    for (const rail of this.rails) {
      rail.style.setProperty("--outer", pal.outer);
      rail.style.setProperty("--brand", pal.brand);
      rail.style.setProperty("--bar-h", `${o.barHeight}px`);
      rail.innerHTML = "";

      for (let i = 0; i < o.barCount; i++) {
        const jitter1 = (rand() - 0.5) * 12;
        const jitter2 = (rand() - 0.5) * 12;
        const wMin = Math.max(5,  o.minWidth + jitter1);
        const wMax = Math.min(100, o.maxWidth + jitter2);
        const delay = (i * o.staggerSeconds).toFixed(2);

        const bar = document.createElement("div");
        bar.className = "bar";
        bar.style.setProperty("--w-min", `${wMin.toFixed(1)}%`);
        bar.style.setProperty("--w-max", `${wMax.toFixed(1)}%`);
        bar.style.animationDuration = `${o.animSeconds}s`;
        bar.style.animationDelay = `-${delay}s`;
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
