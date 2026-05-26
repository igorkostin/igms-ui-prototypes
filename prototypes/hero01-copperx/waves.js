// Flow-field wave background.
//
// Canvas-rendered. N stacked thin lines, each a smooth horizontal curve
// composed of 2–3 sine harmonics. Lines drift slowly horizontally and shift
// phase, producing an organic "current" feel. Pastel colors with low alpha
// stack additively when mix-blend-mode is set on the canvas.
//
// Usage:
//   const w = new WaveField(canvas, options);
//   w.start();
//   w.update({ lineCount: 60 });
//   w.stop();
//
// Options (all optional, defaults are pleasant out of the box):
//   lineCount        : number   how many lines to draw (default 36)
//   lineSpacing      : number   vertical gap between line baselines in px (default 14)
//   amplitude        : number   peak vertical excursion in px (default 70)
//   wavelength       : number   primary wavelength in px (default 520)
//   speed            : number   global animation speed multiplier (default 1.0)
//   lineWidth        : number   stroke width in px (default 1.2)
//   opacity          : number   stroke alpha per line (default 0.35)
//   hueStart         : number   hue degrees for the first line (default 30)
//   hueRange         : number   total hue spread across lines (default 80)
//   saturation       : number   HSL saturation % (default 75)
//   lightness        : number   HSL lightness % (default 72)

const DEFAULTS = {
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
    // Honor user motion preferences.
    this._mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    this._mq.addEventListener("change", () => this._respectMotion());
  }

  _resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.floor(r.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(r.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = r.width;
    this.h = r.height;
  }

  start() {
    if (this.running) return;
    if (this._mq.matches) { this._drawOnce(); return; }
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this._draw();
      this.t += 0.012 * this.options.speed;
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  update(partial) {
    this.options = { ...this.options, ...partial };
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

  _drawOnce() {
    this._draw();
  }

  _draw() {
    const { ctx, w, h, options, t } = this;
    ctx.clearRect(0, 0, w, h);

    const n = options.lineCount;
    const spacing = options.lineSpacing;
    const totalSpan = (n - 1) * spacing;
    const centerY = h / 2;
    const startY = centerY - totalSpan / 2;

    for (let i = 0; i < n; i++) {
      const tt = n > 1 ? i / (n - 1) : 0.5;        // 0..1 across lines
      const baseY = startY + i * spacing;

      // Per-line phase: lines are slightly out-of-sync so they don't all dip
      // together — this is what gives the field its woven feel.
      const phaseA = i * 0.42 + Math.sin(i * 0.7) * 0.5;
      const phaseB = i * 0.31 + Math.cos(i * 1.1) * 0.6;

      // Hue ramps smoothly across the stack, so colors blend organically.
      const hue = options.hueStart + tt * options.hueRange;
      ctx.strokeStyle =
        `hsl(${hue.toFixed(1)} ${options.saturation}% ${options.lightness}% / ${options.opacity})`;
      ctx.lineWidth = options.lineWidth;
      ctx.lineCap = "round";

      ctx.beginPath();
      const samples = 110;
      const lambdaA = options.wavelength;
      const lambdaB = options.wavelength * 0.42;
      const lambdaC = options.wavelength * 0.18;
      const amp = options.amplitude;
      // Two-frequency primary + tiny third harmonic for organic edges.
      for (let s = 0; s <= samples; s++) {
        const x = (s / samples) * w;
        const y =
          baseY +
          amp * 0.70 * Math.sin((x / lambdaA) * Math.PI * 2 + phaseA + t) +
          amp * 0.28 * Math.sin((x / lambdaB) * Math.PI * 2 + phaseB + t * 1.35) +
          amp * 0.08 * Math.sin((x / lambdaC) * Math.PI * 2 + phaseA * 1.7 + t * 0.6);
        if (s === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
}

export const WAVE_PRESETS = {
  pastel: {
    lineCount: 36, lineSpacing: 14, amplitude: 70, wavelength: 520,
    hueStart: 30, hueRange: 80, saturation: 75, lightness: 72, opacity: 0.35,
  },
  // Calm, narrow color range — single-hue ribbon feel.
  calm: {
    lineCount: 28, lineSpacing: 18, amplitude: 50, wavelength: 700,
    hueStart: 180, hueRange: 30, saturation: 60, lightness: 70, opacity: 0.30,
  },
  // Wild — lots of motion, broad hue sweep.
  vivid: {
    lineCount: 60, lineSpacing: 10, amplitude: 100, wavelength: 380,
    hueStart: 0, hueRange: 280, saturation: 80, lightness: 65, opacity: 0.28,
  },
  // iGMS — selected as the working baseline for the production hero.
  // Very low amplitude + long wavelength + wide hue range → calm rainbow
  // ripple under text. Tuned manually by Igor on 2026-05-26.
  igms: {
    lineCount: 46, lineSpacing: 12, amplitude: 12, wavelength: 1110,
    speed: 1.3, lineWidth: 1.7, opacity: 0.22,
    hueStart: 36, hueRange: 282, saturation: 68, lightness: 62,
  },
  // Aurora — narrower amplitude, cool hues, smoother.
  aurora: {
    lineCount: 32, lineSpacing: 16, amplitude: 60, wavelength: 600,
    hueStart: 200, hueRange: 90, saturation: 70, lightness: 70, opacity: 0.32,
  },
};
