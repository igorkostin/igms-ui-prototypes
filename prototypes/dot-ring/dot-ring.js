// Dot-ring background animation.
//
// Generates an inline SVG of many small dots arranged in an annulus and
// rotates the whole thing slowly via CSS. Color is controlled by the CSS
// variable --dot-color on the host element (circles use fill="currentColor").
//
// All dots are fully opaque, so overlaps merge into the same color — like
// halftone printing. The illusion of light/dark regions comes from how the
// dots are *distributed*, not from per-dot transparency.
//
// Density profile across a band can be controlled with `falloff`:
//   ρ(t) = (1 − t)^k         where t = (r − rIn) / (rOut − rIn)
// t=0 → inner edge (max density, like "ground level")
// t=1 → outer edge (zero density, like "edge of atmosphere")
// k=1 linear, k=2 quadratic (recommended), k=3 cubic, k=0 uniform (no falloff).
//
// Usage:
//   const ring = new DotRing(hostElement, options);
//   ring.update({ rotationSeconds: 400 });
//   ring.destroy();
//
// Options (all optional):
//   viewBox          : number   logical SVG viewBox size (default 1000)
//   bands            : Array    [{ innerRadius, outerRadius, count, dotRadius, falloff? }]
//                                radii are fractions of viewBox/2 (0..1+)
//   rotationSeconds  : number   one full turn duration (default 250)
//   direction        : 1 | -1   rotation direction (default 1)
//   seed             : number   PRNG seed for stable randomness (default 1)

const DEFAULT_BANDS = [
  { innerRadius: 0.78, outerRadius: 1.00, count: 3000, dotRadius: 1.8 },
];

function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function buildSvg(opts) {
  const vb = opts.viewBox;
  const cx = vb / 2;
  const cy = vb / 2;
  const half = vb / 2;
  const rand = mulberry32(opts.seed);
  const parts = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vb} ${vb}" ` +
    `width="100%" height="100%" aria-hidden="true" focusable="false">`
  );

  for (const band of opts.bands) {
    const rIn = band.innerRadius * half;
    const rOut = band.outerRadius * half;
    const rIn2 = rIn * rIn;
    const rOut2 = rOut * rOut;
    const dotR = band.dotRadius;
    const k = band.falloff?.k ?? 0;       // 0 = uniform across the band
    const useFalloff = k > 0;
    // Safety cap: with k=4 mean acceptance ≈ 0.2, so ~5x; cap at 30x.
    const maxAttempts = band.count * 30;

    let placed = 0;
    let attempts = 0;
    while (placed < band.count && attempts < maxAttempts) {
      attempts++;
      // Uniform area sample in the annulus.
      const u = rand();
      const r = Math.sqrt(u * (rOut2 - rIn2) + rIn2);
      if (useFalloff) {
        const t = (r - rIn) / (rOut - rIn);
        if (rand() >= Math.pow(1 - t, k)) continue;
      }
      const a = rand() * Math.PI * 2;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      // No `opacity` attr → fully opaque. Overlaps merge, not darken.
      parts.push(
        `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${dotR}" fill="currentColor"/>`
      );
      placed++;
    }
  }

  parts.push("</svg>");
  return parts.join("");
}

export class DotRing {
  constructor(host, options = {}) {
    this.host = host;
    this.options = this._merge(options);
    this.host.classList.add("dot-ring-host");
    this._render();
    this._applyMotion();
  }

  _merge(o) {
    return {
      viewBox: o.viewBox ?? 1000,
      bands: o.bands ?? DEFAULT_BANDS,
      rotationSeconds: o.rotationSeconds ?? 250,
      direction: o.direction ?? 1,
      seed: o.seed ?? 1,
    };
  }

  _render() {
    this.host.innerHTML = buildSvg(this.options);
  }

  _applyMotion() {
    const turn = this.options.direction >= 0 ? "1turn" : "-1turn";
    this.host.style.setProperty("--dot-ring-duration", `${this.options.rotationSeconds}s`);
    this.host.style.setProperty("--dot-ring-turn", turn);
  }

  update(partial) {
    const needRerender =
      partial.bands !== undefined ||
      partial.viewBox !== undefined ||
      partial.seed !== undefined;
    this.options = { ...this.options, ...partial };
    if (needRerender) this._render();
    this._applyMotion();
  }

  destroy() {
    this.host.innerHTML = "";
    this.host.classList.remove("dot-ring-host");
  }
}

export const DOT_RING_PRESETS = {
  // --- Closed rings (hero with image in the middle, Salesloft style) ------
  default: {
    bands: [
      { innerRadius: 0.78, outerRadius: 1.00, count: 3000, dotRadius: 1.8 },
    ],
  },
  dense: {
    bands: [
      { innerRadius: 0.74, outerRadius: 1.02, count: 5000, dotRadius: 1.6 },
    ],
  },
  sparse: {
    bands: [
      { innerRadius: 0.82, outerRadius: 0.96, count: 1200, dotRadius: 2.2 },
    ],
  },
  halo: {
    bands: [
      { innerRadius: 0.95, outerRadius: 1.00, count: 800, dotRadius: 1.8 },
      { innerRadius: 0.85, outerRadius: 0.90, count: 600, dotRadius: 1.6 },
      { innerRadius: 0.70, outerRadius: 0.75, count: 400, dotRadius: 1.4 },
      { innerRadius: 0.50, outerRadius: 0.55, count: 240, dotRadius: 1.2 },
    ],
  },

  // --- Horizon arcs (single band, density falls off with altitude) --------
  // The visible portion is the top arc of a giant ring whose center is below
  // the section. Dots cluster near the inner edge of the band ("ground") and
  // thin out toward the outer edge ("upper atmosphere"). All dots opaque.

  // Wider, smooth atmospheric gradient — recommended default.
  horizon: {
    bands: [{
      innerRadius: 0.68, outerRadius: 1.00,
      count: 14000, dotRadius: 1.4,
      falloff: { k: 2 },
    }],
  },

  // Crisp surface line, fast falloff into thin air above.
  "horizon-thin": {
    bands: [{
      innerRadius: 0.86, outerRadius: 1.00,
      count: 8000, dotRadius: 1.3,
      falloff: { k: 3 },
    }],
  },

  // Deep atmosphere — wide band with slow falloff.
  "horizon-thick": {
    bands: [{
      innerRadius: 0.55, outerRadius: 1.00,
      count: 22000, dotRadius: 1.4,
      falloff: { k: 1.8 },
    }],
  },

  // Soft hazy — very wide and gentle.
  "horizon-soft": {
    bands: [{
      innerRadius: 0.45, outerRadius: 1.00,
      count: 26000, dotRadius: 1.3,
      falloff: { k: 1.2 },
    }],
  },
};
