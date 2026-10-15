// São Paulo World · flight test bed: the six-pack, drawn from the C++ instrument
// models' cockpit state (avd_cockpit). Ported from the Aviation Dynamics browser
// cockpit (github.com/ZRosserMcIntosh/Aviation-Dynamics, web/cockpit, MIT).
// Every needle shows what the simulated instrument indicates (lags, errors and
// failures included), never the aircraft's true state.

const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const FONT = '"Big Shoulders Display","Arial Narrow",sans-serif';
const MONO = '"JetBrains Mono",ui-monospace,monospace';
const C = {
  face: '#121314', bezel: '#0b0c0d', mark: '#f0eee6', dim: '#9fa19c', needle: '#f4f2ea',
  green: '#33b35a', yellow: '#e8c437', red: '#e0402f', white: '#f2f2ee',
  sky: '#4e7fb4', earth: '#6d5435', amber: '#f0a830', flag: '#c8322b', accent: '#ffd36b', lcd: '#9fe3a8',
};

// Cockpit-state buffer layout (Aviation Dynamics web/README.md).
export const K = {
  ias: 0, alt: 1, kollsman: 2, vsi: 3, aiPitch: 4, aiRoll: 5, aiTumbled: 6, dg: 7, bug: 8, tcDefl: 9, tcRate: 10,
  tcFlag: 11, ball: 12, compass: 13, rpm: 14, oilP: 15, oilT: 16, egt: 17, ff: 18, fuelL: 19, fuelR: 20, amps: 21,
  volts: 22, suction: 23, ann: 24, stall: 25, oat: 26, clock: 27, flaps: 28, trim: 29,
  navValid: 37, cdi: 38, toFrom: 39, gsValid: 40, gs: 41, loc: 42,
  tTas: 48, tCas: 49, tGs: 50, tAlt: 51, tVs: 53, tPitch: 54, tRoll: 55, tHdg: 56, tMag: 57, tAgl: 67, tAlpha: 68,
};

export function markingsFrom(M) {
  return {
    white: [M[0], M[1]], green: [M[2], M[3]], yellow: [M[4], M[5]], vne: M[6], dialMin: M[7], dialMax: M[8],
    tachGreen: [M[9], M[10]], tachRed: M[11], tachMax: M[12], vsiRange: M[23], stdRateDefl: M[27],
  };
}

function dial(ctx, x, y, r) {
  ctx.fillStyle = C.bezel; ctx.beginPath(); ctx.arc(x, y, r * 1.08, 0, 2 * Math.PI); ctx.fill();
  ctx.fillStyle = C.face; ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill();
}
function glass(ctx, x, y, r) {
  const g = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
  g.addColorStop(0, 'rgba(255,255,255,0.08)'); g.addColorStop(0.45, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,0.03)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill();
}
function needle(ctx, x, y, len, ang, w, tail = 0.18, color = C.needle) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(-w, len * tail); ctx.lineTo(-w * 0.55, -len); ctx.lineTo(0, -len - w * 1.6); ctx.lineTo(w * 0.55, -len); ctx.lineTo(w, len * tail); ctx.closePath(); ctx.fill();
  ctx.fillStyle = C.bezel; ctx.beginPath(); ctx.arc(0, 0, w * 1.5, 0, 2 * Math.PI); ctx.fill();
  ctx.restore();
}
function arcBand(ctx, x, y, r, a0, a1, color, width) {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); ctx.arc(x, y, r, a0 - Math.PI / 2, a1 - Math.PI / 2); ctx.stroke();
}
function ticks(ctx, x, y, r, from, to, step, angle, len, width, label, every, fmt) {
  ctx.strokeStyle = C.mark; ctx.fillStyle = C.mark; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  let i = 0;
  for (let v = from; v <= to + 1e-9; v += step, ++i) {
    const a = angle(v) - Math.PI / 2, major = every && i % every === 0;
    ctx.lineWidth = major ? width * 1.6 : width;
    const l = major ? len * 1.6 : len;
    ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); ctx.lineTo(x + Math.cos(a) * (r - l), y + Math.sin(a) * (r - l)); ctx.stroke();
    if (major && label) ctx.fillText(fmt ? fmt(v) : String(v), x + Math.cos(a) * (r - l - label), y + Math.sin(a) * (r - l - label));
  }
}
function flag(ctx, x, y, r, text) {
  ctx.fillStyle = C.flag; ctx.fillRect(x - r * 0.22, y - r * 0.1, r * 0.44, r * 0.2);
  ctx.fillStyle = '#fff'; ctx.font = `700 ${r * 0.15}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y + 1);
}

function asi(ctx, x, y, r, c, m) {
  dial(ctx, x, y, r);
  const a = (kt) => {
    const k = clamp(kt, 0, m.dialMax);
    return k <= m.dialMin ? (k / m.dialMin) * 22 * DEG : (22 + (k - m.dialMin) / (m.dialMax - m.dialMin) * 318) * DEG;
  };
  arcBand(ctx, x, y, r * 0.93, a(m.white[0]), a(m.white[1]), C.white, r * 0.05);
  arcBand(ctx, x, y, r * 0.86, a(m.green[0]), a(m.green[1]), C.green, r * 0.07);
  arcBand(ctx, x, y, r * 0.86, a(m.yellow[0]), a(m.yellow[1]), C.yellow, r * 0.07);
  ctx.strokeStyle = C.red; ctx.lineWidth = r * 0.035;
  const rv = a(m.vne) - Math.PI / 2;
  ctx.beginPath(); ctx.moveTo(x + Math.cos(rv) * r * 0.97, y + Math.sin(rv) * r * 0.97); ctx.lineTo(x + Math.cos(rv) * r * 0.76, y + Math.sin(rv) * r * 0.76); ctx.stroke();
  ctx.font = `600 ${r * 0.18}px ${FONT}`;
  ticks(ctx, x, y, r * 0.98, m.dialMin, m.dialMax, 10, a, r * 0.08, Math.max(1, r * 0.016), r * 0.16, 2);
  ctx.fillStyle = C.mark; ctx.font = `600 ${r * 0.13}px ${FONT}`; ctx.textAlign = 'center';
  ctx.fillText('AIRSPEED', x, y - r * 0.3); ctx.fillText('KNOTS', x, y + r * 0.32);
  needle(ctx, x, y, r * 0.8, a(c[K.ias]), r * 0.05);
  glass(ctx, x, y, r);
}

function ai(ctx, x, y, r, c) {
  ctx.save();
  ctx.fillStyle = C.bezel; ctx.beginPath(); ctx.arc(x, y, r * 1.08, 0, 2 * Math.PI); ctx.fill();
  ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.clip();
  const pitch = c[K.aiPitch] * DEG, roll = c[K.aiRoll] * DEG, ppx = r * 0.032 / DEG;
  ctx.translate(x, y); ctx.rotate(-roll); ctx.translate(0, pitch * ppx);
  ctx.fillStyle = C.sky; ctx.fillRect(-3 * r, -6 * r, 6 * r, 6 * r);
  ctx.fillStyle = C.earth; ctx.fillRect(-3 * r, 0, 6 * r, 6 * r);
  ctx.strokeStyle = C.mark; ctx.lineWidth = Math.max(1.5, r * 0.025); ctx.beginPath(); ctx.moveTo(-3 * r, 0); ctx.lineTo(3 * r, 0); ctx.stroke();
  ctx.lineWidth = Math.max(1, r * 0.016); ctx.font = `600 ${r * 0.13}px ${FONT}`; ctx.fillStyle = C.mark; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  for (const p of [-20, -15, -10, -5, 5, 10, 15, 20]) {
    const yy = -p * DEG * ppx, l = p % 10 === 0 ? r * 0.28 : r * 0.14;
    ctx.beginPath(); ctx.moveTo(-l, yy); ctx.lineTo(l, yy); ctx.stroke();
    if (p % 10 === 0) ctx.fillText(String(Math.abs(p)), l + r * 0.05, yy);
  }
  ctx.restore();
  ctx.save(); ctx.translate(x, y);
  ctx.strokeStyle = C.mark; ctx.lineWidth = Math.max(1.5, r * 0.025);
  for (const b of [-60, -45, -30, -20, -10, 10, 20, 30, 45, 60]) {
    const a = (b - 90) * DEG, l = Math.abs(b) % 30 === 0 ? r * 0.16 : r * 0.09;
    ctx.beginPath(); ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r); ctx.lineTo(Math.cos(a) * (r - l), Math.sin(a) * (r - l)); ctx.stroke();
  }
  ctx.fillStyle = C.mark; ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(-r * 0.06, -r * 0.88); ctx.lineTo(r * 0.06, -r * 0.88); ctx.fill();
  ctx.rotate(-roll); ctx.fillStyle = C.amber;
  ctx.beginPath(); ctx.moveTo(0, -r * 0.84); ctx.lineTo(-r * 0.06, -r * 0.72); ctx.lineTo(r * 0.06, -r * 0.72); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = C.amber; ctx.lineWidth = r * 0.05; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x - r * 0.5, y); ctx.lineTo(x - r * 0.16, y); ctx.lineTo(x - r * 0.08, y + r * 0.08); ctx.moveTo(x + r * 0.5, y); ctx.lineTo(x + r * 0.16, y); ctx.lineTo(x + r * 0.08, y + r * 0.08); ctx.stroke();
  ctx.fillStyle = C.amber; ctx.beginPath(); ctx.arc(x, y, r * 0.035, 0, 2 * Math.PI); ctx.fill();
  ctx.lineCap = 'butt';
  if (c[K.aiTumbled]) flag(ctx, x, y + r * 0.55, r, 'GYRO');
  glass(ctx, x, y, r);
}

function alt(ctx, x, y, r, c) {
  dial(ctx, x, y, r);
  const h = c[K.alt];
  ctx.font = `600 ${r * 0.2}px ${FONT}`;
  ticks(ctx, x, y, r * 0.98, 0, 9.8, 0.2, (v) => (v / 10) * 2 * Math.PI, r * 0.08, Math.max(1, r * 0.016), r * 0.17, 5, (v) => String(Math.round(v)));
  ctx.fillStyle = '#000'; ctx.fillRect(x + r * 0.26, y - r * 0.1, r * 0.5, r * 0.2);
  ctx.fillStyle = C.mark; ctx.font = `${r * 0.15}px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(c[K.kollsman].toFixed(2), x + r * 0.51, y + 1);
  ctx.font = `600 ${r * 0.11}px ${FONT}`; ctx.fillStyle = C.dim; ctx.fillText('ALT · FEET', x, y - r * 0.32);
  const a = (v, per) => ((((v % per) + per) % per) / per) * 2 * Math.PI;
  needle(ctx, x, y, r * 0.86, a(h, 100000), r * 0.02, 0.05, C.mark);
  needle(ctx, x, y, r * 0.48, a(h, 10000), r * 0.065, 0.15);
  needle(ctx, x, y, r * 0.8, a(h, 1000), r * 0.045, 0.2);
  glass(ctx, x, y, r);
}

function vsi(ctx, x, y, r, c, m) {
  dial(ctx, x, y, r);
  const range = m.vsiRange;
  const a = (fpm) => -Math.PI / 2 + (clamp(fpm, -range * 1.08, range * 1.08) / range) * 170 * DEG;
  ctx.font = `600 ${r * 0.19}px ${FONT}`;
  ticks(ctx, x, y, r * 0.98, -range, range, 100, a, r * 0.08, Math.max(1, r * 0.015), r * 0.17, 5, (v) => String(Math.abs(v / 100) | 0));
  ctx.fillStyle = C.dim; ctx.font = `600 ${r * 0.11}px ${FONT}`; ctx.textAlign = 'center';
  ctx.fillText('UP', x - r * 0.35, y - r * 0.25); ctx.fillText('DOWN', x - r * 0.35, y + r * 0.27);
  ctx.fillText('VERT SPEED', x + r * 0.22, y - r * 0.12); ctx.fillText('100 FT/MIN', x + r * 0.22, y + r * 0.12);
  needle(ctx, x, y, r * 0.8, a(c[K.vsi]), r * 0.05);
  glass(ctx, x, y, r);
}

function hi(ctx, x, y, r, c) {
  dial(ctx, x, y, r);
  ctx.save(); ctx.translate(x, y); ctx.rotate(-c[K.dg] * DEG);
  ctx.strokeStyle = C.mark; ctx.fillStyle = C.mark; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let d = 0; d < 360; d += 5) {
    const a = (d - 90) * DEG, l = d % 10 === 0 ? r * 0.12 : r * 0.07;
    ctx.lineWidth = d % 30 === 0 ? Math.max(1.5, r * 0.025) : Math.max(1, r * 0.015);
    ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * 0.96, Math.sin(a) * r * 0.96); ctx.lineTo(Math.cos(a) * (r * 0.96 - l), Math.sin(a) * (r * 0.96 - l)); ctx.stroke();
    if (d % 30 === 0) {
      ctx.save(); ctx.rotate(d * DEG); ctx.font = `600 ${r * 0.2}px ${FONT}`;
      ctx.fillText({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[d] ?? String(d / 10), 0, -r * 0.66); ctx.restore();
    }
  }
  ctx.rotate(c[K.bug] * DEG); ctx.fillStyle = C.accent; ctx.fillRect(-r * 0.07, -r * 0.99, r * 0.14, r * 0.07);
  ctx.restore();
  ctx.fillStyle = C.amber; ctx.beginPath(); ctx.moveTo(x, y - r * 0.82); ctx.lineTo(x - r * 0.05, y - r * 0.97); ctx.lineTo(x + r * 0.05, y - r * 0.97); ctx.fill();
  ctx.strokeStyle = C.amber; ctx.lineWidth = r * 0.045; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x, y - r * 0.3); ctx.lineTo(x, y + r * 0.3); ctx.moveTo(x - r * 0.28, y - r * 0.02); ctx.lineTo(x + r * 0.28, y - r * 0.02); ctx.moveTo(x - r * 0.12, y + r * 0.26); ctx.lineTo(x + r * 0.12, y + r * 0.26); ctx.stroke();
  ctx.lineCap = 'butt';
  glass(ctx, x, y, r);
}

function tc(ctx, x, y, r, c, m) {
  dial(ctx, x, y, r);
  ctx.fillStyle = C.mark; ctx.font = `600 ${r * 0.13}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('TURN COORDINATOR', x, y - r * 0.55); ctx.fillText('2 MIN', x, y + r * 0.75);
  ctx.fillText('L', x - r * 0.72, y + r * 0.42); ctx.fillText('R', x + r * 0.72, y + r * 0.42);
  ctx.strokeStyle = C.mark; ctx.lineWidth = Math.max(2, r * 0.035);
  for (const a of [0, m.stdRateDefl, -m.stdRateDefl]) for (const side of [-1, 1]) {
    const ang = a * DEG + (side < 0 ? Math.PI : 0);
    ctx.beginPath(); ctx.moveTo(x + Math.cos(ang) * r * 0.78, y + Math.sin(ang) * r * 0.78); ctx.lineTo(x + Math.cos(ang) * r * 0.94, y + Math.sin(ang) * r * 0.94); ctx.stroke();
  }
  ctx.save(); ctx.translate(x, y); ctx.rotate(c[K.tcDefl] * DEG);
  ctx.strokeStyle = C.mark; ctx.fillStyle = C.mark; ctx.lineWidth = r * 0.055; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-r * 0.7, 0); ctx.lineTo(r * 0.7, 0); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, r * 0.1, 0, 2 * Math.PI); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-r * 0.18, -r * 0.2); ctx.lineTo(r * 0.18, -r * 0.2); ctx.moveTo(0, -r * 0.08); ctx.lineTo(0, -r * 0.28); ctx.stroke();
  ctx.restore(); ctx.lineCap = 'butt';
  const ty = y + r * 0.42, tr = r * 1.6, limit = 16;
  ctx.save();
  ctx.strokeStyle = '#d8d6cc'; ctx.lineWidth = r * 0.16; ctx.globalAlpha = 0.25;
  ctx.beginPath(); ctx.arc(x, ty - tr, tr, Math.PI / 2 - 0.2, Math.PI / 2 + 0.2); ctx.stroke();
  ctx.globalAlpha = 1;
  const ba = Math.PI / 2 - clamp(c[K.ball], -limit, limit) / limit * 0.18;
  ctx.fillStyle = '#0a0a0a'; ctx.strokeStyle = C.mark; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(x + Math.cos(ba) * tr, ty - tr + Math.sin(ba) * tr, r * 0.065, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
  ctx.lineWidth = Math.max(1, r * 0.018);
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(x + s * r * 0.085, ty - r * 0.09); ctx.lineTo(x + s * r * 0.085, ty + r * 0.09); ctx.stroke(); }
  ctx.restore();
  if (c[K.tcFlag]) flag(ctx, x - r * 0.48, y - r * 0.3, r, 'OFF');
  glass(ctx, x, y, r);
}

function tach(ctx, x, y, r, c, m) {
  dial(ctx, x, y, r);
  const a = (rpm) => (-130 + clamp(rpm, 0, m.tachMax) / m.tachMax * 260) * DEG;
  arcBand(ctx, x, y, r * 0.88, a(m.tachGreen[0]), a(m.tachGreen[1]), C.green, r * 0.11);
  ctx.strokeStyle = C.red; ctx.lineWidth = r * 0.05; const tr = a(m.tachRed) - Math.PI / 2;
  ctx.beginPath(); ctx.moveTo(x + Math.cos(tr) * r * 0.98, y + Math.sin(tr) * r * 0.98); ctx.lineTo(x + Math.cos(tr) * r * 0.72, y + Math.sin(tr) * r * 0.72); ctx.stroke();
  ctx.font = `600 ${r * 0.2}px ${FONT}`;
  ticks(ctx, x, y, r * 0.98, 0, m.tachMax, 500, a, r * 0.09, Math.max(1, r * 0.018), r * 0.17, 2, (v) => String(v / 100));
  ctx.fillStyle = C.dim; ctx.font = `600 ${r * 0.13}px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText('RPM × 100', x, y + r * 0.38);
  ctx.fillStyle = C.lcd; ctx.font = `${r * 0.2}px ${MONO}`; ctx.fillText(c[K.rpm].toFixed(0), x, y + r * 0.66);
  needle(ctx, x, y, r * 0.8, a(c[K.rpm]), r * 0.05);
  glass(ctx, x, y, r);
}

// Draws the panel into `ctx` (CSS pixels). Layout "row": seven dials in a line
// (ASI AI ALT TC HI VSI TACH); "grid": the classic 3 x 2 six-pack plus the tach.
export function drawPanel(ctx, w, h, c, m, layout) {
  ctx.clearRect(0, 0, w, h);
  if (layout === 'row') {
    const r = Math.min(h * 0.44, w / 15.4);
    const step = w / 7;
    const fns = [asi, ai, alt, tc, hi, vsi, tach];
    fns.forEach((f, i) => f(ctx, step * (i + 0.5), h / 2, r, c, m));
  } else {
    const r = Math.min(w / 7.2, h / 4.6);
    const cols = [w / 6, w / 2, (5 * w) / 6], rows = [r * 1.15, r * 3.45];
    asi(ctx, cols[0], rows[0], r, c, m); ai(ctx, cols[1], rows[0], r, c); alt(ctx, cols[2], rows[0], r, c);
    tc(ctx, cols[0], rows[1], r, c, m); hi(ctx, cols[1], rows[1], r, c); vsi(ctx, cols[2], rows[1], r, c, m);
  }
}
