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

    // tyre squeal: tonal-ish band of noise that shifts with slip
    this.squealF = ctx.createBiquadFilter(); this.squealF.type = 'bandpass'; this.squealF.frequency.value = 1100; this.squealF.Q.value = 9;
    const sq2 = ctx.createBiquadFilter(); sq2.type = 'bandpass'; sq2.frequency.value = 2300; sq2.Q.value = 6;
    this.squealG = ctx.createGain(); this.squealG.gain.value = 0;
    const sqSrc = noise();
    sqSrc.connect(this.squealF).connect(this.squealG); sqSrc.connect(sq2).connect(this.squealG);
    this.squealG.connect(this.master);
    this.squealF2 = sq2;
    // wind
    const wf = ctx.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 700;
    this.windG = ctx.createGain(); this.windG.gain.value = 0;
    noise().connect(wf).connect(this.windG).connect(this.master);
    // road / tyre roar
    const rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 170;
    this.roadG = ctx.createGain(); this.roadG.gain.value = 0;
    noise().connect(rf).connect(this.roadG).connect(this.master);
    this.ready = true;
  }
  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? this.volume : 0, this.ctx.currentTime, 0.05);
  }
  setVolume(v) {
    this.volume = v;
    if (this.master && this.enabled) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }
  // st: { rpm, load, limiter, gear, speed (m/s), slip (0..), interior (bool) }
  update(st) {
    if (!this.ready) return;
    const t = this.ctx.currentTime, P = this.engine.parameters;
    // upshift under power: short ignition cut (the "bwaap" between gears)
    if (this.lastGear !== null && st.gear > this.lastGear && st.gear > 1 && st.load > 0.3) this.cutUntil = t + 0.075;
    this.lastGear = st.gear;
    P.get('rpm').setTargetAtTime(st.rpm, t, 0.01);
    P.get('load').setTargetAtTime(st.load, t, 0.02);
    P.get('limiter').setValueAtTime(st.limiter, t);
    P.get('cut').setValueAtTime(t < this.cutUntil ? 1 : 0, t);
    P.get('interior').setTargetAtTime(st.interior ? 1 : 0, t, 0.08);
    const v = Math.abs(st.speed);
    const sq = Math.max(0, Math.min(1, (st.slip - 0.95) * 1.6)) * Math.min(1, v / 4);
    this.squealG.gain.setTargetAtTime(sq * 0.55, t, 0.04);
    this.squealF.frequency.setTargetAtTime(950 + 380 * Math.min(1, st.slip - 0.9), t, 0.05);
    this.squealF2.frequency.setTargetAtTime(2100 + 500 * Math.min(1, st.slip - 0.9), t, 0.05);
    const wind = Math.min(1, (v / 70) ** 2);
    this.windG.gain.setTargetAtTime(wind * (st.interior ? 0.12 : 0.3), t, 0.1);
    this.roadG.gain.setTargetAtTime(Math.min(1, v / 45) * (st.interior ? 0.35 : 0.22), t, 0.1);
    this.engineGain.gain.setTargetAtTime(st.interior ? 0.75 : 0.9, t, 0.1);
  }
}
