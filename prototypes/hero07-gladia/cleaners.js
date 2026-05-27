// Hotel-day routing scene — gladia.io-inspired but story-driven.
//
// Simulates one compressed "day" (default 60s = 9:00am → 11:00pm) on a map
// of iGMS properties. Multiple actors share the stage:
//
//   • Guests (green dots, named "Simon P. (guest+3)", etc.)
//       - 70% of units start the day occupied
//       - 2 of those are long-stay — they stay through the whole day
//       - The rest check out at staggered times (9, 10, 11am, noon)
//       - New guests arrive in the evening (4, 5, 6, 10, 11pm), but only
//         into units that have already been cleaned that day
//
//   • Cleaners (brand-orange / brand-blue dots, named "Heather", "Andrea",
//     "Mei", "Olivia"). Each cleaner has their OWN assignment — units
//     don't overlap between cleaners. Cleaning starts only after the
//     guest has physically left the unit (small gap).
//
//   • PMs (Property Managers, dark-amber dots, "John (PM)"). After
//     cleaning, the PM may swing by for a quick inspection on a few
//     units before the next guest arrives.
//
// Cleaners and PMs both show a progress ring while working. Guests don't.
// Each entity moves along thin curved bezier paths between locations.
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

const CLEANER_NAMES = ["Heather", "Andrea", "Mei", "Olivia"];
const PM_NAMES      = ["John (PM)", "Maria (PM)"];

const GUEST_NAMES = [
  "Simon P. (guest+3)", "John R. (guest+1)", "Val N. (guest+4)", "Kevin W. (guest+1)",
  "Maya P. (guest+2)",  "Tom B. (guest+1)",  "Lisa K. (guest+3)", "Mark D. (guest+2)",
  "Jenny H. (guest+1)", "Carlos M. (guest+4)",
];

const COLORS = {
  property:        "#2A1810",
  propertyLabel:   "rgba(43, 24, 16, 0.55)",
  guest:           "#2E9E5A",
  guestLabel:      "rgba(15, 90, 50, 0.85)",
  pm:              "#7A4E1A",
  cleaners:        ["#FFA000", "#006FFE", "#C97A4F", "#AE45CA"],
  line:            "rgba(43, 24, 16, 0.45)",
  clockText:       "rgba(43, 24, 16, 0.70)",
};

const DEFAULT_OPTIONS = {
  propertyCount:    9,
  cleanerCount:     2,
  pmCount:          1,
  occupancyAtStart: 0.70,   // fraction of units occupied at 9:00am
  longStayCount:    2,      // guests that don't check out today
  dayMs:           60000,   // demo day length (9am → 11pm compressed)
  fps:             30,
  seed:             1,
  paused:           false,

  // Visual radii
  propertyRadius:   3.5,
  guestRadius:      5,
  workerRadius:     6,
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

// "Real" day minutes that we map onto demo time. 9:00am → 11:00pm.
const DAY_START_MIN = 9 * 60;
const DAY_END_MIN   = 23 * 60;
const DAY_SPAN_MIN  = DAY_END_MIN - DAY_START_MIN;

const CHECKOUT_TIMES_MIN = [9*60, 10*60, 11*60, 12*60];           // 9,10,11am,noon
const ARRIVAL_TIMES_MIN  = [16*60, 17*60, 18*60, 22*60, 23*60-15]; // 4,5,6,10pm, 10:45pm
const CLEAN_GAP_MIN      = 10;                                     // gap after guest leaves
const CLEAN_DURATION_MIN = 90;                                     // ~1.5h compressed
const PM_DURATION_MIN    = 30;                                     // ~30 min compressed
const GUEST_GAP_MIN      = 30;                                     // gap before new guest after work done

const ns = "http://www.w3.org/2000/svg";

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
    this.svg.innerHTML = "";
    this._g = {
      lines:      mk(this.svg, "g", { "data-layer": "lines" }),
      properties: mk(this.svg, "g", { "data-layer": "properties" }),
      guests:     mk(this.svg, "g", { "data-layer": "guests" }),
      workers:    mk(this.svg, "g", { "data-layer": "workers" }),
      clock:      mk(this.svg, "g", { "data-layer": "clock" }),
    };
    this._layout();
  }

  _layout() {
    const r = this.svg.getBoundingClientRect();
    this.w = Math.max(800, r.width);
    this.h = Math.max(500, r.height);
    this.svg.setAttribute("viewBox", `0 0 ${this.w} ${this.h}`);
    this._setupDay();
  }

  _setupDay() {
    // Reset random for reproducible "day generation" with same seed
    this.rand = mulberry32(this.options.seed);
    this._dayStartT = performance.now();

    this._placeProperties();
    this._planDay();
    this._renderInitialState();
    this._renderClock();
  }

  /** Lay out N property nodes in a safe ring around the central content. */
  _placeProperties() {
    this._g.properties.innerHTML = "";
    const { propertyCount, propertyRadius } = this.options;

    const cx = this.w / 2;
    const safeWidthHalf = Math.min(560, this.w * 0.35);
    const topPad    = 70;
    const bottomPad = Math.min(420, this.h * 0.55);

    this.properties = [];
    let attempts = 0;
    while (this.properties.length < propertyCount && attempts < propertyCount * 50) {
      attempts++;
      const x = this.rand() * (this.w - 80) + 40;
      const y = this.rand() * (this.h - topPad - bottomPad) + topPad;
      if (Math.abs(x - cx) < safeWidthHalf && y > 80 && y < this.h - bottomPad + 40) continue;
      if (this.properties.some((p) => Math.hypot(p.x - x, p.y - y) < 90)) continue;
      this.properties.push({
        idx: this.properties.length,
        x, y,
        name: PROPERTY_NAMES[this.properties.length % PROPERTY_NAMES.length],
      });
    }
    for (const p of this.properties) {
      mk(this._g.properties, "circle", { cx: p.x, cy: p.y, r: propertyRadius, fill: COLORS.property });
      mk(this._g.properties, "text", {
        x: p.x + 8, y: p.y + 3, "font-size": 10,
        "font-family": "var(--font-body, Outfit, sans-serif)", fill: COLORS.propertyLabel,
      }, p.name);
    }
  }

  /** Build the full day schedule:
   *   - which units start with a guest
   *   - which 2 are long-stay
   *   - checkout / clean / pm / arrival timings per unit
   *   - cleaner & PM assignments (non-overlapping by unit)
   */
  _planDay() {
    const props = this.properties;
    const N = props.length;

    // 1. Pick occupied units
    const occupiedCount = Math.round(N * this.options.occupancyAtStart);
    const allIdxs = [...Array(N).keys()];
    shuffle(allIdxs, this.rand);
    const occupiedIdxs = allIdxs.slice(0, occupiedCount);

    // 2. 2 of those are long-stay
    const longStayIdxs = occupiedIdxs.slice(0, this.options.longStayCount);
    const checkoutIdxs = occupiedIdxs.slice(this.options.longStayCount);

    // 3. Assign checkout times (one per unit, cycling through 9,10,11,noon)
    const guestNamePool = [...GUEST_NAMES];
    shuffle(guestNamePool, this.rand);

    const checkoutTimes = [...CHECKOUT_TIMES_MIN];
    while (checkoutTimes.length < checkoutIdxs.length) {
      checkoutTimes.push(checkoutTimes[checkoutTimes.length - 1] + 60);
    }
    shuffle(checkoutTimes, this.rand);

    const arrivalTimes = [...ARRIVAL_TIMES_MIN];
    while (arrivalTimes.length < checkoutIdxs.length) {
      arrivalTimes.push(arrivalTimes[arrivalTimes.length - 1] + 60);
    }
    shuffle(arrivalTimes, this.rand);

    // 4. Build per-unit job descriptors
    /** @type {Array<{
     *    unit: number,
     *    initialGuest: string | null,
     *    longStay: boolean,
     *    checkoutMin: number | null,
     *    cleanStartMin: number | null,
     *    cleanEndMin: number | null,
     *    pmStartMin: number | null,
     *    pmEndMin: number | null,
     *    nextGuest: string | null,
     *    arrivalMin: number | null,
     *    cleanerIdx: number | null,
     *    pmIdx: number | null,
     * }>} */
    const jobs = props.map((p) => ({
      unit: p.idx,
      initialGuest: null, longStay: false,
      checkoutMin: null, cleanStartMin: null, cleanEndMin: null,
      pmStartMin: null, pmEndMin: null,
      nextGuest: null, arrivalMin: null,
      cleanerIdx: null, pmIdx: null,
    }));

    // Initial guests
    for (const idx of occupiedIdxs) {
      jobs[idx].initialGuest = guestNamePool.pop() || "Guest";
    }
    for (const idx of longStayIdxs) jobs[idx].longStay = true;

    // Checkouts + cleanings
    for (let i = 0; i < checkoutIdxs.length; i++) {
      const idx = checkoutIdxs[i];
      const co = checkoutTimes[i] || (12*60 + i * 30);
      const cs = co + CLEAN_GAP_MIN;
      const ce = cs + CLEAN_DURATION_MIN;
      jobs[idx].checkoutMin = co;
      jobs[idx].cleanStartMin = cs;
      jobs[idx].cleanEndMin = ce;
      // Next guest arrival
      const ar = arrivalTimes[i] || (22*60 + i * 30);
      // Ensure arrival is at least 30 min after clean end (so order is sane).
      jobs[idx].arrivalMin = Math.max(ar, ce + GUEST_GAP_MIN);
      jobs[idx].nextGuest = guestNamePool.pop() || "Guest";
    }

    // 5. Assign cleaners — split cleaning jobs by checkout time, no overlap
    const cleanJobs = checkoutIdxs
      .map((idx) => ({ idx, cs: jobs[idx].cleanStartMin }))
      .sort((a, b) => a.cs - b.cs);
    // Round-robin distribution preserves ordering per cleaner
    for (let i = 0; i < cleanJobs.length; i++) {
      const cleanerIdx = i % this.options.cleanerCount;
      jobs[cleanJobs[i].idx].cleanerIdx = cleanerIdx;
    }

    // 6. PM check after cleaning on a SUBSET of units (skip some so it's not noisy)
    const pmCandidates = checkoutIdxs.filter((_, i) => i % 2 === 0);
    for (let i = 0; i < pmCandidates.length; i++) {
      const idx = pmCandidates[i];
      const j = jobs[idx];
      j.pmStartMin = j.cleanEndMin + 10;
      j.pmEndMin = j.pmStartMin + PM_DURATION_MIN;
      j.pmIdx = i % this.options.pmCount;
    }

    this._jobs = jobs;
    this._checkoutIdxs = checkoutIdxs;
    this._longStayIdxs = longStayIdxs;

    // 7. Spawn entity DOM (guests/cleaners/pms) — start hidden, will be
    //    positioned by _tick.
    this._buildEntities();
  }

  _buildEntities() {
    this._g.guests.innerHTML = "";
    this._g.workers.innerHTML = "";
    this._g.lines.innerHTML = "";

    // Guest entities = one per (initialGuest OR nextGuest) — they appear/leave
    // at different times. Each guest knows its unit + window.
    this.guests = [];
    for (const j of this._jobs) {
      if (j.initialGuest) {
        this.guests.push(this._makeGuest({
          name: j.initialGuest, unit: j.unit,
          fromMin: null,            // present from start
          toMin: j.longStay ? null : j.checkoutMin,
        }));
      }
      if (j.nextGuest) {
        this.guests.push(this._makeGuest({
          name: j.nextGuest, unit: j.unit,
          fromMin: j.arrivalMin, toMin: null,
        }));
      }
    }

    // Workers (cleaners + PMs). Each compiles its own ordered task list.
    this.workers = [];
    for (let i = 0; i < this.options.cleanerCount; i++) {
      const tasks = this._jobs
        .filter((j) => j.cleanerIdx === i)
        .map((j) => ({ kind: "clean", unit: j.unit, fromMin: j.cleanStartMin, toMin: j.cleanEndMin }))
        .sort((a, b) => a.fromMin - b.fromMin);
      this.workers.push(this._makeWorker({
        role: "cleaner", idx: i,
        name: CLEANER_NAMES[i % CLEANER_NAMES.length],
        color: COLORS.cleaners[i % COLORS.cleaners.length],
        tasks,
      }));
    }
    for (let i = 0; i < this.options.pmCount; i++) {
      const tasks = this._jobs
        .filter((j) => j.pmIdx === i)
        .map((j) => ({ kind: "pm", unit: j.unit, fromMin: j.pmStartMin, toMin: j.pmEndMin }))
        .sort((a, b) => a.fromMin - b.fromMin);
      if (tasks.length === 0) continue;
      this.workers.push(this._makeWorker({
        role: "pm", idx: i,
        name: PM_NAMES[i % PM_NAMES.length],
        color: COLORS.pm,
        tasks,
      }));
    }
  }

  _makeGuest({ name, unit, fromMin, toMin }) {
    const { guestRadius } = this.options;
    const g = mk(this._g.guests, "g", { "data-guest": name });
    const halo = mk(g, "circle", { r: guestRadius * 2.0, fill: COLORS.guest, opacity: "0.18" });
    const dot  = mk(g, "circle", { r: guestRadius, fill: COLORS.guest });
    const label = mk(g, "text", {
      x: guestRadius + 6, y: -guestRadius - 4,
      "font-size": 10, "font-weight": 500,
      "font-family": "var(--font-display, Outfit, sans-serif)", fill: COLORS.guestLabel,
    }, name);
    g.setAttribute("opacity", "0");
    return { name, unit, fromMin, toMin, dom: { g, dot, label, halo } };
  }

  _makeWorker({ role, idx, name, color, tasks }) {
    const { workerRadius } = this.options;
    const g = mk(this._g.workers, "g", { "data-worker": name });
    const halo = mk(g, "circle", { r: workerRadius * 2.6, fill: color, opacity: "0.10" });
    const ring = mk(g, "circle", {
      r: workerRadius + 4, fill: "none", stroke: color, "stroke-width": "1.5",
      opacity: "0.65", transform: "rotate(-90)",
    });
    const C = 2 * Math.PI * (workerRadius + 4);
    ring.setAttribute("stroke-dasharray", `0 ${C}`);
    const dot = mk(g, "circle", { r: workerRadius, fill: color });
    const label = mk(g, "text", {
      x: workerRadius + 8, y: -workerRadius - 4,
      "font-size": 11, "font-weight": 500,
      "font-family": "var(--font-display, Outfit, sans-serif)", fill: color,
    }, name);
    g.setAttribute("opacity", "0");

    const line = mk(this._g.lines, "path", {
      stroke: color, "stroke-width": "1.2", "stroke-linecap": "round",
      fill: "none", opacity: "0",
    });

    return { role, idx, name, color, tasks, dom: { g, dot, ring, label, line, halo }, ringC: C };
  }

  _renderInitialState() {
    // Park initial guests at their units (visible at t=0)
    for (const guest of this.guests) {
      if (guest.fromMin === null) {
        const p = this.properties[guest.unit];
        guest.dom.g.setAttribute("transform", `translate(${p.x + 12}, ${p.y - 12})`);
        guest.dom.g.setAttribute("opacity", "1");
      }
    }
    // Park workers offscreen on the left edge initially
    for (let i = 0; i < this.workers.length; i++) {
      const w = this.workers[i];
      const yStart = 100 + i * 80;
      w._lastPos = { x: -60, y: yStart };
      w.dom.g.setAttribute("transform", `translate(-60, ${yStart})`);
      w.dom.g.setAttribute("opacity", "0");
    }
  }

  _renderClock() {
    this._g.clock.innerHTML = "";
    this._clockText = mk(this._g.clock, "text", {
      x: 20, y: 28,
      "font-size": 12, "font-weight": 500, "letter-spacing": "0.04em",
      "font-family": "var(--font-body, Outfit, sans-serif)", fill: COLORS.clockText,
    }, "");
  }

  start() {
    if (this.running) return;
    if (this._mq.matches) { this._drawStatic(); return; }
    this.running = true;
    const targetFrameMs = 1000 / Math.max(1, this.options.fps);
    let lastFrameT = 0;
    const loop = (now) => {
      if (!this.running) return;
      if (!this.options.paused && now - lastFrameT >= targetFrameMs) {
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
    // Reduced motion: park everything as if it were 12:00pm
    for (const w of this.workers) w.dom.g.setAttribute("opacity", "0");
    this._renderInitialState();
  }

  /** Map demo timestamp → simulated minute-of-day. */
  _minutesFor(now) {
    const elapsedMs = now - this._dayStartT;
    if (elapsedMs >= this.options.dayMs) {
      // Day ended — reset
      this.options.seed = (this.options.seed * 1103515245 + 12345) >>> 0;
      this._setupDay();
      return DAY_START_MIN;
    }
    return DAY_START_MIN + (elapsedMs / this.options.dayMs) * DAY_SPAN_MIN;
  }

  _tick(now) {
    const minute = this._minutesFor(now);
    this._updateClock(minute);
    this._updateGuests(minute);
    this._updateWorkers(minute, now);
  }

  _updateClock(minute) {
    const hh24 = Math.floor(minute / 60);
    const mm   = Math.floor(minute % 60);
    const ampm = hh24 < 12 ? "AM" : "PM";
    const hh   = hh24 > 12 ? hh24 - 12 : hh24 === 0 ? 12 : hh24;
    this._clockText.textContent = `${hh}:${String(mm).padStart(2, "0")} ${ampm}`;
  }

  _updateGuests(minute) {
    const ANIM_MIN = 25;   // arrive/depart animation duration in simulated minutes
    for (const guest of this.guests) {
      const p = this.properties[guest.unit];
      const hereXY = { x: p.x + 12, y: p.y - 12 };

      const isPresent = (guest.fromMin === null || minute >= guest.fromMin) &&
                        (guest.toMin === null   || minute <  guest.toMin);
      if (isPresent) {
        // Arrival animation (slides in from nearest edge)
        if (guest.fromMin !== null && minute < guest.fromMin + ANIM_MIN) {
          const t = (minute - guest.fromMin) / ANIM_MIN;
          const edge = this._edgePointToward(hereXY);
          const x = lerp(edge.x, hereXY.x, easeOutCubic(t));
          const y = lerp(edge.y, hereXY.y, easeOutCubic(t));
          guest.dom.g.setAttribute("transform", `translate(${x}, ${y})`);
          guest.dom.g.setAttribute("opacity", String(t));
        } else {
          guest.dom.g.setAttribute("transform", `translate(${hereXY.x}, ${hereXY.y})`);
          guest.dom.g.setAttribute("opacity", "1");
        }
      } else {
        // Departure animation
        if (guest.toMin !== null && minute >= guest.toMin && minute < guest.toMin + ANIM_MIN) {
          const t = (minute - guest.toMin) / ANIM_MIN;
          const edge = this._edgePointToward(hereXY);
          const x = lerp(hereXY.x, edge.x, easeOutCubic(t));
          const y = lerp(hereXY.y, edge.y, easeOutCubic(t));
          guest.dom.g.setAttribute("transform", `translate(${x}, ${y})`);
          guest.dom.g.setAttribute("opacity", String(1 - t));
        } else {
          guest.dom.g.setAttribute("opacity", "0");
        }
      }
    }
  }

  _updateWorkers(minute, now) {
    const TRAVEL_MIN = 20;
    for (const w of this.workers) {
      // Find the current task: in-progress one, or pending/idle
      let current = null, next = null;
      for (const t of w.tasks) {
        if (minute >= t.fromMin && minute < t.toMin) { current = t; break; }
        if (minute < t.fromMin) { next = t; break; }
      }

      if (current) {
        // At the unit: parked + progress ring
        const p = this.properties[current.unit];
        w.dom.g.setAttribute("transform", `translate(${p.x}, ${p.y})`);
        w.dom.g.setAttribute("opacity", "1");
        w.dom.line.setAttribute("opacity", "0");
        const prog = (minute - current.fromMin) / (current.toMin - current.fromMin);
        w.dom.ring.setAttribute("stroke-dasharray", `${prog * w.ringC} ${w.ringC}`);
        w._lastPos = { x: p.x, y: p.y };
      } else if (next && minute >= next.fromMin - TRAVEL_MIN) {
        // Traveling to next task (animate over the last TRAVEL_MIN minutes)
        const p = this.properties[next.unit];
        const t = (minute - (next.fromMin - TRAVEL_MIN)) / TRAVEL_MIN;
        const from = w._lastPos || { x: -60, y: p.y };
        const ctrl = bezierCtrl(from, p, this.rand);
        const pos = quad(from, ctrl, p, easeInOutCubic(t));
        w.dom.g.setAttribute("transform", `translate(${pos.x}, ${pos.y})`);
        w.dom.g.setAttribute("opacity", "1");
        w.dom.ring.setAttribute("stroke-dasharray", `0 ${w.ringC}`);
        // Fade the travel line
        w.dom.line.setAttribute("d", `M ${from.x} ${from.y} Q ${ctrl.x} ${ctrl.y} ${p.x} ${p.y}`);
        const op = t < 0.15 ? t/0.15 : t > 0.85 ? (1-t)/0.15 : 1;
        w.dom.line.setAttribute("opacity", String(op * 0.55));
      } else if (next) {
        // Idle waiting for first/next task — fade out gently
        w.dom.line.setAttribute("opacity", "0");
        w.dom.g.setAttribute("opacity", "0");
      } else {
        // No more tasks today — exit to nearest edge
        if (w._lastPos && !w._exitTo) {
          w._exitTo = this._edgePointToward(w._lastPos);
          w._exitStart = minute;
        }
        if (w._exitTo) {
          const t = Math.min(1, (minute - w._exitStart) / TRAVEL_MIN);
          const pos = {
            x: lerp(w._lastPos.x, w._exitTo.x, t),
            y: lerp(w._lastPos.y, w._exitTo.y, t),
          };
          w.dom.g.setAttribute("transform", `translate(${pos.x}, ${pos.y})`);
          w.dom.g.setAttribute("opacity", String(1 - t));
          w.dom.line.setAttribute("d", `M ${w._lastPos.x} ${w._lastPos.y} L ${w._exitTo.x} ${w._exitTo.y}`);
          w.dom.line.setAttribute("opacity", String((1 - t) * 0.45));
        }
      }
    }
  }

  _edgePointToward({ x, y }) {
    // Nearest viewport edge
    const dl = x, dr = this.w - x, dt = y, db = this.h - y;
    const m = Math.min(dl, dr, dt, db);
    if (m === dl) return { x: -60, y };
    if (m === dr) return { x: this.w + 60, y };
    if (m === dt) return { x, y: -60 };
    return { x, y: this.h + 60 };
  }

  update(partial) {
    this.options = { ...this.options, ...partial };
    const rebuildKeys = [
      "propertyCount", "cleanerCount", "pmCount", "occupancyAtStart",
      "longStayCount", "seed",
    ];
    if (rebuildKeys.some((k) => k in partial)) {
      this._layout();
    }
    if ("fps" in partial && this.running) {
      this.stop(); this.start();
    }
  }

  reshuffle() {
    this.options.seed = Math.floor(Math.random() * 1e6);
    this._layout();
  }
}

/* ---------- tiny helpers ---------- */
function mk(parent, tag, attrs = {}, text) {
  const el = document.createElementNS(ns, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text !== undefined) el.textContent = text;
  parent.appendChild(el);
  return el;
}
function shuffle(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
function lerp(a, b, t) { return a + (b - a) * t; }
function easeOutCubic(t)  { const u = 1 - t; return 1 - u * u * u; }
function easeInOutCubic(t){ return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2; }

function bezierCtrl(from, to, rand) {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const sign = (rand() > 0.5 ? 1 : -1);
  const depth = sign * Math.min(80, len * 0.18);
  return { x: mx + (-dy / len) * depth, y: my + (dx / len) * depth };
}
function quad(p0, p1, p2, t) {
  const u = 1 - t;
  return {
    x: u*u*p0.x + 2*u*t*p1.x + t*t*p2.x,
    y: u*u*p0.y + 2*u*t*p1.y + t*t*p2.y,
  };
}
