// Hotel-day routing scene — multi-day looping simulation.
//
// Generates a multi-day schedule UPFRONT (default: 3 days × 14h = 42h
// of simulated time mapped onto e.g. 60s of demo time, then loops
// seamlessly because the schedule is designed to match at the boundary).
//
// Actors:
//   • Guests (green dots, named "Simon P. (guest+3)", etc.)
//       — Some are long-stay across the whole cycle
//       — Others cycle: each cycling unit gets a chain of guests, and the
//         last guest's checkout happens at the loop boundary so day 1's
//         start state == day N's end state. Wrap is seamless.
//
//   • Cleaners (brand-orange / brand-blue dots, "Heather", "Andrea", ...)
//       — Each has their own non-overlapping unit list
//       — Appear in "sessions" per day (a session = continuous burst of
//         tasks). Between sessions they exit to the nearest edge and
//         disappear; they re-enter the next day if they have tasks.
//       — On a quiet day with few checkouts, only some cleaners come in.
//
//   • PMs ("John (PM)") — same session model, optional check after
//     cleaning on a subset of units.
//
// Travel paths use a quadratic bezier with control points COMPUTED ONCE
// at plan-time (not per-frame) — fixes the curve-flicker bug.

const PROPERTY_NAMES = [
  "8488 Cornish St",  "1250 Burnaby St",  "183 Keefer Pl",
  "33 Smithe St",     "550 Taylor St",    "Smithe 33",
  "506 Bute St",      "1603 W Pender",    "885 W Cordova",
  "F1113 N Van",      "Keefer 716",       "A203 / Anthony",
];

const CLEANER_NAMES = ["Heather", "Andrea", "Mei", "Olivia"];
const PM_NAMES      = ["John (PM)", "Maria (PM)"];

const GUEST_NAMES = [
  "Simon P. (guest+3)", "John R. (guest+1)", "Val N. (guest+4)", "Kevin W. (guest+1)",
  "Maya P. (guest+2)",  "Tom B. (guest+1)",  "Lisa K. (guest+3)", "Mark D. (guest+2)",
  "Jenny H. (guest+1)", "Carlos M. (guest+4)", "Nora F. (guest+2)", "Otis B. (guest+1)",
  "Diana L. (guest+3)", "Sam W. (guest+2)",  "Ari T. (guest+1)",
];

const COLORS = {
  property:      "#2A1810",
  propertyLabel: "rgba(43, 24, 16, 0.55)",
  guest:         "#2E9E5A",
  guestLabel:    "rgba(15, 90, 50, 0.85)",
  pm:            "#7A4E1A",
  cleaners:      ["#FFA000", "#006FFE", "#C97A4F", "#AE45CA"],
  clockText:     "rgba(43, 24, 16, 0.70)",
};

const DEFAULT_OPTIONS = {
  propertyCount:    7,
  cleanerCount:     2,
  pmCount:          1,
  longStayCount:    2,
  dayCount:         7,      // multi-day cycle length
  dayMs:           15000,   // ONE day = 15s, so 7 days ≈ 105s by default
  /** Per-day occupancy target (% of total units occupied at NIGHT). The
   *  planner builds a per-night occupancy matrix to hit these column sums
   *  exactly (clamped to feasible range). Wraps seamlessly: D7-end == D1-start
   *  occupancy state, by construction. */
  targetOccupancy: [60, 100, 90, 75, 70, 80, 58],
  fps:             30,
  seed:             1,
  paused:           false,

  // Visual
  propertyRadius:   3.5,
  guestRadius:      5,
  workerRadius:     6,

  // Timing constants (in simulated minutes)
  cleanGap:        10,
  cleanDuration:   90,
  pmDelay:         10,
  pmDuration:      30,
  guestArriveBuf:  30,
  travelMin:       20,     // how long an enter/leave/move animation takes
  longGap:         180,    // gap between sessions that's "long" → exit+re-enter
};

const DAY_START_MIN = 9 * 60;
const DAY_END_MIN   = 23 * 60;
const DAY_SPAN_MIN  = DAY_END_MIN - DAY_START_MIN;     // 14h

const CHECKOUT_TIMES_DEFAULT = [9, 10, 11, 12];         // hour-of-day options
const ARRIVAL_TIMES_DEFAULT  = [16, 17, 18, 22, 22.75]; // hour-of-day options

const ns = "http://www.w3.org/2000/svg";

export class CleanerScene {
  constructor(svg, options = {}) {
    this.svg = svg;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.running = false;
    this._mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    // Below this width the scene is hidden by CSS — we also pause the rAF
    // loop so we don't burn CPU on something nobody can see.
    this._mqSmall = window.matchMedia("(max-width: 900px)");
    this._mqSmall.addEventListener("change", (e) => {
      if (e.matches) this._pauseForSmallViewport();
      else this._resumeForSmallViewport();
    });
    // Resize: rAF-throttled lightweight reposition (NOT a full rebuild).
    // We only shift existing geometry by Δw/2 so the SVG never "stretches"
    // mid-drag. Heavy work (re-planning the day) is reserved for explicit
    // option/seed changes via update()/reshuffle().
    this._onResize = () => {
      if (this._resizePending) return;
      this._resizePending = true;
      requestAnimationFrame(() => {
        this._resizePending = false;
        this._fastResize();
      });
    };
    window.addEventListener("resize", this._onResize);
    this._build();
  }

  /** Synchronous, cheap resize. Re-fits the SVG viewBox to the new size
   *  and translates all cached geometry by the center-X delta. No PRNG,
   *  no DOM rebuilding, no plan regeneration. Property positions stay
   *  anchored to the central axis. */
  _fastResize() {
    if (!this.properties) return;     // not built yet
    const r = this.svg.getBoundingClientRect();
    const newW = Math.max(800, r.width);
    const newH = Math.max(500, r.height);
    if (newW === this.w && newH === this.h) return;
    const dx = (newW - this.w) / 2;
    this.w = newW;
    this.h = newH;
    this.svg.setAttribute("viewBox", `0 0 ${this.w} ${this.h}`);

    // Update properties (signedDx is invariant; absolute x re-derives)
    for (let i = 0; i < this.properties.length; i++) {
      const p = this.properties[i];
      p.x = this.w / 2 + p.signedDx;
      p.y = p.dy;
      const circle = this._g.properties.children[i * 2];
      const text   = this._g.properties.children[i * 2 + 1];
      if (circle) { circle.setAttribute("cx", p.x); circle.setAttribute("cy", p.y); }
      if (text)   { text.setAttribute("x", p.x + 8); text.setAttribute("y", p.y + 3); }
    }

    // Translate cached worker geometry by the same dx.
    // (t.travelFrom is a reference to either session.enterFrom or to a
    // property — properties already got their new x above, so only the
    // standalone points need shifting here.)
    for (const w of this.workers || []) {
      for (const s of w.sessions) {
        s.enterFrom.x += dx;
        s.exitTo.x   += dx;
        s.exitCtrl.x += dx;
        for (const t of s.tasks) t.travelCtrl.x += dx;
      }
    }

    // Re-render all entities at the current minute so we don't see a frame
    // of stale positions.
    this._tick(performance.now());
  }

  _pauseForSmallViewport() {
    this._hiddenBySmall = true;
    if (this.running) { this.stop(); this._wasRunningBeforeSmall = true; }
  }
  _resumeForSmallViewport() {
    this._hiddenBySmall = false;
    if (this._wasRunningBeforeSmall) {
      this._wasRunningBeforeSmall = false;
      this.start();
    }
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
    this._layout({ preserveTime: false });
  }

  /** Re-build properties / schedule / DOM entities.
   *  preserveTime: keep the current simulated minute (used on resize so the
   *  animation continues from where it was — not restart from 9:00am). */
  _layout({ preserveTime = false } = {}) {
    const carryMinute = (preserveTime && this.totalMin !== undefined)
      ? this._minutesFor(performance.now())
      : null;

    const r = this.svg.getBoundingClientRect();
    this.w = Math.max(800, r.width);
    this.h = Math.max(500, r.height);
    this.svg.setAttribute("viewBox", `0 0 ${this.w} ${this.h}`);
    this.rand = mulberry32(this.options.seed);
    this._placeProperties();
    this._planCycle();
    this._renderClock();

    if (carryMinute !== null) {
      // Anchor the clock so the current minute is preserved across the rebuild
      const cycleMs = this.options.dayMs * this.options.dayCount;
      this._cycleStartT = performance.now() - (carryMinute / this.totalMin) * cycleMs;
    } else {
      this._cycleStartT = performance.now();
    }

    // Paint immediately so we don't show a frame of opacity:0 before
    // the next rAF tick (especially noticeable mid-resize).
    if (this.workers && this.guests) this._tick(performance.now());
  }

  // ---------- properties ----------
  // Each property has a STABLE position anchored to the central vertical
  // axis (signedDx: left or right of center) and to the top of the hero
  // (dy: pixels from top). On resize, only the X gets recomputed
  // (centerX + signedDx) — the property stays "pinned" relative to where
  // it sat before. Layout doesn't reshuffle.
  _placeProperties() {
    this._g.properties.innerHTML = "";
    const { propertyCount, propertyRadius } = this.options;

    // Placement bands are computed from the CURRENT viewport so all dots
    // sit inside the visible area with a 50px safe-zone from each edge.
    // After placement, signedDx is stored on each property and is anchored
    // to the central axis — so window resize after load just translates
    // existing dots (some may drift off-screen if the window shrinks; user
    // accepts this until next refresh).
    const EDGE_PAD = 50;
    const REQUESTED_SAFE = 460;   // ideal central-text safe zone (≥ H1 half)
    const innerLimit = this.w / 2 - EDGE_PAD;
    const SIDE_MAX = innerLimit;
    // If the viewport is too narrow to honor REQUESTED_SAFE plus a placement
    // band, clamp SAFE_HALF down — properties will overlap central text a
    // bit on small screens (better than going off-screen at refresh).
    const SAFE_HALF = Math.min(REQUESTED_SAFE, Math.max(140, innerLimit - 80));
    const TOP_PAD   = 70;
    const VERT_SPAN = 420;

    this.properties = [];
    let attempts = 0;
    while (this.properties.length < propertyCount && attempts < propertyCount * 60) {
      attempts++;
      const side = this.rand() > 0.5 ? 1 : -1;
      // sqrt biases t toward 1 → more dots near the outer edge of the band
      const t = Math.sqrt(this.rand());
      const signedDx = side * (SAFE_HALF + t * (SIDE_MAX - SAFE_HALF));
      const dy = TOP_PAD + this.rand() * VERT_SPAN;
      if (this.properties.some((p) =>
        Math.abs(p.signedDx - signedDx) < 90 && Math.abs(p.dy - dy) < 55)) continue;
      this.properties.push({
        idx: this.properties.length,
        signedDx, dy,                              // stable; survives resize
        x: this.w / 2 + signedDx, y: dy,            // derived screen coords
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

  // ---------- cycle planner ----------
  // Drives night-occupancy from `options.targetOccupancy[d]` (one % per
  // day). Algorithm:
  //   1) Pick longStayCount units to be occupied EVERY night (they count
  //      toward every day's target).
  //   2) For each night d, compute target cycling-occupancy = roundedTarget
  //      − longStay. Pick that many random cycling units to be ON at night d.
  //   3) For each cycling unit, scan its 7-bit occupancy row and extract
  //      maximal runs of ON nights → those are guest "stays". Wrap-merge
  //      if the row's first and last nights are both ON.
  //   4) Each stay → guest visit (with optional split for wrap stays) +
  //      one cleaning job scheduled after the stay's checkout.
  // This guarantees end-of-day occupancy matches the targets exactly, and
  // by construction the cycle wraps seamlessly (state at totalMin == state
  // at 0).
  _planCycle() {
    const o = this.options;
    const N = this.properties.length;
    const days = o.dayCount;
    this.totalMin = days * DAY_SPAN_MIN;

    // Per-day target headcount (clamped to feasible)
    const headTargets = [];
    for (let d = 0; d < days; d++) {
      const pct = o.targetOccupancy[d % o.targetOccupancy.length] ?? 70;
      headTargets.push(Math.max(0, Math.min(N, Math.round(N * pct / 100))));
    }

    // 1) Long-stay units occupy ALL nights → count toward every target
    const allIdxs = shuffle([...Array(N).keys()], this.rand);
    const longStayCount = Math.min(o.longStayCount, Math.min(...headTargets));
    const longStayUnits = allIdxs.slice(0, longStayCount);
    const cyclingUnits  = allIdxs.slice(longStayCount);
    const cyclingN      = cyclingUnits.length;

    // Per-night target cycling-occupancy
    const cycTargets = headTargets.map((t) => Math.max(0, Math.min(cyclingN, t - longStayCount)));

    // 2) Occupancy matrix [cyclingUnit][night] — each column has exactly
    //    `cycTargets[d]` true values.
    const matrix = Array.from({ length: cyclingN }, () => new Array(days).fill(false));
    for (let d = 0; d < days; d++) {
      const pool = shuffle([...Array(cyclingN).keys()], this.rand);
      for (let i = 0; i < cycTargets[d]; i++) matrix[pool[i]][d] = true;
    }

    // Name pool
    const namePool = shuffle([...GUEST_NAMES], this.rand);

    // ---- collect events ----
    const cleanJobs = [];
    const guestVisits = [];

    // Long-stay guests (present always)
    for (const u of longStayUnits) {
      guestVisits.push({ unit: u, name: namePool.pop() || "Guest", fromMin: null, toMin: null });
    }

    // 3) For each cycling unit, derive stays from its row.
    for (let cu = 0; cu < cyclingN; cu++) {
      const unitIdx = cyclingUnits[cu];
      const row = matrix[cu];

      // Find segments (maximal runs of true). Segment = [startNight, endNight] inclusive.
      const segments = [];
      let i = 0;
      while (i < days) {
        if (row[i]) {
          const start = i;
          while (i < days && row[i]) i++;
          segments.push([start, i - 1]);
        } else {
          i++;
        }
      }

      // Wrap-merge: if first night & last night both ON in distinct segments,
      // they describe one stay spanning the cycle boundary.
      let wrapMerged = false;
      if (segments.length >= 2 && segments[0][0] === 0 && segments[segments.length - 1][1] === days - 1) {
        const last = segments.pop();
        segments[0] = [last[0], days + segments[0][1]];   // end ≥ days means wraps
        wrapMerged = true;
      }
      // Single segment covering all nights: treat as a non-checkout guest
      // (essentially a 7-night-stay across the wrap with no checkout in this cycle).
      const fullCovered = segments.length === 1 && segments[0][0] === 0 && segments[0][1] === days - 1;

      // Pick distinct random hours per stay
      for (const seg of segments) {
        const startNight = seg[0];
        const endNightRaw = seg[1];
        const guestName = namePool.pop() || "Guest";

        if (fullCovered) {
          // Always-on cycling unit — emulate a long-stay for this cycle
          guestVisits.push({ unit: unitIdx, name: guestName, fromMin: null, toMin: null });
          break;
        }

        // A stay needs split-rendering whenever it crosses the cycle boundary
        // — either because wrap-merge extended endNightRaw past `days`, OR
        // because the natural checkout day (endNight+1) wraps to 0.
        const mergedWrap = endNightRaw >= days;
        const endNight = mergedWrap ? (endNightRaw - days) : endNightRaw;
        const checkoutCrossesBoundary = (endNight + 1) >= days;
        const needsSplit = mergedWrap || checkoutCrossesBoundary;

        const arrHour = ARRIVAL_TIMES_DEFAULT[Math.floor(this.rand() * ARRIVAL_TIMES_DEFAULT.length)];
        const coHour  = CHECKOUT_TIMES_DEFAULT[Math.floor(this.rand() * CHECKOUT_TIMES_DEFAULT.length)];

        const arrivalMin  = startNight * DAY_SPAN_MIN + (arrHour * 60 - DAY_START_MIN);
        const checkoutMin = ((endNight + 1) % days) * DAY_SPAN_MIN + (coHour * 60 - DAY_START_MIN);

        if (needsSplit) {
          // Visible from arrivalMin to end of cycle (slide-in anim), then
          // present-from-start-of-next-cycle until checkoutMin (no anim).
          guestVisits.push({ unit: unitIdx, name: guestName, fromMin: arrivalMin, toMin: this.totalMin });
          guestVisits.push({ unit: unitIdx, name: guestName, fromMin: null, toMin: checkoutMin });
        } else {
          guestVisits.push({ unit: unitIdx, name: guestName, fromMin: arrivalMin, toMin: checkoutMin });
        }

        // Cleaning is scheduled AFTER the checkout from this stay.
        // For wrap stays, the checkout lands in the next cycle's first morning
        // → in cycle-time that's "minute checkoutMin" of the current cycle
        // (small number, near 0). PM gets a chance after.
        const cleanStart = checkoutMin + o.cleanGap;
        const cleanEnd   = cleanStart + o.cleanDuration;
        const wantPm = this.rand() < 0.35;
        const pmStart = wantPm ? cleanEnd + o.pmDelay : null;
        const pmEnd   = wantPm ? pmStart + o.pmDuration : null;
        cleanJobs.push({
          unit: unitIdx, cleanStart, cleanEnd, pmStart, pmEnd,
          dayIdx: Math.floor(cleanStart / DAY_SPAN_MIN),
        });
      }
    }

    // 4) Assign cleaning jobs to cleaners (round-robin by cleanStart order)
    cleanJobs.sort((a, b) => a.cleanStart - b.cleanStart);
    const cleanerTasks = Array.from({ length: o.cleanerCount }, () => []);
    for (let i = 0; i < cleanJobs.length; i++) {
      const cIdx = i % o.cleanerCount;
      cleanerTasks[cIdx].push({
        kind: "clean", unit: cleanJobs[i].unit,
        cleanStart: cleanJobs[i].cleanStart, cleanEnd: cleanJobs[i].cleanEnd,
        dayIdx: cleanJobs[i].dayIdx,
      });
    }
    // PM jobs to PMs (only those with pmStart != null)
    const pmJobsFlat = cleanJobs
      .filter((j) => j.pmStart != null)
      .map((j) => ({ kind: "pm", unit: j.unit, cleanStart: j.pmStart, cleanEnd: j.pmEnd, dayIdx: j.dayIdx }));
    pmJobsFlat.sort((a, b) => a.cleanStart - b.cleanStart);
    const pmTasks = Array.from({ length: o.pmCount }, () => []);
    for (let i = 0; i < pmJobsFlat.length; i++) {
      const pIdx = i % o.pmCount;
      pmTasks[pIdx].push(pmJobsFlat[i]);
    }

    // 5) Build worker entities with pre-computed travel data + sessions
    this._buildEntities({
      cleanerTasks, pmTasks, guestVisits,
    });
  }

  _buildEntities({ cleanerTasks, pmTasks, guestVisits }) {
    this._g.guests.innerHTML = "";
    this._g.workers.innerHTML = "";
    this._g.lines.innerHTML = "";

    // ---- guests ----
    this.guests = guestVisits.map((v) => this._makeGuest(v));

    // ---- workers ----
    this.workers = [];
    for (let i = 0; i < this.options.cleanerCount; i++) {
      const tasks = cleanerTasks[i];
      if (tasks.length === 0) continue;   // cleaner not used today
      this.workers.push(this._makeWorker({
        role: "cleaner", idx: i,
        name: CLEANER_NAMES[i % CLEANER_NAMES.length],
        color: COLORS.cleaners[i % COLORS.cleaners.length],
        tasks,
      }));
    }
    for (let i = 0; i < this.options.pmCount; i++) {
      const tasks = pmTasks[i];
      if (tasks.length === 0) continue;
      this.workers.push(this._makeWorker({
        role: "pm", idx: i,
        name: PM_NAMES[i % PM_NAMES.length],
        color: COLORS.pm,
        tasks,
      }));
    }
  }

  _makeGuest(v) {
    const { guestRadius } = this.options;
    const g = mk(this._g.guests, "g", { "data-guest": v.name });
    mk(g, "circle", { r: guestRadius * 2.0, fill: COLORS.guest, opacity: "0.18" });
    mk(g, "circle", { r: guestRadius, fill: COLORS.guest });
    mk(g, "text", {
      x: guestRadius + 6, y: -guestRadius - 4,
      "font-size": 10, "font-weight": 500,
      "font-family": "var(--font-display, Outfit, sans-serif)", fill: COLORS.guestLabel,
    }, v.name);
    g.setAttribute("opacity", "0");
    return { ...v, dom: g };
  }

  _makeWorker({ role, idx, name, color, tasks }) {
    const { workerRadius, travelMin, longGap } = this.options;
    const g = mk(this._g.workers, "g", { "data-worker": name });
    mk(g, "circle", { r: workerRadius * 2.6, fill: color, opacity: "0.10" });
    const ring = mk(g, "circle", {
      r: workerRadius + 4, fill: "none", stroke: color, "stroke-width": "1.5",
      opacity: "0.65", transform: "rotate(-90)",
    });
    const C = 2 * Math.PI * (workerRadius + 4);
    ring.setAttribute("stroke-dasharray", `0 ${C}`);
    mk(g, "circle", { r: workerRadius, fill: color });
    mk(g, "text", {
      x: workerRadius + 8, y: -workerRadius - 4,
      "font-size": 11, "font-weight": 500,
      "font-family": "var(--font-display, Outfit, sans-serif)", fill: color,
    }, name);
    g.setAttribute("opacity", "0");

    const line = mk(this._g.lines, "path", {
      stroke: color, "stroke-width": "1.2", "stroke-linecap": "round",
      fill: "none", opacity: "0",
    });

    // Group tasks into "sessions" — a session is a chain of tasks where
    // consecutive gaps are < longGap. Between sessions, the worker exits
    // and reappears.
    const sessions = [];
    let cur = null;
    for (const t of tasks) {
      if (!cur || t.cleanStart - cur.tasks[cur.tasks.length - 1].cleanEnd > longGap) {
        cur = { tasks: [t] };
        sessions.push(cur);
      } else {
        cur.tasks.push(t);
      }
    }

    // Pre-compute travel geometry for each task in each session (control
    // points fixed at plan time → no flicker during rendering).
    for (const s of sessions) {
      // Entry point: nearest edge to the first task's unit
      const firstUnit = this.properties[s.tasks[0].unit];
      s.enterFrom = nearestEdgePoint(firstUnit, this.w, this.h);
      for (let i = 0; i < s.tasks.length; i++) {
        const t = s.tasks[i];
        const dest = this.properties[t.unit];
        const prev = (i === 0) ? null : s.tasks[i - 1];
        const from = (i === 0) ? s.enterFrom : this.properties[prev.unit];
        // Travel always lasts up to `travelMin` minutes, but never starts
        // before the previous task's cleanEnd (otherwise the worker would
        // teleport mid-clean). If the gap to the previous task is smaller
        // than travelMin, the travel just lasts the whole gap. If larger,
        // the worker idles at prev.unit until travelStart.
        t.travelStart = (i === 0)
          ? t.cleanStart - travelMin
          : Math.max(prev.cleanEnd, t.cleanStart - travelMin);
        t.travelFrom = from;
        t.travelCtrl = bezierCtrl(from, dest, this.rand);
        t.prevUnit = (i === 0) ? null : prev.unit;   // remembered for idle render
      }
      const lastUnit = this.properties[s.tasks[s.tasks.length - 1].unit];
      s.exitTo = nearestEdgePoint(lastUnit, this.w, this.h);
      s.exitStart = s.tasks[s.tasks.length - 1].cleanEnd;
      s.exitEnd   = s.exitStart + travelMin;
      s.exitCtrl  = bezierCtrl(lastUnit, s.exitTo, this.rand);
    }

    return { role, idx, name, color, tasks, sessions, dom: { g, ring, line }, ringC: C };
  }

  // ---------- clock + occupancy ----------
  _renderClock() {
    this._g.clock.innerHTML = "";
    this._clockText = mk(this._g.clock, "text", {
      x: 20, y: 28,
      "font-size": 12, "font-weight": 500, "letter-spacing": "0.04em",
      "font-family": "var(--font-body, Outfit, sans-serif)", fill: COLORS.clockText,
    }, "");
    this._occText = mk(this._g.clock, "text", {
      x: 20, y: 46,
      "font-size": 11, "font-weight": 400, "letter-spacing": "0.04em",
      "font-family": "var(--font-body, Outfit, sans-serif)", fill: COLORS.clockText,
    }, "");
  }

  _updateOccupancy(minute) {
    // Count unique units that currently have a present guest
    const occupied = new Set();
    for (const g of this.guests) {
      const startedBefore = g.fromMin === null || minute >= g.fromMin;
      const endsAfter     = g.toMin   === null || minute <  g.toMin;
      if (startedBefore && endsAfter) occupied.add(g.unit);
    }
    const pct = this.properties.length === 0
      ? 0
      : Math.round(occupied.size / this.properties.length * 100);
    this._occText.textContent =
      `Occupancy: ${pct}%  (${occupied.size}/${this.properties.length})`;
  }

  // ---------- runtime ----------
  start() {
    if (this.running) return;
    if (this._mq.matches) { this._drawStatic(); return; }
    if (this._mqSmall.matches) {
      this._wasRunningBeforeSmall = true;  // resume when viewport grows
      return;
    }
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
    // At minute 0 — long-stay guests visible, no workers
    for (const w of this.workers) w.dom.g.setAttribute("opacity", "0");
    for (const g of this.guests) {
      if (g.fromMin === null) {
        const p = this.properties[g.unit];
        g.dom.setAttribute("transform", `translate(${p.x + 12}, ${p.y - 12})`);
        g.dom.setAttribute("opacity", "1");
      } else {
        g.dom.setAttribute("opacity", "0");
      }
    }
  }

  _minutesFor(now) {
    const elapsedMs = now - this._cycleStartT;
    const cycleMs = this.options.dayMs * this.options.dayCount;
    const elapsedMins = (elapsedMs / cycleMs) * this.totalMin;
    // Loop the cycle without resetting state — entire schedule was designed
    // to be seamless at the boundary.
    return ((elapsedMins % this.totalMin) + this.totalMin) % this.totalMin;
  }

  _tick(now) {
    const minute = this._minutesFor(now);
    this._updateClock(minute);
    this._updateGuests(minute);
    this._updateWorkers(minute);
    this._updateOccupancy(minute);
  }

  _updateClock(minute) {
    const dayOfCycle = Math.floor(minute / DAY_SPAN_MIN) + 1;
    const minOfDay = (minute % DAY_SPAN_MIN) + DAY_START_MIN;
    const hh24 = Math.floor(minOfDay / 60);
    const mm   = Math.floor(minOfDay % 60);
    const ampm = hh24 < 12 ? "AM" : "PM";
    const hh   = hh24 > 12 ? hh24 - 12 : hh24 === 0 ? 12 : hh24;
    this._clockText.textContent = `Day ${dayOfCycle} · ${hh}:${String(mm).padStart(2,"0")} ${ampm}`;
  }

  _updateGuests(minute) {
    const ANIM = 25;
    for (const guest of this.guests) {
      const p = this.properties[guest.unit];
      const home = { x: p.x + 12, y: p.y - 12 };

      const startedBefore = guest.fromMin === null || minute >= guest.fromMin;
      const endsAfter     = guest.toMin   === null || minute <  guest.toMin;
      const isPresent     = startedBefore && endsAfter;

      if (isPresent) {
        // Slide-in animation (only for arrivals that have a defined fromMin)
        if (guest.fromMin !== null && minute < guest.fromMin + ANIM) {
          const t = (minute - guest.fromMin) / ANIM;
          const edge = nearestEdgePoint(home, this.w, this.h);
          const x = lerp(edge.x, home.x, easeOutCubic(t));
          const y = lerp(edge.y, home.y, easeOutCubic(t));
          guest.dom.setAttribute("transform", `translate(${x}, ${y})`);
          guest.dom.setAttribute("opacity", String(t));
        } else {
          guest.dom.setAttribute("transform", `translate(${home.x}, ${home.y})`);
          guest.dom.setAttribute("opacity", "1");
        }
      } else if (guest.toMin !== null && minute >= guest.toMin && minute < guest.toMin + ANIM) {
        // Slide-out
        const t = (minute - guest.toMin) / ANIM;
        const edge = nearestEdgePoint(home, this.w, this.h);
        const x = lerp(home.x, edge.x, easeOutCubic(t));
        const y = lerp(home.y, edge.y, easeOutCubic(t));
        guest.dom.setAttribute("transform", `translate(${x}, ${y})`);
        guest.dom.setAttribute("opacity", String(1 - t));
      } else {
        guest.dom.setAttribute("opacity", "0");
      }
    }
  }

  _updateWorkers(minute) {
    for (const w of this.workers) {
      // Find the active session (if any). A session covers from the first
      // task's travelStart through the post-last-task exit window.
      const session = w.sessions.find((s) =>
        minute >= s.tasks[0].travelStart && minute < s.exitEnd
      );
      if (!session) {
        w.dom.g.setAttribute("opacity", "0");
        w.dom.line.setAttribute("opacity", "0");
        continue;
      }

      // Find the first task that hasn't finished yet
      let curIdx = -1;
      for (let i = 0; i < session.tasks.length; i++) {
        if (minute < session.tasks[i].cleanEnd) { curIdx = i; break; }
      }

      if (curIdx === -1) {
        // All tasks done — render exit animation
        const t = clamp((minute - session.exitStart) / (session.exitEnd - session.exitStart), 0, 1);
        const lastUnit = this.properties[session.tasks[session.tasks.length - 1].unit];
        const p = quad(lastUnit, session.exitCtrl, session.exitTo, easeInOutCubic(t));
        w.dom.g.setAttribute("transform", `translate(${p.x}, ${p.y})`);
        w.dom.g.setAttribute("opacity", String(1 - t));
        w.dom.line.setAttribute("d",
          `M ${lastUnit.x} ${lastUnit.y} Q ${session.exitCtrl.x} ${session.exitCtrl.y} ${session.exitTo.x} ${session.exitTo.y}`);
        w.dom.line.setAttribute("opacity", String((1 - t) * 0.45));
        w.dom.ring.setAttribute("stroke-dasharray", `0 ${w.ringC}`);
        continue;
      }

      const cur = session.tasks[curIdx];
      const dest = this.properties[cur.unit];

      if (minute < cur.travelStart) {
        // Idle between tasks — sit at PREVIOUS unit, no ring, no line
        const prevUnit = this.properties[cur.prevUnit];
        w.dom.g.setAttribute("transform", `translate(${prevUnit.x}, ${prevUnit.y})`);
        w.dom.g.setAttribute("opacity", "1");
        w.dom.ring.setAttribute("stroke-dasharray", `0 ${w.ringC}`);
        w.dom.line.setAttribute("opacity", "0");
      } else if (minute < cur.cleanStart) {
        // Traveling toward cur
        const t = (minute - cur.travelStart) / (cur.cleanStart - cur.travelStart);
        const p = quad(cur.travelFrom, cur.travelCtrl, dest, easeInOutCubic(t));
        w.dom.g.setAttribute("transform", `translate(${p.x}, ${p.y})`);
        w.dom.g.setAttribute("opacity", "1");
        w.dom.ring.setAttribute("stroke-dasharray", `0 ${w.ringC}`);
        w.dom.line.setAttribute("d",
          `M ${cur.travelFrom.x} ${cur.travelFrom.y} Q ${cur.travelCtrl.x} ${cur.travelCtrl.y} ${dest.x} ${dest.y}`);
        const op = t < 0.15 ? t/0.15 : t > 0.85 ? (1-t)/0.15 : 1;
        w.dom.line.setAttribute("opacity", String(op * 0.55));
      } else {
        // Cleaning at cur
        w.dom.g.setAttribute("transform", `translate(${dest.x}, ${dest.y})`);
        w.dom.g.setAttribute("opacity", "1");
        w.dom.line.setAttribute("opacity", "0");
        const prog = (minute - cur.cleanStart) / (cur.cleanEnd - cur.cleanStart);
        w.dom.ring.setAttribute("stroke-dasharray", `${prog * w.ringC} ${w.ringC}`);
      }
    }
  }

  update(partial) {
    this.options = { ...this.options, ...partial };
    const rebuildKeys = [
      "propertyCount", "cleanerCount", "pmCount",
      "longStayCount", "dayCount", "seed", "targetOccupancy",
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

/* ---------- helpers ---------- */
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
  return arr;
}
function pickN(source, n, rand) {
  // Sample N values from source with replacement (when n > source.length)
  const out = [];
  for (let i = 0; i < n; i++) out.push(source[Math.floor(rand() * source.length)]);
  return out;
}
function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function easeOutCubic(t)   { const u = 1 - t; return 1 - u*u*u; }
function easeInOutCubic(t) { return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2; }

function bezierCtrl(from, to, rand) {
  // Called ONCE per leg during planning — sign and depth pinned at plan-time
  // so the curve doesn't flip every frame during render.
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
function nearestEdgePoint({ x, y }, w, h) {
  const dl = x, dr = w - x, dt = y, db = h - y;
  const m = Math.min(dl, dr, dt, db);
  if (m === dl) return { x: -60, y };
  if (m === dr) return { x: w + 60, y };
  if (m === dt) return { x, y: -60 };
  return { x, y: h + 60 };
}
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
