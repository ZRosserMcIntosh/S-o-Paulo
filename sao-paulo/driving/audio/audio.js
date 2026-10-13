// Car audio for the driving test track: synthesized flat-plane V8 (AudioWorklet), tyre squeal,
// wind and road noise, all driven by the physics state every frame. No recorded samples.
export class CarAudio {
  constructor() {
    this.ctx = null; this.ready = false; this.enabled = true; this.volume = 0.8;
    this.lastGear = null; this.cutUntil = 0;
  }
  // Must be called from a user gesture (browsers block audio until then).
  async start() {
    if (this.ctx) { if (this.ctx.state !== 'running') await this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC({ latencyHint: 'interactive' }));
    await ctx.audioWorklet.addModule(new URL('./engine-worklet.js', import.meta.url));
    this.master = ctx.createGain(); this.master.gain.value = this.enabled ? this.volume : 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.15;
    this.master.connect(comp).connect(ctx.destination);

    this.engine = new AudioWorkletNode(ctx, 'v8-engine', { numberOfInputs: 0, outputChannelCount: [2] });
    this.engineGain = ctx.createGain(); this.engineGain.gain.value = 0.9;
    this.engine.connect(this.engineGain).connect(this.master);

    // shared noise buffer
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = nb.getChannelData(0);
    for (let i = 0; i < d.length; ++i) d[i] = Math.random() * 2 - 1;
    const noise = () => { const s = ctx.createBufferSource(); s.buffer = nb; s.loop = true; s.start(); return s; };

    // tyres: stick-slip squeal + sliding scrub (synthesized in the worklet)
    this.tyre = new AudioWorkletNode(ctx, 'tyre-noise', { numberOfInputs: 0, outputChannelCount: [2] });
    this.tyreGain = ctx.createGain(); this.tyreGain.gain.value = 0.85;
    this.tyre.connect(this.tyreGain).connect(this.master);
    // wind
    const wf = ctx.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 700;
    this.windG = ctx.createGain(); this.windG.gain.value = 0;
    noise().connect(wf).connect(this.windG).connect(this.master);
    // road / tyre roar
    const rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 170;
    this.roadG = ctx.createGain(); this.roadG.gain.value = 0;
    noise().connect(rf).connect(this.roadG).connect(this.master);
    this.ready = true;
    this.keepAlive();
  }
  // iOS can suspend or 'interrupt' the context (calls, app switch, silent switch); resume on the
  // next interaction or when the page becomes visible again.
  keepAlive() {
    const kick = () => { if (this.ctx && this.ctx.state !== 'running' && this.enabled) this.ctx.resume().catch(() => {}); };
    addEventListener('pointerdown', kick); addEventListener('keydown', kick);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
    this.ctx?.addEventListener?.('statechange', () => { if (this.ctx.state === 'interrupted') setTimeout(kick, 300); });
  }
  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? this.volume : 0, this.ctx.currentTime, 0.05);
  }
  setVolume(v) {
    this.volume = v;
    if (this.master && this.enabled) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }
  // st: { rpm, load, limiter, gear, speed (m/s), tyre: { squeal, scrub, pitch }, interior (bool) }
  update(st) {
    if (!this.ready) return;
    const t = this.ctx.currentTime, P = this.engine.parameters;
    // Follow the physics as tightly as the frame rate allows: the time constant is about half a
    // frame, so a slow phone frame doesn't turn into audible lag, and a fast one doesn't zipper.
    // Gear changes need no special handling: the physics drops the revs itself during a shift.
    const tau = Math.max(0.004, Math.min(0.03, (st.dt || 1 / 60) * 0.5));
    P.get('rpm').setTargetAtTime(st.rpm, t, tau);
    P.get('load').setTargetAtTime(st.load, t, tau);
    P.get('limiter').setValueAtTime(st.limiter, t);
    P.get('cut').setValueAtTime(0, t);
    P.get('interior').setTargetAtTime(st.interior ? 1 : 0, t, 0.08);
    const v = Math.abs(st.speed);
    const TP = this.tyre.parameters, ty = st.tyre;
    TP.get('squeal').setTargetAtTime(ty.squeal, t, 0.03);
    TP.get('scrub').setTargetAtTime(ty.scrub, t, 0.03);
    TP.get('pitch').setTargetAtTime(ty.pitch, t, 0.05);
    TP.get('speed').setTargetAtTime(v, t, 0.05);
    this.tyreGain.gain.setTargetAtTime(st.interior ? 0.5 : 0.85, t, 0.1);
    const wind = Math.min(1, (v / 70) ** 2);
    this.windG.gain.setTargetAtTime(wind * (st.interior ? 0.12 : 0.3), t, 0.1);
    this.roadG.gain.setTargetAtTime(Math.min(1, v / 45) * (st.interior ? 0.35 : 0.22), t, 0.1);
    this.engineGain.gain.setTargetAtTime(st.interior ? 0.75 : 0.9, t, 0.1);
  }
}
