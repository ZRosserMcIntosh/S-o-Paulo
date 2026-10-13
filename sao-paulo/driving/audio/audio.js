// Car audio for the driving test track: synthesized flat-plane V8 (AudioWorklet), tyre squeal,
// wind and road noise, all driven by the physics state every frame. No recorded samples.
//
// Self-healing, because mobile browsers (iOS Safari especially) suspend, "interrupt" or quietly
// tear down audio after calls, app switches, screen locks or route changes:
//  - every value sent to the audio thread is checked (a single NaN would silence it for good);
//  - the worklets reset themselves if their state ever goes non-finite;
//  - each worklet sends a heartbeat; if it stops while the context claims to be running, or the
//    context dies, the whole graph is rebuilt;
//  - a suspended context is resumed on the next touch / click / key press.
export class CarAudio {
  constructor() {
    this.ctx = null; this.ready = false; this.enabled = true; this.volume = 0.8;
    this.starting = null; this.lastBeat = 0; this.listening = false;
  }
  // Called from a user gesture the first time (browsers block audio until then).
  async start() {
    if (this.starting) return this.starting;
    if (this.ctx && this.ctx.state !== 'closed') {
      if (this.ctx.state !== 'running') await this.ctx.resume().catch(() => {});
      return;
    }
    this.starting = this.build().finally(() => { this.starting = null; });
    return this.starting;
  }
  async build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ready = false;
    const ctx = (this.ctx = new AC({ latencyHint: 'interactive' }));
    await ctx.audioWorklet.addModule(new URL('./engine-worklet.js', import.meta.url));
    if (ctx !== this.ctx) return; // replaced while loading
    this.master = ctx.createGain(); this.master.gain.value = this.enabled ? this.volume : 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.15;
    this.master.connect(comp).connect(ctx.destination);

    const beat = () => { this.lastBeat = performance.now(); };
    const onError = () => this.rebuild('worklet error');
    this.engine = new AudioWorkletNode(ctx, 'v8-engine', { numberOfInputs: 0, outputChannelCount: [2] });
    this.engine.port.onmessage = beat; this.engine.onprocessorerror = onError;
    this.engineGain = ctx.createGain(); this.engineGain.gain.value = 0.9;
    this.engine.connect(this.engineGain).connect(this.master);

    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = nb.getChannelData(0);
    for (let i = 0; i < d.length; ++i) d[i] = Math.random() * 2 - 1;
    const noise = () => { const s = ctx.createBufferSource(); s.buffer = nb; s.loop = true; s.start(); return s; };

    this.tyre = new AudioWorkletNode(ctx, 'tyre-noise', { numberOfInputs: 0, outputChannelCount: [2] });
    this.tyre.onprocessorerror = onError;
    this.tyreGain = ctx.createGain(); this.tyreGain.gain.value = 0.85;
    this.tyre.connect(this.tyreGain).connect(this.master);
    const wf = ctx.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 700;
    this.windG = ctx.createGain(); this.windG.gain.value = 0;
    noise().connect(wf).connect(this.windG).connect(this.master);
    const rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 170;
    this.roadG = ctx.createGain(); this.roadG.gain.value = 0;
    noise().connect(rf).connect(this.roadG).connect(this.master);

    ctx.onstatechange = () => { if (ctx.state !== 'running') this.kick(); };
    this.lastBeat = performance.now();
    this.ready = true;
    this.listen();
    if (ctx.state !== 'running') await ctx.resume().catch(() => {});
  }
  rebuild(why) {
    console.warn('audio: rebuilding (' + why + ')');
    const old = this.ctx;
    this.ctx = null; this.ready = false;
    old?.close?.().catch(() => {});
    this.start();
  }
  kick() {
    if (!this.enabled) return;
    if (!this.ctx || this.ctx.state === 'closed') { this.start(); return; }
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }
  listen() {
    if (this.listening) return;
    this.listening = true;
    const kick = () => this.kick();
    for (const ev of ['pointerdown', 'touchend', 'click', 'keydown']) addEventListener(ev, kick, { passive: true });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
    addEventListener('pageshow', kick);
    // Watchdog: a running context whose engine worklet has gone quiet is dead - rebuild it.
    setInterval(() => {
      if (!this.enabled || !this.ctx || document.hidden) return;
      if (this.ctx.state !== 'running') { this.kick(); return; }
      if (this.ready && performance.now() - this.lastBeat > 2500) this.rebuild('no heartbeat');
    }, 1000);
  }
  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? this.volume : 0, this.ctx.currentTime, 0.05);
    if (on) this.kick();
  }
  setVolume(v) {
    this.volume = v;
    if (this.master && this.enabled) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }
  // st: { dt, rpm, load, limiter, gear, speed (m/s), tyre: { squeal, scrub, pitch }, interior (bool) }
  update(st) {
    if (!this.ready || !this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const ok = (x, lo, hi) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : null);
    const set = (param, x, tau) => { if (x !== null) param.setTargetAtTime(x, t, tau); };
    const P = this.engine.parameters;
    // Follow the physics as tightly as the frame rate allows (time constant ~half a frame).
    const tau = Math.max(0.004, Math.min(0.03, (ok(st.dt, 0, 1) || 1 / 60) * 0.5));
    set(P.get('rpm'), ok(st.rpm, 0, 20000), tau);
    set(P.get('load'), ok(st.load, 0, 1), tau);
    const lim = ok(st.limiter, 1000, 20000); if (lim !== null) P.get('limiter').setValueAtTime(lim, t);
    set(P.get('interior'), st.interior ? 1 : 0, 0.08);
    const v = ok(Math.abs(st.speed), 0, 200) ?? 0;
    const TP = this.tyre.parameters, ty = st.tyre || {};
    set(TP.get('squeal'), ok(ty.squeal, 0, 1), 0.03);
    set(TP.get('scrub'), ok(ty.scrub, 0, 1), 0.03);
    set(TP.get('pitch'), ok(ty.pitch, 0, 1), 0.05);
    set(TP.get('speed'), v, 0.05);
    this.tyreGain.gain.setTargetAtTime(st.interior ? 0.5 : 0.85, t, 0.1);
    this.windG.gain.setTargetAtTime(Math.min(1, (v / 70) ** 2) * (st.interior ? 0.12 : 0.3), t, 0.1);
    this.roadG.gain.setTargetAtTime(Math.min(1, v / 45) * (st.interior ? 0.35 : 0.22), t, 0.1);
    this.engineGain.gain.setTargetAtTime(st.interior ? 0.75 : 0.9, t, 0.1);
  }
}
