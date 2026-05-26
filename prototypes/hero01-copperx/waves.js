// Flow-field wave background — perf-optimized canvas renderer.
//
// Render budget on MacBook Air M1:
//   • Each line draws a polyline of `samples` points.
//   • Per point we evaluate up to `harmonics` sine calls.
//   • Per-line stroke styles are cached at render-config time, not per frame.
//   • If `monoColor` is set, ALL lines share one path → single stroke() call.
//   • rAF is throttled to `fps` (default 30) so the loop doesn't burn the
//     full 60 Hz on subtle animation that the eye can't tell apart anyway.
//
// Usage:
//   const w = new WaveField(canvas, options);
//   w.start();
//   w.update({ harmonics: 1 });
//   w.stop();
//
// Visual options:
//   lineCount, lineSpacing, amplitude, wavelength, speed, lineWidth,
//   opacity, hueStart, hueRange, saturation, lightness, offsetY
//
// Perf options:
//   fps        : number   target frames per second (default 30)
//   samples    : number   polyline points per line (default 60)
//   harmonics  : 1 | 2 | 3   how many sine terms in the curve (default 2)
//   monoColor  : string|null   if set, all lines stroke in this hex color
//                              (single beginPath/stroke → much faster)

const DEFAULTS = {
  // Visual
  lineCount: 36,
  lineSpacing: 14,
  amplitude: 70,
  wavelength: 520,
  speed: 1.0,
  lineWidth: 1.2,
  opacity: 0.35,
  hueStart: 30,
  hueRange: 80,
  saturation: 75,
  lightness: 72,
  offsetY: 0,
  // Perf
  fps: 30,
  samples: 60,
  harmonics: 2,
  monoColor: null,
};

export class WaveField {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.options = { ...DEFAULTS, ...options };
    this.t = 0;
    this.running = false;
    this._onResize = () => this._resize();
    this._resize();
    window.addEventListener("resize", this._onResize);
    this._mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    this._mq.addEventListener("change", () => this._respectMotion());
    this._rebuildCache();
  }

  _resize() {
    // Cap DPR at 1.5 — on retina, 2x doubles pixel count which is the biggest
    // single performance drag for canvas stroke ops. 1.5x is still crisp.
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.floor(r.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(r.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = r.width;
    this.h = r.height;
  }

  /** Precompute per-line constants that don't depend on `t`. */
  _rebuildCache() {
    const o = this.options;
    const n = o.lineCount;
    const lines = new Array(n);
    for (let i = 0; i < n; i++) {
      const tt = n > 1 ? i / (n - 1) : 0.5;
      const hue = o.hueStart + tt * o.hueRange;
      lines[i] = {
        phaseA: i * 0.42 + Math.sin(i * 0.7) * 0.5,
        phaseB: i * 0.31 + Math.cos(i * 1.1) * 0.6,
        // Cached HSLA stroke string (only used when monoColor is null).
        strokeStyle: `hsl(${hue.toFixed(1)} ${o.saturation}% ${o.lightness}% / ${o.opacity})`,
      };
    }
    this._cache = {
      n,
      lines,
      totalSpan: (n - 1) * o.lineSpacing,
      lambdaA: o.wavelength,
      lambdaB: o.wavelength * 0.42,
      lambdaC: o.wavelength * 0.18,
      monoColor: o.monoColor || null,
    };
  }

  start() {
    if (this.running) return;
    if (this._mq.matches) { this._drawOnce(); return; }
    this.running = true;
    const targetFrameMs = 1000 / Math.max(1, this.options.fps);
    let lastT = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      const elapsed = now - lastT;
      if (elapsed >= targetFrameMs) {
        // Advance time proportionally to real elapsed → same perceptual
        // speed regardless of fps. Constant calibrated to match the old
        // 60Hz default (0.012 / 16.67ms ≈ 0.00072/ms).
        this.t += elapsed * 0.00072 * this.options.speed;
        lastT = now - (elapsed % targetFrameMs);
        this._draw();
      }
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  update(partial) {
    const prev = this.options;
    this.options = { ...prev, ...partial };
    // Rebuild the cache if anything that affects per-line constants changed.
    const cacheKeys = [
      "lineCount", "lineSpacing", "wavelength",
      "hueStart", "hueRange", "saturation", "lightness", "opacity",
      "monoColor",
    ];
    if (cacheKeys.some((k) => k in partial)) this._rebuildCache();
    if ("fps" in partial && this.running) {
      this.stop();
      this.start();
    }
    if (!this.running) this._drawOnce();
  }

  destroy() {
    this.stop();
    window.removeEventListener("resize", this._onResize);
  }

  _respectMotion() {
    if (this._mq.matches) { this.stop(); this._drawOnce(); }
    else this.start();
  }

  _drawOnce() { this._draw(); }

  _draw() {
    const { ctx, w, h, options, t } = this;
    const c = this._cache;
    ctx.clearRect(0, 0, w, h);

    const centerY = h / 2 + (options.offsetY || 0);
    const startY = centerY - c.totalSpan / 2;
    const samples = options.samples;
    const harmonics = options.harmonics;
    const amp = options.amplitude;
    const lambdaA = c.lambdaA;
    const lambdaB = c.lambdaB;
    const lambdaC = c.lambdaC;
    const k2pi = Math.PI * 2;
    const xStep = w / samples;

    // Shared state — set once outside the per-line loop.
    ctx.lineWidth = options.lineWidth;
    ctx.lineCap = "round";

    if (c.monoColor) {
      // === Mono mode: ONE path with N polylines, ONE stroke call. ===
      ctx.strokeStyle = c.monoColor;
      ctx.globalAlpha = options.opacity;
      ctx.beginPath();
      for (let i = 0; i < c.n; i++) {
        const line = c.lines[i];
        const baseY = startY + i * options.lineSpacing;
        const phaseA = line.phaseA;
        const phaseB = line.phaseB;
        const tA = phaseA + t;
        const tB = phaseB + t * 1.35;
        const tC = phaseA * 1.7 + t * 0.6;
        for (let s = 0; s <= samples; s++) {
          const x = s * xStep;
          let y = baseY + amp * 0.70 * Math.sin(x / lambdaA * k2pi + tA);
          if (harmonics >= 2) y += amp * 0.28 * Math.sin(x / lambdaB * k2pi + tB);
          if (harmonics >= 3) y += amp * 0.08 * Math.sin(x / lambdaC * k2pi + tC);
          if (s === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else {
      // === Multi-color mode: separate stroke per line. ===
      for (let i = 0; i < c.n; i++) {
        const line = c.lines[i];
        const baseY = startY + i * options.lineSpacing;
        ctx.strokeStyle = line.strokeStyle;
        const phaseA = line.phaseA;
        const phaseB = line.phaseB;
        const tA = phaseA + t;
        const tB = phaseB + t * 1.35;
        const tC = phaseA * 1.7 + t * 0.6;
        ctx.beginPath();
        for (let s = 0; s <= samples; s++) {
          const x = s * xStep;
          let y = baseY + amp * 0.70 * Math.sin(x / lambdaA * k2pi + tA);
          if (harmonics >= 2) y += amp * 0.28 * Math.sin(x / lambdaB * k2pi + tB);
          if (harmonics >= 3) y += amp * 0.08 * Math.sin(x / lambdaC * k2pi + tC);
          if (s === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
  }
}

export const WAVE_PRESETS = {
  pastel: {
    lineCount: 36, lineSpacing: 14, amplitude: 70, wavelength: 520,
    hueStart: 30, hueRange: 80, saturation: 75, lightness: 72, opacity: 0.35,
    fps: 30, samples: 60, harmonics: 2, monoColor: null,
  },
  // Calm, narrow color range — single-hue ribbon feel.
  calm: {
    lineCount: 28, lineSpacing: 18, amplitude: 50, wavelength: 700,
    hueStart: 180, hueRange: 30, saturation: 60, lightness: 70, opacity: 0.30,
    fps: 30, samples: 50, harmonics: 2, monoColor: null,
  },
  // Wild — lots of motion, broad hue sweep. (Heaviest preset.)
  vivid: {
    lineCount: 60, lineSpacing: 10, amplitude: 100, wavelength: 380,
    hueStart: 0, hueRange: 280, saturation: 80, lightness: 65, opacity: 0.28,
    fps: 30, samples: 80, harmonics: 3, monoColor: null,
  },
  // iGMS — current production baseline. Mono brand yellow, 1 harmonic,
  // 30 fps, 40 samples → ~10× less CPU than the old multi-color version
  // while keeping the same visual character (Igor's rev 3 geometry).
  igms: {
    lineCount: 38, lineSpacing: 11, amplitude: 18, wavelength: 930,
    speed: 0.6, lineWidth: 1.1, opacity: 0.26,
    hueStart: 30, hueRange: 150, saturation: 54, lightness: 54,
    offsetY: 105,
    fps: 30, samples: 40, harmonics: 1, monoColor: "#FFD729",
  },
  // Aurora — narrower amplitude, cool hues, smoother.
  aurora: {
    lineCount: 32, lineSpacing: 16, amplitude: 60, wavelength: 600,
    hueStart: 200, hueRange: 90, saturation: 70, lightness: 70, opacity: 0.32,
    fps: 30, samples: 50, harmonics: 2, monoColor: null,
  },
};
