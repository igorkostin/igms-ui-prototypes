// Cleaner-routing hero scene — gladia.io-inspired.
//
// A pool of property nodes scattered across the hero. Two or three named
// cleaners each have a route through some properties. Each cleaner is a
// dot that:
//   • cleans at a property (stationary, progress ring around the dot)
//   • travels along a thin curved line to the next property (line fades in)
//   • the line disappears when the cleaner arrives
//   • after the last property the cleaner exits the frame
// When all cleaners are done, the scene auto-resets with fresh routes.
//
// Usage:
//   const scene = new CleanerScene(svgEl, options);
//   scene.start();
//   scene.stop();

const PROPERTY_NAMES = [
  "8488 Cornish St",
  "1250 Burnaby St",
  "183 Keefer Pl",
  "33 Smithe St",
  "550 Taylor St",
  "Smithe 33",
  "506 Bute St",
  "1603 W Pender",
  "885 W Cordova",
  "F1113 N Van",
  "Keefer 716",
  "A203 / Anthony",
];

const CLEANER_NAMES = [
  "Heather", "Andrea", "Mei", "Olivia", "Jake", "Priya",
];

const DEFAULT_OPTIONS = {
  propertyCount: 9,
  cleanerCount: 2,
  routeMinStops: 3,
  routeMaxStops: 5,
  cleaningMs: 4500,     // time cleaner spends at each property
  movingMs:   1800,     // time to travel between properties
  exitMs:     1600,
  fps: 30,
  seed: 1,

  // Visual
  propertyRadius: 3.5,
  cleanerRadius: 6,
  propertyColor: "#2A1810",
  lineColor:     "rgba(43, 24, 12, 0.45)",
  propertyLabelColor: "rgba(43, 24, 12, 0.55)",
};

const CLEANER_PALETTE = [
  "#FFA000",   // brand orange
  "#006FFE",   // brand blue
  "#C97A4F",   // terracotta
  "#62B970",   // green
  "#AE45CA",   // purple
];

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

export class CleanerScene {
  constructor(svg, options = {}) {
    this.svg = svg;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.rand = mulberry32(this.options.seed);
    this.running = false;
    this._mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    this._onResize = () => this._layout();
    window.addEventListener("resize", this._onResize);
    this._build();
  }

  _build() {
    // Reset SVG, lay out properties, generate cleaner routes.
    const ns = "http://www.w3.org/2000/svg";
    this.svg.innerHTML = "";
    // Three layers via <g> so painting order is deterministic.
    const gLines      = document.createElementNS(ns, "g"); gLines.dataset.layer = "lines";
    const gProperties = document.createElementNS(ns, "g"); gProperties.dataset.layer = "properties";
    const gCleaners   = document.createElementNS(ns, "g"); gCleaners.dataset.layer = "cleaners";
    this.svg.appendChild(gLines);
    this.svg.appendChild(gProperties);
    this.svg.appendChild(gCleaners);
    this._g = { lines: gLines, properties: gProperties, cleaners: gCleaners };

    this._layout();
  }

  _layout() {
    // SVG fills the host; we use its bounding box for positions in px space.
    // viewBox is set to match width/height so coords are 1:1.
    const r = this.svg.getBoundingClientRect();
    this.w = Math.max(800, r.width);
    this.h = Math.max(500, r.height);
    this.svg.setAttribute("viewBox", `0 0 ${this.w} ${this.h}`);
    this._placeProperties();
    this._spawnCleaners();
  }

  _placeProperties() {
    const ns = "http://www.w3.org/2000/svg";
    this._g.properties.innerHTML = "";
    const { propertyCount, propertyRadius, propertyColor, propertyLabelColor } = this.options;

    // Avoid the central "content column" so the dots don't sit behind H1/CTA/image.
    const cx = this.w / 2;
    const safeWidthHalf = Math.min(560, this.w * 0.35);
    const topPad    = 60;
    const bottomPad = Math.min(420, this.h * 0.55);  // keep dots above product image area

    this.properties = [];
    let attempts = 0;
    while (this.properties.length < propertyCount && attempts < propertyCount * 30) {
      attempts++;
      const x = this.rand() * (this.w - 80) + 40;
      const y = this.rand() * (this.h - topPad - bottomPad) + topPad;
      // Reject points inside the content safe area
      if (Math.abs(x - cx) < safeWidthHalf && y > 80 && y < this.h - bottomPad + 40) continue;
      // Reject points too close to an existing property
      if (this.properties.some((p) => Math.hypot(p.x - x, p.y - y) < 80)) continue;
      this.properties.push({
        x, y,
        name: PROPERTY_NAMES[this.properties.length % PROPERTY_NAMES.length],
      });
    }

    // Render property circles + tiny labels
    for (const p of this.properties) {
      const c = document.createElementNS(ns, "circle");
      c.setAttribute("cx", p.x);
      c.setAttribute("cy", p.y);
      c.setAttribute("r", propertyRadius);
      c.setAttribute("fill", propertyColor);
      this._g.properties.appendChild(c);

      const t = document.createElementNS(ns, "text");
      t.setAttribute("x", p.x + 8);
      t.setAttribute("y", p.y + 3);
      t.setAttribute("font-size", "10");
      t.setAttribute("font-family", "var(--font-body, Outfit, sans-serif)");
      t.setAttribute("fill", propertyLabelColor);
      t.textContent = p.name;
      this._g.properties.appendChild(t);
    }
  }

  _spawnCleaners() {
    const ns = "http://www.w3.org/2000/svg";
    const { cleanerCount, cleanerRadius, routeMinStops, routeMaxStops } = this.options;

    // Clear cleaners + lines from any previous round.
    this._g.cleaners.innerHTML = "";
    this._g.lines.innerHTML = "";

    this.cleaners = [];
    for (let i = 0; i < cleanerCount; i++) {
      const stops = routeMinStops + Math.floor(this.rand() * (routeMaxStops - routeMinStops + 1));
      const route = this._randomRoute(stops);
      const color = CLEANER_PALETTE[i % CLEANER_PALETTE.length];
      const name = CLEANER_NAMES[(i + Math.floor(this.rand() * CLEANER_NAMES.length)) % CLEANER_NAMES.length];

      // Cleaner DOM: dot + progress ring + label
      const g = document.createElementNS(ns, "g");
      g.dataset.cleaner = name;
      g.setAttribute("transform", `translate(${this.properties[route[0]].x}, ${this.properties[route[0]].y})`);

      // Faint glow halo behind the dot
      const halo = document.createElementNS(ns, "circle");
      halo.setAttribute("r", cleanerRadius * 2.6);
      halo.setAttribute("fill", color);
      halo.setAttribute("opacity", "0.10");

      // Progress ring (stroke-dasharray controls fill amount)
      const ring = document.createElementNS(ns, "circle");
      ring.setAttribute("r", cleanerRadius + 4);
      ring.setAttribute("fill", "none");
      ring.setAttribute("stroke", color);
      ring.setAttribute("stroke-width", "1.5");
      ring.setAttribute("opacity", "0.6");
      const C = 2 * Math.PI * (cleanerRadius + 4);
      ring.setAttribute("stroke-dasharray", `0 ${C}`);
      ring.setAttribute("transform", "rotate(-90)");

      // The dot itself
      const dot = document.createElementNS(ns, "circle");
      dot.setAttribute("r", cleanerRadius);
      dot.setAttribute("fill", color);

      // Name label
      const label = document.createElementNS(ns, "text");
      label.setAttribute("x", cleanerRadius + 8);
      label.setAttribute("y", -cleanerRadius - 4);
      label.setAttribute("font-size", "11");
      label.setAttribute("font-weight", "500");
      label.setAttribute("font-family", "var(--font-display, Outfit, sans-serif)");
      label.setAttribute("fill", color);
      label.textContent = name;

      g.append(halo, ring, dot, label);
      this._g.cleaners.appendChild(g);

      // Active travel line (svg path); recreated per leg.
      const line = document.createElementNS(ns, "path");
      line.setAttribute("stroke", color);
      line.setAttribute("stroke-width", "1.2");
      line.setAttribute("stroke-linecap", "round");
      line.setAttribute("fill", "none");
      line.setAttribute("opacity", "0");
      this._g.lines.appendChild(line);

      this.cleaners.push({
        name, color, route, step: 0,
        phase: "cleaning",          // start by cleaning at first stop
        phaseStart: 0,              // initialised on first tick
        startupDelayMs: i * 800,    // stagger so cleaners don't move in sync
        dom: { g, dot, ring, label, line, halo },
        ringCircumference: C,
      });
    }
  }

  _randomRoute(stops) {
    // Pick `stops` distinct property indices in a random walk-ish order.
    const idxs = Array.from({ length: this.properties.length }, (_, i) => i);
    // Shuffle (Fisher-Yates with our PRNG)
    for (let i = idxs.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
    }
    return idxs.slice(0, Math.min(stops, this.properties.length));
  }

  start() {
    if (this.running) return;
    if (this._mq.matches) { this._drawStatic(); return; }
    this.running = true;
    const targetFrameMs = 1000 / Math.max(1, this.options.fps);
    let lastFrameT = 0;
    const loop = (now) => {
      if (!this.running) return;
      if (now - lastFrameT >= targetFrameMs) {
        lastFrameT = now;
        this._tick(now);
      }
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  destroy() {
    this.stop();
    window.removeEventListener("resize", this._onResize);
  }

  _drawStatic() {
    // Reduced-motion: park each cleaner at its first stop.
    for (const c of this.cleaners) {
      const p = this.properties[c.route[0]];
      c.dom.g.setAttribute("transform", `translate(${p.x}, ${p.y})`);
      c.dom.line.setAttribute("opacity", "0");
    }
  }

  _tick(now) {
    let allDone = true;
    for (const c of this.cleaners) {
      // Startup delay so all cleaners don't start in sync
      if (c.phaseStart === 0) c.phaseStart = now + c.startupDelayMs;
      if (now < c.phaseStart) continue;

      const elapsed = now - c.phaseStart;
      switch (c.phase) {
        case "cleaning": {
          const here = this.properties[c.route[c.step]];
          c.dom.g.setAttribute("transform", `translate(${here.x}, ${here.y})`);
          c.dom.line.setAttribute("opacity", "0");
          const t = Math.min(1, elapsed / this.options.cleaningMs);
          const filled = t * c.ringCircumference;
          c.dom.ring.setAttribute("stroke-dasharray", `${filled} ${c.ringCircumference}`);
          if (t >= 1) {
            c.dom.ring.setAttribute("stroke-dasharray", `0 ${c.ringCircumference}`);
            if (c.step >= c.route.length - 1) {
              c.phase = "exiting";
              this._beginExit(c, here);
            } else {
              c.phase = "moving";
              this._beginMove(c, here, this.properties[c.route[c.step + 1]]);
            }
            c.phaseStart = now;
          }
          allDone = false;
          break;
        }
        case "moving": {
          const t = Math.min(1, elapsed / this.options.movingMs);
          // Quad-bezier interpolate for organic curved travel.
          const { from, to, ctrl } = c._leg;
          const u = 1 - t;
          const x = u*u*from.x + 2*u*t*ctrl.x + t*t*to.x;
          const y = u*u*from.y + 2*u*t*ctrl.y + t*t*to.y;
          c.dom.g.setAttribute("transform", `translate(${x}, ${y})`);
          // Line fades in while moving, fades out near the end.
          const op = t < 0.15 ? t/0.15 : t > 0.85 ? (1-t)/0.15 : 1;
          c.dom.line.setAttribute("opacity", String(op * 0.7));
          if (t >= 1) {
            c.step += 1;
            c.phase = "cleaning";
            c.phaseStart = now;
            c.dom.line.setAttribute("opacity", "0");
          }
          allDone = false;
          break;
        }
        case "exiting": {
          const t = Math.min(1, elapsed / this.options.exitMs);
          const { from, to } = c._leg;
          const x = from.x + (to.x - from.x) * t;
          const y = from.y + (to.y - from.y) * t;
          c.dom.g.setAttribute("transform", `translate(${x}, ${y})`);
          const op = (1 - t);
          c.dom.line.setAttribute("opacity", String(op * 0.5));
          c.dom.g.setAttribute("opacity", String(op));
          if (t >= 1) {
            c.phase = "done";
            c.dom.g.setAttribute("opacity", "0");
            c.dom.line.setAttribute("opacity", "0");
          }
          allDone = false;
          break;
        }
        case "done":
          break;
      }
    }

    if (allDone) {
      // Reset the scene with new routes after a small pause.
      if (!this._resetAt) this._resetAt = now + 1500;
      if (now >= this._resetAt) {
        this._resetAt = 0;
        this._spawnCleaners();
      }
    } else {
      this._resetAt = 0;
    }
  }

  _beginMove(c, fromP, toP) {
    // Quadratic bezier with control point offset perpendicular to the segment
    const mx = (fromP.x + toP.x) / 2;
    const my = (fromP.y + toP.y) / 2;
    const dx = toP.x - fromP.x;
    const dy = toP.y - fromP.y;
    const len = Math.hypot(dx, dy);
    // Curve depth scales with segment length; randomly flip sign.
    const sign = (this.rand() > 0.5 ? 1 : -1);
    const depth = sign * Math.min(80, len * 0.18);
    const px = -dy / (len || 1);
    const py =  dx / (len || 1);
    const ctrl = { x: mx + px * depth, y: my + py * depth };
    c._leg = { from: fromP, to: toP, ctrl };
    c.dom.line.setAttribute("d", `M ${fromP.x} ${fromP.y} Q ${ctrl.x} ${ctrl.y} ${toP.x} ${toP.y}`);
  }

  _beginExit(c, fromP) {
    // Pick the nearest edge of the viewport and exit toward it.
    const dl = fromP.x;
    const dr = this.w - fromP.x;
    const dt = fromP.y;
    const db = this.h - fromP.y;
    const min = Math.min(dl, dr, dt, db);
    const to = (min === dl) ? { x: -80, y: fromP.y }
            : (min === dr) ? { x: this.w + 80, y: fromP.y }
            : (min === dt) ? { x: fromP.x, y: -80 }
                           : { x: fromP.x, y: this.h + 80 };
    c._leg = { from: fromP, to };
    c.dom.line.setAttribute("d", `M ${fromP.x} ${fromP.y} L ${to.x} ${to.y}`);
  }

  update(partial) {
    this.options = { ...this.options, ...partial };
    // For options that affect layout/spawn, rebuild.
    const rebuildKeys = ["propertyCount", "cleanerCount", "routeMinStops", "routeMaxStops", "seed",
                         "propertyRadius", "cleanerRadius", "propertyColor", "lineColor",
                         "propertyLabelColor"];
    if (rebuildKeys.some((k) => k in partial)) {
      this.rand = mulberry32(this.options.seed);
      this._layout();
    }
    if ("fps" in partial && this.running) {
      this.stop(); this.start();
    }
  }
}
