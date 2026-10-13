// Flat-plane-crank V8 engine synthesizer (AudioWorklet). This is the original voice; the only
// changes since are the dropout fix (DC block before the clipper) and faster parameter tracking.
// Physically inspired: every combustion event is a pressure pulse sent down one of the two
// exhaust banks (flat-plane cranks alternate banks, so each bank sees evenly spaced pulses -
// the source of the high, smooth "scream"). Pulses ring a set of pipe resonances and a
// pipe-length comb, then go through load-dependent saturation. No samples are used.
//
// Parameters (k-rate, set from the main thread every frame):
//   rpm      engine speed
//   load     0..1 throttle after traction control
//   limiter  rev limit (rpm)
//   cut      0..1 ignition cut (gear shifts)
//   interior 0..1 (0 = outside behind the car, 1 = cabin)

class EngineSynth {
  constructor(sr, seed = 7) {
    this.sr = sr;
    let s = seed >>> 0;
    this.rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    // Per-cylinder character: small, fixed differences in pulse strength and timing give the
    // half-order "burble" at low rpm that a perfectly even pulse train would not have.
    this.cylAmp = Array.from({ length: 8 }, () => 0.9 + 0.2 * this.rand());
    this.cylTime = Array.from({ length: 8 }, () => (this.rand() - 0.5) * 0.006);
    this.phase = 0; // 0..1 per four-stroke cycle (two crank revolutions)
    this.nextEvent = 0;
    this.rpm = 1000; this.load = 0; this.cutS = 0;
    this.prevRpm = 1000; this.decel = 0;
    // Two exhaust banks, each with its own resonators (slightly detuned = stereo width).
    const mk = (f, tau, g) => ({ f, tau, g, y1: 0, y2: 0, a1: 0, a2: 0 });
    this.banks = [0, 1].map((b) => ({
      res: [mk(92 + b * 6, 0.016, 0.9), mk(300 + b * 14, 0.007, 0.55), mk(690 + b * 25, 0.0045, 0.5), mk(1480 + b * 60, 0.003, 0.32), mk(3100 + b * 120, 0.0016, 0.16)],
      comb: new Float32Array(4096), ci: 0, combLen: Math.round(sr * (0.0093 + b * 0.0004)),
      exc: 0, excLeft: 0, excAmp: 0,
      hp: 0, hpx: 0, lp: 0, zx: 0, zh: 0,
    }));
    this.banks.forEach((bk) => bk.res.forEach((r) => this.tune(r)));
    // Intake: a bright resonator excited by every event, strongest at high rpm and full load.
    this.intake = [mk(1900, 0.0025, 1), mk(3600, 0.0012, 0.5)];
    this.intake.forEach((r) => this.tune(r));
    this.pulseW = sr * 0.0005; // pulse length in samples (fractional)
    this.t = 0;
    this.banks.forEach((bk) => (bk.pulses = []));
    this.ik = [];
    this.pop = 0; this.popLp = 0;
    this.limT = 0;
    this.whine = 0;
    this.air = 0;
  }
  tune(r) {
    const rr = Math.exp(-1 / (r.tau * this.sr));
    r.a1 = 2 * rr * Math.cos((2 * Math.PI * r.f) / this.sr);
    r.a2 = -rr * rr;
    r.norm = (1 - rr) * 2;
  }
  // Sum of raised-cosine pulses that are still sounding; list holds [start, amp] pairs.
  pulseSum(list) {
    let x = 0;
    for (let k = 0; k < list.length; k += 2) {
      const u = (this.t - list[k]) / this.pulseW;
      if (u >= 0 && u < 1) x += list[k + 1] * (1 - Math.cos(2 * Math.PI * u)) * 0.5;
    }
    while (list.length && this.t - list[0] >= this.pulseW) list.splice(0, 2);
    return x * 2.2;
  }
  ring(r, x) {
    const y = r.a1 * r.y1 + r.a2 * r.y2 + x * r.norm;
    r.y2 = r.y1; r.y1 = y;
    return y * r.g;
  }
  // Render n samples of stereo into L and R.
  render(L, R, n, p) {
    const sr = this.sr;
    const kS = 1 - Math.exp(-1 / (0.004 * sr)); // parameter smoothing (short: no audible lag)
    const inter = p.interior;
    // rpm fall rate (rpm/s), smoothed per block: drives overrun pops
    const drop = (this.prevRpm - p.rpm) * (sr / n);
    this.decel = 0.85 * this.decel + 0.15 * Math.max(0, drop);
    this.prevRpm = p.rpm;
    for (let i = 0; i < n; ++i) {
      this.rpm += (p.rpm - this.rpm) * kS;
      this.load += (p.load - this.load) * kS;
      this.cutS += (p.cut - this.cutS) * kS * 4;
      const rpm = Math.max(300, this.rpm), load = this.load;
      const rpmN = Math.min(1.2, rpm / p.limiter);
      // Rev limiter: fuel cut bounces at ~22 Hz while held against it.
      let limiterCut = 0;
      if (rpm > p.limiter - 60 && p.load > 0.4) { this.limT += 1 / sr; limiterCut = (this.limT * 22) % 1 < 0.55 ? 1 : 0; }
      else this.limT = 0;
      const dp = rpm / 120 / sr;
      this.phase += dp;
      this.t += 1;
      if (this.phase >= 1) { this.phase -= 1; this.nextEvent = 0; }
      // Firing events: 8 per cycle, even spacing, banks alternate (flat-plane).
      // Event times are kept to a fraction of a sample: rounding them would smear the
      // high harmonics into noise at high rpm.
      while (this.nextEvent < 8 && this.phase >= this.nextEvent / 8 + this.cylTime[this.nextEvent]) {
        const c = this.nextEvent;
        const ago = (this.phase - (c / 8 + this.cylTime[c])) / dp; // samples since the event
        this.nextEvent++;
        const bk = this.banks[c & 1];
        const cutNow = Math.max(this.cutS, limiterCut);
        // Combustion strength: strong on load, weak pumping pulses when coasting.
        let e = (0.14 + 0.86 * Math.pow(load, 0.8)) * this.cylAmp[c] * (0.98 + 0.04 * this.rand());
        if (cutNow > 0.5) e = 0.1 * this.cylAmp[c];
        // Overrun: unburnt fuel popping in the exhaust when lifting at high rpm.
        if (load < 0.08 && rpm > 3200 && this.decel > 300 && this.rand() < 0.035 + 0.08 * Math.min(1, this.decel / 4000)) this.pop = 0.6 + 0.7 * this.rand();
        if (cutNow > 0.5 && this.rand() < 0.3) this.pop = Math.max(this.pop, 0.5 * this.rand() + 0.3);
        bk.pulses.push(this.t - ago, e);
        this.ik.push(this.t - ago, e);
      }
      // Each bank: half-cosine pulse -> resonators + pipe comb.
      let out = [0, 0];
      for (let b = 0; b < 2; ++b) {
        const bk = this.banks[b];
        let x = 0;
        x = this.pulseSum(bk.pulses);
        // pop: a broadband thump into the low resonances
        if (this.pop > 0) { x += this.pop * (this.rand() * 2 - 1) * 0.9; }
        let y = 0;
        for (const r of bk.res) y += this.ring(r, x);
        // open-ended pipe: negative reflection
        const d = bk.comb[(bk.ci - bk.combLen + 4096) & 4095];
        const z = y - 0.35 * d;
        bk.comb[bk.ci] = z; bk.ci = (bk.ci + 1) & 4095;
        // Remove the DC the one-sided pressure pulses build up in the low resonances before the
        // clipper; otherwise dense pulse trains rail it and the sound drops out in some rpm bands.
        const zh = z - bk.zx + 0.996 * bk.zh; bk.zx = z; bk.zh = zh;
        out[b] = zh;
      }
      this.pop *= 0.9965;
      if (this.pop < 0.01) this.pop = 0;
      // Intake howl (mostly heard in the cabin and at high rpm).
      let ik = 0;
      const ix = this.pulseSum(this.ik);
      // induction air rush: soft filtered noise under load
      this.air += ((this.rand() * 2 - 1) - this.air) * 0.25;
      const air = this.air * 0.03 * load * rpmN * rpmN;
      for (const r of this.intake) ik += this.ring(r, ix);
      ik *= (0.15 + 0.85 * load) * Math.pow(rpmN, 1.6) * (0.35 + 0.65 * inter);
      // Valvetrain / gear whine: faint tone that rises with rpm.
      this.whine += (rpm / 60) * 24 / sr; if (this.whine > 1) this.whine -= 1;
      const wh = Math.sin(2 * Math.PI * this.whine) * 0.012 * rpmN;
      // Saturation grows with load and rpm: the edge on a hard-revved V8.
      const drive = 1.2 + 1.8 * load * (0.4 + 0.6 * rpmN);
      for (let b = 0; b < 2; ++b) {
        const bk = this.banks[b];
        // cubic soft clip: adds only odd low harmonics, so it does not alias into hiss
        let v = Math.max(-1, Math.min(1, out[b] * drive * 0.9));
        v = (1.5 * v - 0.5 * v * v * v) * 1.4;
        // cabin: muffle the exhaust
        const cut = 0.16 + 0.84 * (1 - inter) ;
        bk.lp += (v - bk.lp) * cut;
        v = bk.lp + ik * 0.6 + wh + air;
        // DC / sub-sonic block
        const hp = v - bk.hpx + 0.995 * bk.hp; bk.hpx = v; bk.hp = hp;
        out[b] = hp;
      }
      const loud = 0.42 * (0.55 + 0.45 * Math.min(1, rpmN * 1.3));
      L[i] = Math.tanh((out[0] * 0.72 + out[1] * 0.28) * loud);
      R[i] = Math.tanh((out[1] * 0.72 + out[0] * 0.28) * loud);
    }
  }
}

// Tyre noise. Two mechanisms:
//  squeal - stick-slip of the tread at and just past the grip peak: a tonal whistle around
//           0.7-1.2 kHz with a few inharmonic overtones, unsteady in pitch and amplitude;
//  scrub  - a tyre sliding well past the peak (locked wheel, big drift, burnout): broadband
//           rasp with tread-block chatter that speeds up with sliding speed.
// Parameters (k-rate): squeal 0..1, scrub 0..1, pitch 0..1 (how far past the peak), speed m/s.
class TyreSynth {
  constructor(sr, seed = 11) {
    this.sr = sr;
    let s = seed >>> 0;
    this.rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    this.ph = [0, 0, 0]; this.walk = 0; this.vib = 0; this.env = 1; this.envLp = 1;
    this.sq = 0; this.sc = 0; this.pitch = 0; this.speed = 0; this.chat = 0;
    const mk = (f, tau) => ({ f, tau, y1: 0, y2: 0 });
    this.nres = [mk(900, 0.02), mk(1850, 0.012)];
    this.scr = [mk(520, 0.0018), mk(1500, 0.0012), mk(3200, 0.0008)];
    this.rum = 0;
    [...this.nres, ...this.scr].forEach((r) => this.tune(r));
  }
  tune(r) {
    const rr = Math.exp(-1 / (r.tau * this.sr));
    r.a1 = 2 * rr * Math.cos((2 * Math.PI * r.f) / this.sr); r.a2 = -rr * rr; r.norm = (1 - rr) * 2;
  }
  ring(r, x) { const y = r.a1 * r.y1 + r.a2 * r.y2 + x * r.norm; r.y2 = r.y1; r.y1 = y; return y; }
  render(L, R, n, p) {
    const sr = this.sr, k = 1 - Math.exp(-1 / (0.03 * sr));
    // pitch of the whistle: rises a little with slip and speed
    const f0 = 760 + 300 * Math.min(1, p.pitch) + 4 * Math.min(40, p.speed);
    this.nres[0].f = f0; this.nres[1].f = f0 * 2.03; this.nres.forEach((r) => this.tune(r));
    for (let i = 0; i < n; ++i) {
      this.sq += (p.squeal - this.sq) * k; this.sc += (p.scrub - this.sc) * k;
      const w = this.rand() * 2 - 1;
      // slow random wander (+-6 %) and stick-slip vibrato (~9 Hz)
      this.walk = Math.max(-0.06, Math.min(0.06, this.walk + w * 0.00004));
      this.vib += 9 / sr; if (this.vib > 1) this.vib -= 1;
      const f = f0 * (1 + this.walk + 0.015 * Math.sin(2 * Math.PI * this.vib));
      // amplitude flutter: low-passed noise
      this.env += (0.6 + 0.8 * this.rand() - this.env) * 0.0015;
      this.envLp += (this.env - this.envLp) * 0.01;
      let tone = 0;
      const harm = [[1, 1], [2.02, 0.42], [3.05, 0.2]];
      for (let h = 0; h < 3; ++h) {
        this.ph[h] += (f * harm[h][0]) / sr; if (this.ph[h] > 1) this.ph[h] -= 1;
        tone += Math.sin(2 * Math.PI * this.ph[h]) * harm[h][1];
      }
      const breath = this.ring(this.nres[0], w) * 3 + this.ring(this.nres[1], w) * 1.5;
      const squeal = (tone * 0.55 + breath * 0.45) * this.envLp * this.sq;
      // scrub: rasp + tread chatter
      this.chat += Math.min(220, 18 + p.speed * 9) / sr; if (this.chat > 1) this.chat -= 1;
      const chatter = 0.55 + 0.45 * Math.sin(2 * Math.PI * this.chat);
      let rasp = this.ring(this.scr[0], w) * 1.2 + this.ring(this.scr[1], w) + this.ring(this.scr[2], w) * 0.5;
      this.rum += (w - this.rum) * 0.02;
      const scrub = (rasp * chatter + this.rum * 1.5) * this.sc;
      const y = Math.tanh((squeal * 0.5 + scrub * 0.7) * 1.2);
      L[i] = y; R[i] = y;
    }
  }
}

// Never let one bad value kill the sound: inputs are sanitised, and if the synth state ever goes
// non-finite (or throws), it is rebuilt and this block is output as silence.
function fin(x, d) { return Number.isFinite(x) ? x : d; }
function safeRender(proc, make, L, R, p) {
  try { proc.s.render(L, R, L.length, p); } catch { L.fill(0); R.fill(0); proc.s = make(); return; }
  if (!Number.isFinite(L[0]) || !Number.isFinite(L[L.length - 1]) || !Number.isFinite(R[L.length - 1])) {
    L.fill(0); if (R !== L) R.fill(0); proc.s = make();
  }
}
if (typeof registerProcessor !== 'undefined') {
  registerProcessor('v8-engine', class extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      return [
        { name: 'rpm', defaultValue: 900, minValue: 0, maxValue: 20000, automationRate: 'k-rate' },
        { name: 'load', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
        { name: 'limiter', defaultValue: 7200, minValue: 1000, maxValue: 20000, automationRate: 'k-rate' },
        { name: 'cut', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
        { name: 'interior', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      ];
    }
    constructor() { super(); this.s = new EngineSynth(sampleRate); this.n = 0; }
    process(_in, outputs, P) {
      const o = outputs[0];
      const L = o[0], R = o[1] || o[0];
      safeRender(this, () => new EngineSynth(sampleRate), L, R, { rpm: fin(P.rpm[0], 900), load: fin(P.load[0], 0), limiter: fin(P.limiter[0], 9000), cut: fin(P.cut[0], 0), interior: fin(P.interior[0], 0) });
      if (++this.n % 200 === 0) this.port.postMessage(0); // heartbeat (~every 0.5 s)
      return true;
    }
  });
}
if (typeof registerProcessor !== 'undefined') {
  registerProcessor('tyre-noise', class extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      return ['squeal', 'scrub', 'pitch', 'speed'].map((name) => ({ name, defaultValue: 0, minValue: 0, maxValue: 200, automationRate: 'k-rate' }));
    }
    constructor() { super(); this.s = new TyreSynth(sampleRate); }
    process(_in, outputs, P) {
      const o = outputs[0], L = o[0], R = o[1] || o[0];
      safeRender(this, () => new TyreSynth(sampleRate), L, R, { squeal: fin(P.squeal[0], 0), scrub: fin(P.scrub[0], 0), pitch: fin(P.pitch[0], 0), speed: fin(P.speed[0], 0) });
      return true;
    }
  });
}
if (typeof module !== 'undefined') module.exports = { EngineSynth, TyreSynth };


