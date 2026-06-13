const { useRef, useEffect, useState, useCallback } = React;

/* ------------------------------------------------------------------ *
 *  INTERVAL LAB — prototype
 *  Two views of the same two voices, locked together:
 *    · the interval BAND  (time → the horizontal story)
 *    · the LISSAJOUS      (shape → why it sounds that way)
 *  One consonance→color function feeds both. One playhead is the clock.
 *  Just vs Equal temperament: just locks the figure, equal makes it
 *  drift — and with audio on, that drift is the beating you hear.
 * ------------------------------------------------------------------ */

const PHRASES = [
  { key: "parallel",   name: "Parallel 3rds",   lower: [60, 62, 64, 65, 67], upper: [64, 65, 67, 69, 71] },
  { key: "contrary",   name: "Contrary",        lower: [60, 59, 57, 55, 53], upper: [64, 65, 67, 69, 72] },
  { key: "convergent", name: "Convergence",     lower: [55, 57, 58, 60],     upper: [67, 65, 63, 60] },
  { key: "suspension", name: "Suspension 4–3",  lower: [60, 60, 60, 60],     upper: [65, 65, 64, 64] },
];

const NAMES = ["Unison","Minor 2nd","Major 2nd","Minor 3rd","Major 3rd","Perfect 4th","Tritone","Perfect 5th","Minor 6th","Major 6th","Minor 7th","Major 7th"];
const SHORT = ["1","♭2","2","♭3","3","4","TT","5","♭6","6","♭7","7"];
const RATIOS = [[1,1],[16,15],[9,8],[6,5],[5,4],[4,3],[45,32],[3,2],[8,5],[5,3],[9,5],[15,8]];
const CONS = new Set([0,3,4,7,8,9]);
const MILD = new Set([5]);

const EMERALD = "#34d399", AMBER = "#fbbf24", ROSE = "#fb7185";
const V_UP = "#6aa8ff", V_LO = "#b9a7ff";

const classColor = (ic) => (CONS.has(ic) ? EMERALD : MILD.has(ic) ? AMBER : ROSE);
const consWord  = (ic) => (CONS.has(ic) ? "consonant" : MILD.has(ic) ? "unstable" : "dissonant");
const mtof = (m, a4 = 440) => a4 * Math.pow(2, (m - 69) / 12);

function stepIndex(ph, pt) {
  return Math.max(0, Math.min(ph.lower.length - 1, Math.floor(pt + 1e-6)));
}
function motionAt(ph, i) {
  const N = ph.lower.length;
  if (i >= N - 1) return "—";
  const du = ph.upper[i + 1] - ph.upper[i];
  const dl = ph.lower[i + 1] - ph.lower[i];
  if (du === 0 && dl === 0) return "static";
  if (du === 0 || dl === 0) return "oblique";
  if (du > 0 === dl > 0) return Math.abs(du) === Math.abs(dl) ? "parallel" : "similar";
  return "contrary";
}

function setupCanvas(canvas, w, h) {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function drawBand(canvas, ph, pt) {
  const W = 600, H = 264;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, W, H);
  const all = ph.lower.concat(ph.upper);
  const lo = Math.min(...all) - 2, hi = Math.max(...all) + 2;
  const N = ph.lower.length;
  const padX = 48, padR = 18, padY = 30;
  const xOf = (i) => padX + (W - padX - padR) * (N <= 1 ? 0 : i / (N - 1));
  const yOf = (m) => H - padY - (H - 2 * padY) * ((m - lo) / (hi - lo));

  // faint pitch grid
  ctx.strokeStyle = "rgba(120,150,140,0.07)";
  ctx.lineWidth = 1;
  for (let m = Math.ceil(lo); m <= hi; m++) {
    ctx.beginPath(); ctx.moveTo(padX, yOf(m)); ctx.lineTo(W - padR, yOf(m)); ctx.stroke();
  }

  // interval band ribbon
  for (let i = 0; i < N - 1; i++) {
    const ic = Math.abs(ph.upper[i] - ph.lower[i]) % 12;
    ctx.fillStyle = classColor(ic);
    ctx.globalAlpha = 0.20;
    ctx.beginPath();
    ctx.moveTo(xOf(i), yOf(ph.upper[i]));
    ctx.lineTo(xOf(i + 1), yOf(ph.upper[i + 1]));
    ctx.lineTo(xOf(i + 1), yOf(ph.lower[i + 1]));
    ctx.lineTo(xOf(i), yOf(ph.lower[i]));
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // interval labels per step
  ctx.font = "11px 'IBM Plex Mono', monospace";
  ctx.textAlign = "center";
  for (let i = 0; i < N; i++) {
    const ic = Math.abs(ph.upper[i] - ph.lower[i]) % 12;
    ctx.fillStyle = "rgba(200,220,210,0.45)";
    const my = (yOf(ph.upper[i]) + yOf(ph.lower[i])) / 2;
    ctx.fillText(SHORT[ic], xOf(i), my + 4);
  }

  const voice = (arr, color) => {
    ctx.shadowColor = color; ctx.shadowBlur = 9;
    ctx.strokeStyle = color; ctx.lineWidth = 2.2;
    ctx.beginPath();
    arr.forEach((m, i) => (i ? ctx.lineTo(xOf(i), yOf(m)) : ctx.moveTo(xOf(i), yOf(m))));
    ctx.stroke();
    ctx.shadowBlur = 0;
    arr.forEach((m, i) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(xOf(i), yOf(m), 3.4, 0, 7); ctx.fill(); });
  };
  voice(ph.lower, V_LO);
  voice(ph.upper, V_UP);

  // playhead
  const px = xOf(pt);
  ctx.strokeStyle = "rgba(255,255,255,0.55)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(px, padY - 8); ctx.lineTo(px, H - padY + 8); ctx.stroke();
}

/* blend 0 = waves unrolled over time · blend 1 = wound into the Lissajous.
   x morphs from a linear time sweep into sin(a·θ); y stays sin(b·θ). The
   horizontal axis "is time" until you wind the other voice back into it. */
function drawScope(canvas, ph, pt, tuning, phi, blend) {
  const S = 288;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, S, S);
  const cx = S / 2, cy = S / 2, R = S / 2 - 22;

  // frame
  ctx.strokeStyle = "rgba(120,150,140,0.16)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, R + 8, 0, 7); ctx.stroke();
  // vertical crosshair belongs to the wound figure; fade it in with blend
  ctx.strokeStyle = `rgba(120,150,140,${0.08 * blend})`;
  ctx.beginPath(); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
  ctx.strokeStyle = "rgba(120,150,140,0.08)";
  ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.stroke();
  // a faint time axis belongs to the unrolled wave; fade it out with blend
  if (blend < 0.98) {
    ctx.strokeStyle = `rgba(120,150,140,${0.16 * (1 - blend)})`;
    ctx.beginPath(); ctx.moveTo(cx - R, cy + R + 5); ctx.lineTo(cx + R, cy + R + 5); ctx.stroke();
  }

  const i = stepIndex(ph, pt);
  const u = Math.max(ph.upper[i], ph.lower[i]);
  const l = Math.min(ph.upper[i], ph.lower[i]);
  const d = u - l;
  const ic = d % 12, oct = Math.floor(d / 12);
  const [num, den] = RATIOS[ic];
  const bJust = num * Math.pow(2, oct);
  let a, b, cyclesFig;
  if (tuning === "just") {
    a = den; b = bJust; cyclesFig = 1;
  } else {
    const detune = Math.pow(2, d / 12) / (bJust / den);
    a = den; b = bJust * detune; cyclesFig = 10;
  }
  // fewer cycles while unrolled keeps the wave readable; grow toward the figure
  const cyclesEff = 1 + (cyclesFig - 1) * blend;

  const col = classColor(ic);
  ctx.strokeStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 10;
  ctx.lineWidth = 1.7; ctx.globalAlpha = 0.95;
  ctx.beginPath();
  const STEPS = 2600, TT = Math.PI * 2 * cyclesEff;
  for (let s = 0; s <= STEPS; s++) {
    const f = s / STEPS;
    const th = TT * f;
    const xWound = Math.sin(a * th);
    const xTime = f * 2 - 1;
    const x = cx + R * (xTime + (xWound - xTime) * blend);
    const y = cy - R * Math.sin(b * th + phi);
    s ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.stroke();
  ctx.shadowBlur = 0; ctx.globalAlpha = 1;
}

function IntervalLab() {
  const [phraseIdx, setPhraseIdx] = useState(0);
  const [tuning, setTuning] = useState("equal");
  const [playing, setPlaying] = useState(false);
  const [audioOn, setAudioOn] = useState(false);
  const [pt, setPt] = useState(0);
  const [blend, setBlend] = useState(1);
  const [info, setInfo] = useState(null);

  const ptRef = useRef(0), tuningRef = useRef("equal"), phraseRef = useRef(PHRASES[0]);
  const blendRef = useRef(1);
  const playingRef = useRef(false), phiRef = useRef(0), lastRef = useRef(0);
  const audioRef = useRef(null);
  const bandRef = useRef(null), lissaRef = useRef(null), rafRef = useRef(0);

  useEffect(() => { tuningRef.current = tuning; }, [tuning]);
  useEffect(() => { blendRef.current = blend; }, [blend]);
  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { phraseRef.current = PHRASES[phraseIdx]; ptRef.current = 0; setPt(0); }, [phraseIdx]);

  const updateAudio = useCallback((ph, p, tun) => {
    const n = audioRef.current; if (!n) return;
    const i = stepIndex(ph, p);
    const lo = Math.min(ph.upper[i], ph.lower[i]);
    const hi = Math.max(ph.upper[i], ph.lower[i]);
    const loF = mtof(lo);
    let hiF;
    if (tun === "just") {
      const d = hi - lo, ic = d % 12, oct = Math.floor(d / 12);
      const [num, den] = RATIOS[ic];
      hiF = loF * (num / den) * Math.pow(2, oct);
    } else hiF = mtof(hi);
    const t = n.ac.currentTime;
    n.v1.o.frequency.setTargetAtTime(loF, t, 0.02);
    n.v2.o.frequency.setTargetAtTime(hiF, t, 0.02);
  }, []);

  useEffect(() => {
    const band = bandRef.current, lissa = lissaRef.current;
    setupCanvas(band, 600, 264);
    setupCanvas(lissa, 288, 288);
    const loop = (ts) => {
      if (!lastRef.current) lastRef.current = ts;
      const dt = (ts - lastRef.current) / 1000; lastRef.current = ts;
      const ph = phraseRef.current, N = ph.lower.length;
      if (playingRef.current) {
        ptRef.current += dt / 0.7;
        if (ptRef.current > N - 1 + 1e-4) ptRef.current = 0;
      }
      phiRef.current += 0.012;
      drawBand(band, ph, ptRef.current);
      drawScope(lissa, ph, ptRef.current, tuningRef.current, phiRef.current, blendRef.current);
      updateAudio(ph, ptRef.current, tuningRef.current);

      const i = stepIndex(ph, ptRef.current);
      const u = Math.max(ph.upper[i], ph.lower[i]), l = Math.min(ph.upper[i], ph.lower[i]);
      const d = u - l, ic = d % 12;
      const [num, den] = RATIOS[ic];
      setPt(ptRef.current);
      setInfo({
        ic, d,
        name: NAMES[ic] + (d > 12 ? " · compound" : ""),
        ratio: tuningRef.current === "just" ? `${num}:${den}` : `2^(${d}/12) ≈ ${Math.pow(2, d / 12).toFixed(3)}`,
        word: consWord(ic),
        color: classColor(ic),
        motion: motionAt(ph, i),
        lock: tuningRef.current === "just" ? "figure locks — closes on itself" : "figure drifts — that's the beating",
      });
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [updateAudio]);

  const ensureAudio = useCallback(async () => {
    if (audioRef.current) return audioRef.current;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ac = new Ctx();
    const master = ac.createGain(); master.gain.value = 0; master.connect(ac.destination);
    const mk = () => { const o = ac.createOscillator(); o.type = "sine"; const g = ac.createGain(); g.gain.value = 0.5; o.connect(g); g.connect(master); o.start(); return { o, g }; };
    const node = { ac, master, v1: mk(), v2: mk() };
    audioRef.current = node;
    return node;
  }, []);

  const toggleAudio = useCallback(async () => {
    if (audioOn) {
      const n = audioRef.current;
      if (n) n.master.gain.setTargetAtTime(0, n.ac.currentTime, 0.03);
      setAudioOn(false);
    } else {
      const n = await ensureAudio();
      await n.ac.resume();
      n.master.gain.setTargetAtTime(0.13, n.ac.currentTime, 0.05);
      setAudioOn(true);
    }
  }, [audioOn, ensureAudio]);

  const scrub = (e) => {
    const v = parseFloat(e.target.value);
    ptRef.current = v; setPt(v); setPlaying(false);
  };

  const N = PHRASES[phraseIdx].lower.length;
  const scopeLabel = blend > 0.85 ? "interval shape" : blend < 0.15 ? "waves over time" : "winding…";
  const chip = "px-3 py-1.5 rounded-md text-sm transition-colors duration-150 border";

  return (
    <div className="min-h-screen w-full text-slate-200" style={{ background: "radial-gradient(120% 100% at 50% 0%, #0d1513 0%, #070a09 60%, #050706 100%)", fontFamily: "'IBM Plex Sans', ui-sans-serif, system-ui" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500&display=swap');
        .scope { position:relative; border-radius:14px; background:linear-gradient(180deg,#0a110f,#070c0b); border:1px solid rgba(120,160,150,0.14); box-shadow: inset 0 0 60px rgba(0,0,0,0.6), 0 10px 30px rgba(0,0,0,0.4); overflow:hidden; }
        .scope::after { content:''; position:absolute; inset:0; pointer-events:none; background:repeating-linear-gradient(0deg, rgba(255,255,255,0.025) 0px, rgba(255,255,255,0.025) 1px, transparent 2px, transparent 4px); }
        .lab-canvas { display:block; width:100%; height:auto; }
        .mono { font-family:'IBM Plex Mono', monospace; }
      `}</style>

      <div className="mx-auto px-5 py-8" style={{ maxWidth: 980 }}>
        <header className="mb-7">
          <div className="mono text-sm tracking-widest" style={{ color: "#5fbf9e", letterSpacing: "0.28em" }}>INTERVAL · LAB</div>
          <h1 style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 24, lineHeight: 1.05, marginTop: 8 }}>
            Two-voice intervals, <span style={{ fontStyle: "italic", color: "#9fe7cd" }}>in time and in shape</span>
          </h1>
          <p className="text-base mt-3" style={{ color: "#8aa39b", maxWidth: 880 }}>
            The band is the two voices over time. The scope is those same two waves as a shape. <br/>Same color drives both —
            green consonant, amber unstable, rose dissonant. <br/>• Flip the tuning and watch the figure lock or drift.
          </p>
        </header>

        {/* controls */}
        <div className="flex flex-wrap items-center gap-2 mb-5">
          {PHRASES.map((p, i) => (
            <button key={p.key} onClick={() => setPhraseIdx(i)} className={chip}
              style={{ borderColor: i === phraseIdx ? "#3f6b5d" : "rgba(120,160,150,0.18)", background: i === phraseIdx ? "rgba(63,107,93,0.25)" : "transparent", color: i === phraseIdx ? "#cdeee0" : "#8aa39b" }}>
              {p.name}
            </button>
          ))}
          <div className="flex-1" />
          <div className="inline-flex rounded-md overflow-hidden border" style={{ borderColor: "rgba(120,160,150,0.18)" }}>
            {["just", "equal"].map((t) => (
              <button key={t} onClick={() => setTuning(t)} className="px-3 py-1.5 text-sm transition-colors mono"
                style={{ background: tuning === t ? "rgba(95,191,158,0.18)" : "transparent", color: tuning === t ? "#9fe7cd" : "#8aa39b" }}>
                {t === "just" ? "JUST" : "EQUAL"}
              </button>
            ))}
          </div>
          <button onClick={() => setPlaying((p) => !p)} className={chip}
            style={{ borderColor: "rgba(120,160,150,0.18)", color: "#cdeee0", background: playing ? "rgba(63,107,93,0.25)" : "transparent" }}>
            {playing ? "❚❚ Pause" : "▶ Play"}
          </button>
          <button onClick={toggleAudio} className={chip}
            style={{ borderColor: audioOn ? "#7a5cbf" : "rgba(120,160,150,0.18)", color: audioOn ? "#d9c9ff" : "#8aa39b", background: audioOn ? "rgba(122,92,191,0.18)" : "transparent" }}>
            {audioOn ? "♪ Sound on" : "♪ Sound off"}
          </button>
        </div>

        {/* panels */}
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="scope flex-1 p-3">
            <div className="mono text-xs mb-1" style={{ color: "#5fbf9e", letterSpacing: "0.18em" }}>BAND · pitch ↑ / time →</div>
            <canvas ref={bandRef} className="lab-canvas" />
          </div>
          <div className="scope p-3 lg:w-80">
            <div className="mono text-xs mb-1" style={{ color: "#5fbf9e", letterSpacing: "0.18em" }}>SCOPE · {scopeLabel}</div>
            <canvas ref={lissaRef} className="lab-canvas" style={{ maxWidth: 320, margin: "0 auto" }} />
          </div>
        </div>

        {/* scrub */}
        <div className="mt-4 flex items-center gap-3">
          <span className="mono text-xs" style={{ color: "#6f8a82", minWidth: 64 }}>SCRUB</span>
          <input type="range" min={0} max={N - 1} step={0.001} value={pt} onChange={scrub}
            className="flex-1" style={{ accentColor: "#5fbf9e" }} />
        </div>

        {/* morph */}
        <div className="mt-3 flex items-center gap-3">
          <span className="mono text-xs" style={{ color: "#6f8a82", minWidth: 64 }}>MORPH</span>
          <span className="mono text-xs" style={{ color: "#8aa39b" }}>wave</span>
          <input type="range" min={0} max={1} step={0.001} value={blend} onChange={(e) => setBlend(parseFloat(e.target.value))}
            className="flex-1" style={{ accentColor: "#7a5cbf" }} />
          <span className="mono text-xs" style={{ color: "#8aa39b" }}>shape</span>
        </div>

        {/* readout */}
        {info && (
          <div className="mt-5 scope p-4">
            <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
              <div>
                <div className="mono text-xs" style={{ color: "#6f8a82", letterSpacing: "0.14em" }}>INTERVAL</div>
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: 24, color: info.color }}>{info.name}</div>
              </div>
              <Field label="SEMITONES" value={`${info.d} st`} />
              <Field label="RATIO" value={info.ratio} />
              <Field label="QUALITY">
                <span className="inline-flex items-center gap-2">
                  <span style={{ width: 9, height: 9, borderRadius: 9, background: info.color, display: "inline-block", boxShadow: `0 0 8px ${info.color}` }} />
                  {info.word}
                </span>
              </Field>
              <Field label="MOTION" value={info.motion} />
              <div className="flex-1" />
              <div className="mono text-xs self-end" style={{ color: tuning === "just" ? "#9fe7cd" : "#fbbf24" }}>{info.lock}</div>
            </div>
          </div>
        )}

        <p className="mono text-xs mt-5" style={{ color: "#566a63" }}>
          prototype · web stand-in for the Metal build · turn sound on, pick a consonant interval, then flip EQUAL → JUST and listen
        </p>
      </div>
    </div>
  );
}

function Field({ label, value, children }) {
  return (
    <div>
      <div className="mono text-xs" style={{ color: "#6f8a82", letterSpacing: "0.14em" }}>{label}</div>
      <div className="mono text-base" style={{ color: "#cdeee0", marginTop: 2 }}>{value ?? children}</div>
    </div>
  );
}
