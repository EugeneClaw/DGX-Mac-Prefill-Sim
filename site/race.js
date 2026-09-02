// Prefill Race v3 — pick any two machines, race them 1v1.
// All numbers verbatim from race-data.json. The page never computes timings.
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let DATA = null, TRANSCRIPT = null;
const SEL = { a: 'spark-2', b: 'm5u-256', model: null, stackA: null, stackB: null };

const fmt1 = (x) => Number(x).toFixed(1);
const fmt2 = (x) => Number(x).toFixed(2);
const fmtInt = (x) => Math.round(Number(x)).toLocaleString("en-US");

function laneFor(machineId, modelId, stackId) {
  return DATA.lanes.find((l) => l.machine_id === machineId && l.model.id === modelId && l.stack.id === stackId);
}
function currentLanes() {
  const a = laneFor(SEL.a, SEL.model, SEL.stackA);
  const b = laneFor(SEL.b, SEL.model, SEL.stackB);
  return [a, b].filter(Boolean);
}

// ---------- pickers ----------
function buildPickers() {
  for (const side of ['a', 'b']) {
    const wrap = $(`#pick-${side}`);
    wrap.innerHTML = "";
    const machines = DATA.machines.filter((m) =>
      side === 'a' ? m.side === 'spark' : m.side === 'mac');
    for (const m of machines) {
      const b = document.createElement("button");
      b.className = "pick";
      b.dataset.machine = m.id;
      b.innerHTML = `<span class="pk-label">${m.button ?? m.label}</span><span class="pk-ram">${m.ram}</span>`;
      b.addEventListener("click", () => {
        SEL[side] = m.id;
        SEL[`stack${side.toUpperCase()}`] = m.stacks[0];
        syncAll();
      });
      wrap.appendChild(b);
    }
    // stack toggles
    const srow = $(`#stack-${side}`);
    srow.innerHTML = "";
    srow.dataset.side = side;
  }
  // model chips
  const mwrap = $("#model-chips");
  mwrap.innerHTML = "";
  for (const m of DATA.models) {
    const b = document.createElement("button");
    b.className = "model-chip";
    b.dataset.model = m.id;
    b.innerHTML = `<span class="pc-model">${m.name}</span><span class="pc-sub">${m.quant_label}</span>`;
    b.addEventListener("click", () => { SEL.model = m.id; syncAll(); });
    mwrap.appendChild(b);
  }
}

function buildStackToggles() {
  for (const side of ['a', 'b']) {
    const mach = DATA.machines.find((m) => m.id === SEL[side]);
    const srow = $(`#stack-${side}`);
    srow.innerHTML = "";
    if (!mach) continue;
    for (const s of mach.stacks) {
      const b = document.createElement("button");
      b.className = "stack-chip";
      b.textContent = { 'llamacpp-gguf-cuda': 'llama.cpp', 'vllm-tp': 'vLLM', 'llamacpp-metal': 'llama.cpp', 'mlx': 'MLX' }[s] || s;
      b.dataset.stack = s;
      b.addEventListener("click", () => { SEL[`stack${side.toUpperCase()}`] = s; syncAll(); });
      srow.appendChild(b);
    }
  }
}

function syncPickerUI() {
  $$(".pick").forEach((b) => b.classList.toggle("active", Object.values(SEL).includes(b.dataset.machine) && (b.closest('#pick-a') ? SEL.a === b.dataset.machine : SEL.b === b.dataset.machine)));
  $$(".model-chip").forEach((b) => b.classList.toggle("active", b.dataset.model === SEL.model));
  for (const side of ['a', 'b']) {
    const mach = DATA.machines.find((m) => m.id === SEL[side]);
    const cur = SEL[`stack${side.toUpperCase()}`];
    $$(`#stack-${side} .stack-chip`).forEach((b) => b.classList.toggle("active", b.dataset.stack === cur));
    void mach;
  }
}

// ---------- lanes ----------
function laneName(l) {
  // machine labels may already carry "N×" — never double it
  const base = l.machine.label.replace(/^\d+×\s*/, "");
  return `${l.machine.nodes > 1 ? l.machine.nodes + "× " : ""}${base}`;
}

function buildLanes(lanes) {
  const wrap = $("#lanes");
  wrap.innerHTML = "";
  wrap.classList.add("has-both");
  RACE.lanes = [];
  for (const l of lanes) {
    const el = document.createElement("article");
    el.className = `lane side-${l.side}`;
    el.dataset.id = l.id;
    const decMark = l.decode_measured ? '<span class="mbadge" title="measured receipt">M</span>' : '<span class="mbadge mod" title="modelled">~</span>';
    el.innerHTML = `
      <div class="lane-head">
        <div>
          <div class="lane-name">${laneName(l)} <span class="ram-tag">${l.machine.ram}</span></div>
          <div class="lane-sub">${l.stack.label} · ${l.model.name} ${l.quant.label}</div>
        </div>
        <span class="phase-tag" data-phase>PREFILL</span>
      </div>
      <div class="lane-metrics">
        <div class="metric"><span class="k">TTFT ${warmMode() ? "warm" : "cold"}</span><span class="v amber" data-m-cold>${fmt1(warmMode() ? l.ttft_warm_s : l.ttft_cold_s)}s</span></div>
        <div class="metric"><span class="k">Decode</span><span class="v cyan" data-m-dec>${fmt1(l.decode_tps)} t/s ${decMark}</span></div>
        <div class="metric"><span class="k">Total</span><span class="v" data-total>${fmt1(warmMode() ? l.total_warm_s : l.total_cold_s)}s</span></div>
      </div>
      <div class="bar-wrap">
        <div class="bar"><div class="fill"></div></div>
        <div class="bar-labels">
          <span class="tok" data-tok>0 / ${fmtInt(DATA.scenario.context_tokens)} tok</span>
          <span>${fmt1(l.prefill_tps)} tok/s prefill</span>
        </div>
      </div>
      <div class="decode-box" hidden></div>`;
    wrap.appendChild(el);
    RACE.lanes.push({ data: l, el, prefillDone: false, decodeDone: false, words: [] });
  }
}

function warmMode() { return $("#warm-btn").getAttribute("aria-pressed") === "true"; }

// ---------- results ----------
function buildResults(lanes, winnerId) {
  const w = lanes.find((l) => l.id === winnerId);
  const warm = warmMode();
  $("#winner-line").textContent = `${laneName(w)} (${w.stack.label}) wins in ${fmt1(warm ? w.total_warm_s : w.total_cold_s)}s`;
  $("#results-sub").textContent =
    `prefill ${fmt1(warm ? w.ttft_warm_s : w.ttft_cold_s)}s @ ${fmt1(w.prefill_tps)} tok/s · ` +
    `reply ${fmt1(w.answer_s)}s @ ${fmt1(w.decode_tps)} t/s ${w.decode_measured ? "(measured)" : "(modelled)"}`;
  // cold-default pedagogy: after a COLD race, invite the warm re-run
  $("#warm-nudge").hidden = warm;
  $("#results").hidden = false;
}

// ---------- race ----------
const RACE = { running: false, speed: 1, t: 0, winnerId: null, lanes: [] };

function startRace() {
  if (RACE.running) return;
  const lanes = currentLanes();
  if (lanes.length < 2 || lanes.some((l) => !l.fits)) return;
  RACE.running = true; RACE.t = 0; RACE.winnerId = null; RACE.speed = 1; syncSpeedUI(); resetClock();
  $("#start-btn").disabled = true; $("#results").hidden = true;

  const words = TRANSCRIPT.final.split(/\s+/);
  for (const v of RACE.lanes) {
    v.prefillDone = false; v.decodeDone = false; v.words = words;
    const el = v.el;
    el.classList.remove("winner", "decode-phase");
    const tag = el.querySelector("[data-phase]");
    tag.className = "phase-tag"; tag.textContent = "PREFILL";
    el.querySelector(".fill").style.width = "0%";
    el.querySelector("[data-tok]").textContent = `0 / ${fmtInt(DATA.scenario.context_tokens)} tok`;
    const box = el.querySelector(".decode-box");
    box.hidden = true;
    box.textContent = "";
  }

  if (reducedMotion) { finishInstantly(); return; }
  powerSeed();          // the big deal: fuel blast across the whole page
  lastFrame = performance.now();
  requestAnimationFrame(tick);
}

function finishInstantly() {
  const ttft = (l) => warmMode() ? l.ttft_warm_s : l.ttft_cold_s;
  const total = (l) => warmMode() ? l.total_warm_s : l.total_cold_s;
  let winnerId = null, best = Infinity;
  for (const v of RACE.lanes) if (total(v.data) < best) { best = total(v.data); winnerId = v.data.id; }
  for (const v of RACE.lanes) {
    v.prefillDone = v.decodeDone = true;
    v.el.querySelector("[data-phase]").textContent = "DONE";
    v.el.querySelector(".fill").style.width = "100%";
    v.el.querySelector("[data-tok]").textContent = `${fmtInt(DATA.scenario.context_tokens)} / ${fmtInt(DATA.scenario.context_tokens)} tok`;
    const box = v.el.querySelector(".decode-box");
    box.textContent = TRANSCRIPT.final + " ";
    box.scrollTop = box.scrollHeight;
    box.querySelector(".caret")?.remove();
  }
  RACE.winnerId = winnerId;
  RACE.lanes.find((v) => v.data.id === winnerId).el.classList.add("winner");
  buildResults(RACE.lanes.map((v) => v.data), winnerId);
  RACE.running = false;
  $("#start-btn").disabled = false;
  $("#start-btn").textContent = "↻ RESTART";
}

let lastFrame = 0;
function tick(now) {
  if (!RACE.running) return;
  const dt = Math.min(0.1, (now - lastFrame) / 1000) * RACE.speed;
  lastFrame = now;
  RACE.t += dt;
  const ctx = DATA.scenario.context_tokens;
  let allDone = true;

  for (const v of RACE.lanes) {
    const l = v.data;
    const ttft = warmMode() ? l.ttft_warm_s : l.ttft_cold_s;
    if (!v.prefillDone) {
      const p = Math.min(1, RACE.t / ttft);
      v.el.querySelector(".fill").style.width = (p * 100).toFixed(2) + "%";
      v.el.querySelector("[data-tok]").textContent = `${fmtInt(Math.floor(p * ctx))} / ${fmtInt(ctx)} tok`;
      if (p >= 1) {
        v.prefillDone = true;
        v.el.querySelector("[data-phase]").textContent = "RESPONSE";
        v.el.classList.add("decode-phase");
        v.el.querySelector(".decode-box").hidden = false;
      } else allDone = false;
    }
    if (v.prefillDone && !v.decodeDone) {
      const p = Math.min(1, (RACE.t - ttft) / l.answer_s);
      const box = v.el.querySelector(".decode-box");
      const txt = v.words.slice(0, Math.floor(p * v.words.length)).join(" ") + " ";
      box.textContent = txt;
      const caret = document.createElement("span");
      caret.className = "caret";
      box.appendChild(caret);
      box.scrollTop = box.scrollHeight; // keep the newest text in view
      if (p >= 1) {
        v.decodeDone = true;
        box.textContent = TRANSCRIPT.final + " ";
        box.scrollTop = box.scrollHeight;
        v.el.querySelector(".caret")?.remove();
        v.el.querySelector("[data-phase]").textContent = "DONE";
      } else allDone = false;
    }
  }

  if (!RACE.winnerId) {
    const total = (l) => warmMode() ? l.total_warm_s : l.total_cold_s;
    let best = Infinity, bid = null;
    for (const v of RACE.lanes) {
      if (!v.decodeDone) continue;
      if (total(v.data) < best) { best = total(v.data); bid = v.data.id; }
    }
    if (bid && RACE.t >= best - 1e-9) {
      RACE.winnerId = bid;
      RACE.lanes.find((v) => v.data.id === bid).el.classList.add("winner");
      buildResults(RACE.lanes.map((v) => v.data), bid);
    }
  }

  // (race streams draw on the persistent ambient loop — nothing to do here)
  if (RACE.winnerId && allDone) {
    RACE.running = false;
    POWER.dying = true;   // blast fades out — the fuel is spent
    $("#start-btn").disabled = false;
    $("#start-btn").textContent = "↻ RESTART";
    return;
  }
  // visible race clock — sim seconds, so the wall in front of you IS the
  // number the page promised. Any mismatch is now self-evident.
  const clock = $("#race-clock");
  if (clock) clock.textContent = RACE.t.toFixed(1) + "s";
  requestAnimationFrame(tick);
}

// ---------- canvas (same as v2, side-colored streams) ----------
const cv = $("#bg-canvas");
const cx = cv.getContext("2d");
let dpr = 1;
function resizeCanvas() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.floor(window.innerWidth * dpr);
  cv.height = Math.floor(window.innerHeight * dpr);
  if (AMBIENT.mode) ambientSeed(AMBIENT.mode); // re-density on resize
}

// ---------- ambient mode particles (embers warm / frost cold) ----------
// Persistent rAF loop, independent of the race: the background always
// breathes so the current mode is felt even before START.
const AMBIENT = { parts: [], last: 0, mode: null };
function ambientSeed(mode) {
  AMBIENT.mode = mode;
  document.body.dataset.mode = mode;   // CSS hooks (device art colour, etc.)
  AMBIENT.parts = [];
  const n = reducedMotion ? 0 : Math.min(70, Math.floor(window.innerWidth / 18));
  for (let i = 0; i < n; i++) {
    AMBIENT.parts.push({
      x: Math.random(),
      y: Math.random(),
      r: 0.6 + Math.random() * 2.2,          // px (CSS)
      v: 0.014 + Math.random() * 0.03,       // rise/fall speed (screen/s)
      drift: (Math.random() - 0.5) * 0.03,   // horizontal wander
      ph: Math.random() * Math.PI * 2,       // flicker phase
      a: 0.25 + Math.random() * 0.55,        // base alpha
    });
  }
}
function ambientTick(tms) {
  const dt = Math.min(0.05, (tms - (AMBIENT.last || tms)) / 1000);
  AMBIENT.last = tms;
  const W = cv.width, H = cv.height;
  // static backdrop: grid + vignette
  cx.clearRect(0, 0, W, H);
  cx.strokeStyle = "rgba(120,140,170,0.05)";
  cx.lineWidth = dpr;
  const step = 48 * dpr;
  cx.beginPath();
  for (let x = 0; x <= W; x += step) { cx.moveTo(x, 0); cx.lineTo(x, H); }
  for (let y = 0; y <= H; y += step) { cx.moveTo(0, y); cx.lineTo(W, y); }
  cx.stroke();
  const warm = AMBIENT.mode !== "cold";
  const g = cx.createRadialGradient(W / 2, H * 0.35, Math.min(W, H) * 0.2, W / 2, H / 2, Math.max(W, H) * 0.75);
  g.addColorStop(0, "rgba(10,13,18,0)");
  g.addColorStop(1, warm ? "rgba(26,15,4,0.55)" : "rgba(4,13,20,0.55)");
  cx.fillStyle = g;
  cx.fillRect(0, 0, W, H);

  // particles
  for (const p of AMBIENT.parts) {
    if (warm) {
      p.y -= p.v * dt;                                   // embers rise
      if (p.y < -0.02) { p.y = 1.02; p.x = Math.random(); }
    } else {
      p.y += p.v * 0.55 * dt;                            // frost falls slowly
      if (p.y > 1.02) { p.y = -0.02; p.x = Math.random(); }
    }
    p.x += p.drift * dt + Math.sin(tms / 900 + p.ph) * 0.00012;
    if (p.x < -0.02) p.x = 1.02; if (p.x > 1.02) p.x = -0.02;
    const flick = 0.65 + 0.35 * Math.sin(tms / 300 + p.ph);
    const x = p.x * W, y = p.y * H, r = p.r * dpr;
    if (warm) {
      // ember: hot core, warm halo
      cx.fillStyle = `rgba(232,180,90,${(p.a * flick * 0.85).toFixed(3)})`;
      cx.beginPath(); cx.arc(x, y, r, 0, 7); cx.fill();
      cx.fillStyle = `rgba(224,110,60,${(p.a * flick * 0.18).toFixed(3)})`;
      cx.beginPath(); cx.arc(x, y, r * 2.6, 0, 7); cx.fill();
    } else {
      // frost: pale core, faint blue halo, slight sparkle
      cx.fillStyle = `rgba(190,225,245,${(p.a * flick * 0.8).toFixed(3)})`;
      cx.beginPath(); cx.arc(x, y, r * 0.8, 0, 7); cx.fill();
      cx.fillStyle = `rgba(120,190,230,${(p.a * flick * 0.15).toFixed(3)})`;
      cx.beginPath(); cx.arc(x, y, r * 2.4, 0, 7); cx.fill();
    }
  }

  // power blast + race streams on top (existing behaviour)
  powerDraw(tms, dt);
  drawRaceStreams();
  requestAnimationFrame(ambientTick);
}

function setAmbientMode(mode) {
  if (AMBIENT.mode === mode) return;
  ambientSeed(mode);
}

// ---------- power blast (START RACE) ----------
// Many streaks firing left→right across the WHOLE viewport, as if the page is
// being blasted with fuel. Mode palette: warm = reds/oranges/yellows,
// cold = blues/purples/whites. Fades out over ~0.6s when the race ends.
const POWER = { parts: [], energy: 0, dying: false };
function powerSeed() {
  const warm = AMBIENT.mode !== "cold";
  const pal = warm
    ? [[255, 90, 42], [255, 140, 42], [255, 179, 71], [255, 209, 102], [255, 239, 176]]
    : [[124, 196, 255], [74, 107, 255], [155, 107, 255], [201, 216, 255], [255, 255, 255]];
  const n = reducedMotion ? 0 : Math.min(170, Math.floor(window.innerWidth / 7));
  POWER.parts = [];
  for (let i = 0; i < n; i++) {
    POWER.parts.push({
      x: Math.random() * 1.4 - 0.2,           // scatter across + ahead of entry
      y: 0.05 + Math.random() * 0.9,
      v: 0.22 + Math.random() * 0.8,          // screens/s
      len: 0.025 + Math.random() * 0.085,     // streak length (width fraction)
      w: 0.8 + Math.random() * 1.9,           // px (CSS)
      c: pal[Math.floor(Math.random() * pal.length)],
      a: 0.22 + Math.random() * 0.6,
      ph: Math.random() * 6.28,
    });
  }
  POWER.energy = 1;
  POWER.dying = false;
}
function powerDraw(tms, dt) {
  if (POWER.dying) {
    POWER.energy -= dt * 1.8;
    if (POWER.energy <= 0) { POWER.parts = []; POWER.energy = 0; POWER.dying = false; return; }
  }
  if (!POWER.parts.length || POWER.energy <= 0) return;
  const W = cv.width, H = cv.height;
  cx.save();
  cx.globalCompositeOperation = "lighter";
  for (const p of POWER.parts) {
    p.x += p.v * dt;
    if (p.x - p.len > 1.02) p.x = -0.05;
    const flick = 0.72 + 0.28 * Math.sin(tms / 170 + p.ph);
    const a = p.a * POWER.energy * flick;
    const y = p.y * H, w = p.w * dpr;
    const headX = p.x * W, tailX = (p.x - p.len) * W;
    // tail (dim) + head (bright) — two rects beat 170 gradients/frame
    const [r, g, b] = p.c;
    cx.fillStyle = `rgba(${r},${g},${b},${(a * 0.22).toFixed(3)})`;
    cx.fillRect(tailX, y - w / 2, headX - tailX, w);
    cx.fillStyle = `rgba(${r},${g},${b},${a.toFixed(3)})`;
    cx.fillRect(headX - W * 0.012, y - w / 2, W * 0.012, w);
  }
  cx.restore();
}

function prand(i) { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
function drawRaceStreams() {
  if (reducedMotion || !RACE.running) return;
  const W = cv.width, H = cv.height;
  const fitting = RACE.lanes;
  if (!fitting.length) return;
  const bandH = Math.min(70 * dpr, (H * 0.5) / fitting.length);
  const y0 = H * 0.14;
  const maxTps = Math.max(...fitting.map((v) => v.data.prefill_tps));
  for (let li = 0; li < fitting.length; li++) {
    const v = fitting[li], l = v.data;
    const y = y0 + li * bandH + bandH / 2;
    const density = l.prefill_tps / maxTps;
    const n = Math.floor(6 + density * 26);
    const col = l.side === "spark" ? "111,199,143" : "111,179,201";
    if (!v.prefillDone) {
      for (let i = 0; i < n; i++) {
        const speedF = 0.15 + prand(i + li * 97) * 0.35;
        const x = ((RACE.t * speedF + prand(i * 3 + li)) % 1) * W;
        const a = 0.12 + density * 0.35 * (0.5 + 0.5 * Math.sin(RACE.t * 3 + i));
        cx.fillStyle = `rgba(${col},${a.toFixed(3)})`;
        cx.fillRect(x, y - 1.5 * dpr, (4 + prand(i * 7 + li) * 10) * dpr, 3 * dpr);
      }
    } else if (!v.decodeDone) {
      const ttft = warmMode() ? l.ttft_warm_s : l.ttft_cold_s;
      const p = Math.min(1, (RACE.t - ttft) / l.answer_s);
      const x = W * 0.5 + p * W * 0.3;
      const rg = cx.createRadialGradient(x, y, 0, x, y, 26 * dpr);
      rg.addColorStop(0, `rgba(${col},0.5)`);
      rg.addColorStop(1, `rgba(${col},0)`);
      cx.fillStyle = rg;
      cx.fillRect(x - 30 * dpr, y - 30 * dpr, 60 * dpr, 60 * dpr);
    } else {
      cx.fillStyle = `rgba(${col},0.25)`;
      cx.fillRect(0, y - dpr, W, 2 * dpr);
    }
  }
}

// ---------- controls ----------
function syncSpeedUI() {
  const skip = $("#skip-btn");
  skip.textContent = RACE.speed === 1 ? "⏭ 10× speed" : (RACE.speed === 10 ? "⏭ 100× speed" : "⏭ 1× speed");
  skip.classList.toggle("active", RACE.speed !== 1);
  $("#skip-label").textContent = `${RACE.speed}× speed`;
}

function resetClock() {
  const clock = $("#race-clock");
  if (clock) clock.textContent = "0.0s";
}

function buildStage() {
  const ma = DATA.machines.find((m) => m.id === SEL.a);
  const mb = DATA.machines.find((m) => m.id === SEL.b);
  // one shared mm→px scale so the machines compare honestly against each other
  // (inline height:auto so the stylesheet's 72px can't distort the aspect)
  const sparkSvg = () => `<svg viewBox="8.75 12.75 162.5 56.5" style="width:132px;height:auto"><use href="#dev-spark"/></svg>`;
  const macSvg = () => `<svg viewBox="8.75 8.75 162.5 90.5" style="width:168px;height:auto"><use href="#dev-mac"/></svg>`;
  if (ma.nodes >= 4) {
    // 2×2 stack: neater than a 4-wide row
    $("#art-a").innerHTML = `<div class="stack-grid">${sparkSvg()}${sparkSvg()}${sparkSvg()}${sparkSvg()}</div>`;
  } else {
    $("#art-a").innerHTML = Array.from({ length: ma.nodes }, () => sparkSvg()).join("");
  }
  $("#art-b").innerHTML = macSvg();
  $("#label-a").textContent = `${ma.nodes > 1 ? ma.nodes + "× " : ""}${ma.label} — ${ma.ram}`;
  $("#label-b").textContent = `${mb.label} — ${mb.ram}`;
}

function syncAll() {
  // a running race owns the lanes — stop it cleanly before any rebuild,
  // otherwise the old rAF loop keeps ticking against a half-advanced timeline
  if (RACE.running) {
    RACE.running = false;
    $("#start-btn").disabled = false;
    $("#start-btn").textContent = "▶ START RACE";
  }
  // ensure stacks valid for the chosen machines
  const ma = DATA.machines.find((m) => m.id === SEL.a);
  const mb = DATA.machines.find((m) => m.id === SEL.b);
  if (!ma.stacks.includes(SEL.stackA)) SEL.stackA = ma.stacks[0];
  if (!mb.stacks.includes(SEL.stackB)) SEL.stackB = mb.stacks[0];
  buildStackToggles();
  syncPickerUI();
  buildStage();
  const lanes = currentLanes();
  buildLanes(lanes);
  const a = lanes[0], b = lanes[1];
  $("#start-btn").disabled = !(a && b && a.fits && b.fits);
  const nofit = lanes.find((l) => !l.fits);
  if (nofit) {
    $("#results").hidden = false;
    $("#winner-line").textContent = `${laneName(nofit)} can't run ${nofit.model.name} ${nofit.quant.label}`;
    $("#results-sub").textContent = nofit.fit_detail
      ? `weights need ${fmt1(nofit.fit_detail.needs_gb)} GB — more than this machine's pool after OS reserve. Pick a bigger config or another model.`
      : "this combination doesn't fit.";
  } else {
    $("#results").hidden = true;
  }
}

function wireControls() {
  $("#start-btn").addEventListener("click", startRace);
  // single source of truth for cache-state changes (button, lede links, nudge)
  function applyCache(on) {
    $("#warm-btn").setAttribute("aria-pressed", String(on));
    $("#warm-btn").textContent = on ? "WARM" : "COLD";
    $("#warm-btn").classList.toggle("cache-warm", on);
    $("#warm-btn").classList.toggle("cache-cold", !on);
    setAmbientMode(on ? "warm" : "cold");
    syncAll();
  }
  // cache links in the lede: each phrase toggles its mode directly.
  // (Reversible: remove these two handlers + the .cache-link styles.)
  const bounceCache = () => {
    const btn = $("#warm-btn");
    btn.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
    btn.classList.remove("call-attention");
    void btn.offsetWidth;
    btn.classList.add("call-attention");
    clearTimeout(btn.__flashTimer);
    btn.__flashTimer = setTimeout(() => btn.classList.remove("call-attention"), 1900);
  };
  $("#warm-link").addEventListener("click", (e) => {
    e.preventDefault();
    applyCache(true);
    bounceCache();
  });
  $("#cold-link").addEventListener("click", (e) => {
    e.preventDefault();
    applyCache(false);
    bounceCache();
  });
  $("#skip-btn").addEventListener("click", () => {
    RACE.speed = RACE.speed === 1 ? 10 : (RACE.speed === 10 ? 100 : 1);
    syncSpeedUI();
  });
  $("#warm-btn").addEventListener("click", () => {
    applyCache($("#warm-btn").getAttribute("aria-pressed") !== "true");
  });
  // the nudge: one tap = flip to WARM and immediately re-run the same race
  $("#warm-nudge").addEventListener("click", () => {
    applyCache(true);
    startRace();
  });
  window.addEventListener("resize", resizeCanvas);
}

// ---------- boot ----------
async function boot() {
  const [d, t] = await Promise.all([
    fetch("race-data.json").then((r) => r.json()),
    fetch("transcript-excerpt.json").then((r) => r.json()),
  ]);
  DATA = d; TRANSCRIPT = t;
  SEL.model = DATA.models[1].id; // DSv4-Flash-Vision-Exp: both sides fit everywhere, clean demo
  $("#scenario-label").textContent = d.scenario.label;
  buildPickers();
  wireControls();
  resizeCanvas();
  setAmbientMode(warmMode() ? "warm" : "cold");
  requestAnimationFrame(ambientTick);
  syncAll();
}
boot();
