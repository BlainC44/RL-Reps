#!/usr/bin/env node
// Generates the illustrations for the sample courses: looping animated SVG
// "clips" and step-by-step picture strips. Run with `npm run media`.
//
// Each move is described once as a timeline (where the car and ball are at
// each moment). From that one timeline we render:
//   <name>-clip.svg   an animated loop with the current step highlighted
//   <name>-steps.svg  a comic strip of the key positions, numbered
//
// These are simplified illustrations, not exact game physics.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'courses');

// ---------- palette ----------
const C = {
  bg: '#11141b',
  turf: '#17251c',
  turfLine: '#2f6b3f',
  text: '#e9ecf2',
  muted: '#8a93a6',
  accent: '#ff7a1a',
  car: '#3b82f6',
  carDark: '#1d4ed8',
  glass: '#bfe3ff',
  ball: '#e5e7eb',
  ballLine: '#9ca3af',
  ghost: '#94a3b8',
  good: '#3ccf8e',
};
const FONT = "font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";

// ---------- math helpers ----------
const r2 = (n) => Math.round(n * 100) / 100;
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const EASE = {
  lin: (u) => u,
  in: (u) => u * u, // speeding up (falling)
  out: (u) => 1 - (1 - u) * (1 - u), // slowing down (rising)
  io: (u) => (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u)),
};

// keys: [[time, {x, y, a, sx, sy}, ease], ...]; missing props carry forward.
function track(keys) {
  let prev = { x: 0, y: 0, a: 0, sx: 1, sy: 1 };
  const full = keys.map(([t, s, e]) => {
    prev = { ...prev, ...s };
    return { t, s: prev, e: EASE[e || 'lin'] };
  });
  return (t) => {
    if (t <= full[0].t) return full[0].s;
    for (let i = 1; i < full.length; i++) {
      if (t <= full[i].t) {
        const A = full[i - 1];
        const B = full[i];
        const u = B.e((t - A.t) / (B.t - A.t));
        const out = {};
        for (const k of Object.keys(B.s)) out[k] = A.s[k] + (B.s[k] - A.s[k]) * u;
        return out;
      }
    }
    return full[full.length - 1].s;
  };
}

const during = (intervals) => (t) => intervals.some(([a, b]) => t >= a && t < b);

// ---------- SMIL animation builders ----------
function grid(D) {
  const n = Math.ceil(D / 0.04);
  return Array.from({ length: n + 1 }, (_, i) => (D * i) / n);
}

function keyTimes(times, D) {
  return times.map((t) => (t / D).toFixed(4)).join(';');
}

function animTransform(type, D, times, values) {
  return `<animateTransform attributeName="transform" type="${type}" dur="${D}s" repeatCount="indefinite" keyTimes="${keyTimes(times, D)}" values="${values.join(';')}"/>`;
}

// Discrete on/off opacity from a list of visible [start, end) intervals.
function animVisible(D, intervals, on = 1, off = 0) {
  const vis = during(intervals);
  const pts = [[0, vis(0) ? on : off]];
  for (const [a, b] of intervals) {
    if (a > 0) pts.push([a, on]);
    if (b < D) pts.push([b, off]);
  }
  pts.sort((p, q) => p[0] - q[0]);
  const dedup = pts.filter((p, i) => i === 0 || p[0] > pts[i - 1][0]);
  return {
    initial: dedup[0][1],
    tag: `<animate attributeName="opacity" dur="${D}s" repeatCount="indefinite" calcMode="discrete" keyTimes="${keyTimes(dedup.map((p) => p[0]), D)}" values="${dedup.map((p) => p[1]).join(';')}"/>`,
  };
}

// Car with translate → rotate → scale, each animated from its timeline.
function animatedCar(D, fn, inner, { boost } = {}) {
  const T = grid(D);
  const S = T.map(fn);
  const flame = boost ? animVisible(D, boost) : null;
  return `<g>${animTransform('translate', D, T, S.map((s) => `${r2(s.x)} ${r2(s.y)}`))}
  <g>${animTransform('rotate', D, T, S.map((s) => r2(s.a)))}
  <g>${animTransform('scale', D, T, S.map((s) => `${r2(s.sx)} ${r2(s.sy)}`))}
    ${flame ? `<g opacity="${flame.initial}">${flame.tag}<use href="#flame"/></g>` : ''}
    ${inner}
  </g></g></g>`;
}

function animatedPoint(D, fn, inner) {
  const T = grid(D);
  return `<g>${animTransform('translate', D, T, T.map(fn).map((p) => `${r2(p.x)} ${r2(p.y)}`))}${inner}</g>`;
}

// ---------- shapes ----------
// Side view: car faces right, centered on (0,0); wheels touch y = +12.
const DEFS_SIDE = `
<defs>
  <g id="car">
    <path d="M-38,-2 L-38,-11 Q-38,-15 -34,-15 L-20,-15 L-10,-27 L16,-27 L27,-15 L35,-15 Q39,-15 39,-11 L39,-2 Q39,2 35,2 L-34,2 Q-38,2 -38,-2 Z" fill="${C.car}" stroke="${C.carDark}" stroke-width="1.5"/>
    <path d="M-16,-15 L-8,-24 L5,-24 L5,-15 Z" fill="${C.glass}"/>
    <path d="M8,-24 L14,-24 L22,-15 L8,-15 Z" fill="${C.glass}"/>
    <rect x="34" y="-11" width="5" height="4" rx="1" fill="#ffe08a"/>
    <rect x="-38" y="-11" width="3" height="4" fill="#ef4444"/>
    <circle cx="-23" cy="4" r="8" fill="#1f2229" stroke="#4b5563" stroke-width="1.5"/><circle cx="-23" cy="4" r="3" fill="#9ca3af"/>
    <circle cx="24" cy="4" r="8" fill="#1f2229" stroke="#4b5563" stroke-width="1.5"/><circle cx="24" cy="4" r="3" fill="#9ca3af"/>
  </g>
  <g id="flame">
    <path d="M-38,-13 L-66,-8 L-38,-3 Z" fill="${C.accent}"/>
    <path d="M-38,-11 L-54,-8 L-38,-5 Z" fill="#ffd166"/>
  </g>
  <g id="ball">
    <circle r="18" fill="${C.ball}" stroke="${C.ballLine}" stroke-width="1.5"/>
    <path d="M-12,-13 Q0,-4 12,-13 M-17,5 Q0,0 17,5 M-6,17 Q0,8 6,17" fill="none" stroke="${C.ballLine}" stroke-width="1.5"/>
  </g>
</defs>`;

// Top-down view: car faces up (−y), centered on (0,0).
const DEFS_TOP = `
<defs>
  <g id="tcar">
    <rect x="-13" y="-22" width="26" height="44" rx="6" fill="${C.car}" stroke="${C.carDark}" stroke-width="1.5"/>
    <path d="M-10,-10 L10,-10 L8,-2 L-8,-2 Z" fill="${C.glass}"/>
    <rect x="-9" y="6" width="18" height="8" rx="2" fill="${C.carDark}"/>
    <rect x="-12" y="-22" width="6" height="3" fill="#ffe08a"/><rect x="6" y="-22" width="6" height="3" fill="#ffe08a"/>
  </g>
  <g id="tball">
    <circle r="14" fill="${C.ball}" stroke="${C.ballLine}" stroke-width="1.5"/>
    <path d="M-9,-10 Q0,-3 9,-10 M-13,4 Q0,0 13,4" fill="none" stroke="${C.ballLine}" stroke-width="1.5"/>
  </g>
</defs>`;

function svgDoc(W, H, defs, body, title) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">
<title>${esc(title)}</title>
<style>text{${FONT}}</style>
${defs}
<rect width="${W}" height="${H}" fill="${C.bg}"/>
${body}
</svg>
`;
}

// ---------- side-view scenes ----------
const W = 640;
const GROUND = 262;
const CAR_Y = GROUND - 12; // car center when sitting on its wheels
const BALL_Y = GROUND - 18;

function ground(H, y = GROUND) {
  return `<rect x="0" y="${y}" width="${W}" height="${H - y}" fill="${C.turf}"/><line x1="0" x2="${W}" y1="${y}" y2="${y}" stroke="${C.turfLine}" stroke-width="2"/>`;
}

// Numbered step list; the active step lights up while the clip plays.
function stepLegend(D, steps, x = 16, y = 20) {
  return steps
    .map((s, i) => {
      const yy = y + i * 24;
      const hi = animVisible(D, [[s.from, s.to]]);
      const dim = animVisible(D, [[s.from, s.to]], 0, 0.45); // hide the dim copy while lit
      const row = (fill, textFill, weight) => `<circle cx="${x + 10}" cy="${yy}" r="10" fill="${fill}"/>
        <text x="${x + 10}" y="${yy + 4}" font-size="12" font-weight="700" text-anchor="middle" fill="${fill === C.accent ? '#14161c' : C.text}">${i + 1}</text>
        <text x="${x + 28}" y="${yy + 5}" font-size="14" font-weight="${weight}" fill="${textFill}">${esc(s.label)}</text>`;
      return `<g opacity="${dim.initial}">${dim.tag}${row('#2a2f3b', C.muted, 500)}</g>
      <g opacity="${hi.initial}">${hi.tag}${row(C.accent, C.text, 700)}</g>`;
    })
    .join('\n');
}

function footer(H, text = 'Simplified illustration') {
  return `<text x="${W - 12}" y="${H - 10}" font-size="11" text-anchor="end" fill="${C.muted}">${text}</text>`;
}

function sideClip(m) {
  const H = m.height || 300;
  const parts = [ground(H)];
  if (m.decor) parts.push(m.decor);
  if (m.ball) parts.push(animatedPoint(m.D, m.ball, '<use href="#ball"/>'));
  if (m.ghost) {
    parts.push(`<g opacity="0.35">${animatedCar(m.D, m.ghost.fn, `<use href="#car"/>`)}</g>`);
    parts.push(animatedPoint(m.D, m.ghost.fn, `<text y="-34" font-size="12" text-anchor="middle" fill="${C.ghost}">${esc(m.ghost.label)}</text>`));
  }
  if (m.underCar) parts.push(m.underCar);
  parts.push(animatedCar(m.D, m.car, '<use href="#car"/>', { boost: m.boost }));
  if (m.overlay) parts.push(m.overlay);
  parts.push(stepLegend(m.D, m.steps));
  parts.push(footer(H));
  return svgDoc(W, H, DEFS_SIDE, parts.join('\n'), `${m.title} (animated)`);
}

// Comic strip: one panel per key moment, camera follows the car.
function wrap(text, max) {
  const words = text.split(' ');
  const lines = [''];
  for (const w of words) {
    const cur = lines[lines.length - 1];
    if ((cur + ' ' + w).trim().length > max && cur) lines.push(w);
    else lines[lines.length - 1] = (cur + ' ' + w).trim();
  }
  return lines;
}

function sideSteps(m) {
  const frames = m.frames;
  const n = frames.length;
  const pw = W / n;
  const ph = 190;
  const pg = 160; // ground line inside a panel
  const k = Math.min(1, (pw - 24) / 110);
  const H = ph + 64;
  const panels = frames.map((f, i) => {
    const s = m.car(f.t);
    const px = i * pw;
    const cx = px + pw / 2;
    let cy = pg + (s.y - GROUND) * k;
    const cam = Math.max(0, 48 - cy);
    cy += cam;
    const groundY = pg + cam;
    const boosting = m.boost && during(m.boost)(f.t);
    const ball = m.ball ? m.ball(f.t) : null;
    const ballSvg = ball
      ? `<g transform="translate(${r2(cx + (ball.x - s.x) * k)} ${r2(pg + (ball.y - GROUND) * k + cam)}) scale(${r2(k)})"><use href="#ball"/></g>`
      : '';
    const air = groundY > ph - 4 ? `<text x="${px + pw / 2}" y="${ph - 10}" font-size="11" text-anchor="middle" fill="${C.muted}">↑ high in the air</text>` : '';
    const lines = wrap(f.label, Math.floor(pw / 7.4));
    return `<g>
      <clipPath id="p${i}"><rect x="${px + 4}" y="4" width="${pw - 8}" height="${ph - 8}" rx="10"/></clipPath>
      <rect x="${px + 4}" y="4" width="${pw - 8}" height="${ph - 8}" rx="10" fill="#151923" stroke="#2a2f3b"/>
      <g clip-path="url(#p${i})">
        <rect x="${px}" y="${groundY}" width="${pw}" height="${Math.max(0, ph - groundY)}" fill="${C.turf}"/>
        <line x1="${px}" x2="${px + pw}" y1="${groundY}" y2="${groundY}" stroke="${C.turfLine}" stroke-width="2"/>
        ${ballSvg}
        ${f.fx === 'dust' ? `<g transform="translate(${r2(cx)} ${r2(cy)}) scale(${r2(k)})" fill="#6b7280"><circle cx="-34" cy="8" r="8" opacity=".6"/><circle cx="-20" cy="4" r="10" opacity=".5"/><circle cx="-6" cy="9" r="6" opacity=".6"/></g>` : ''}
        ${f.fx === 'roll' ? `<g transform="translate(${r2(cx)} ${r2(cy)})"><path d="M-30,-26 A40,30 0 1 1 -40,10" fill="none" stroke="${C.accent}" stroke-width="2.5" marker-end="url(#rollhead)"/></g>` : ''}
        ${f.fx === 'speed' ? `<g transform="translate(${r2(cx)} ${r2(cy)}) scale(${r2(k)})"><path d="M-46,-18 h-24 M-44,-8 h-34 M-46,2 h-22" stroke="${C.text}" stroke-width="3" stroke-linecap="round" opacity=".7"/></g>` : ''}
        <g transform="translate(${r2(cx)} ${r2(cy)}) scale(${r2(k)}) rotate(${r2(s.a)}) scale(${r2(s.sx)} ${r2(s.sy)})">
          ${boosting ? '<use href="#flame"/>' : ''}<use href="#car"/>
        </g>
        ${air}
      </g>
      <circle cx="${px + 22}" cy="24" r="12" fill="${C.accent}"/>
      <text x="${px + 22}" y="28.5" font-size="13" font-weight="800" text-anchor="middle" fill="#14161c">${i + 1}</text>
      ${lines.map((l, j) => `<text x="${cx}" y="${ph + 18 + j * 17}" font-size="13" font-weight="${j === 0 ? 600 : 500}" text-anchor="middle" fill="${C.text}">${esc(l)}</text>`).join('')}
    </g>`;
  });
  const extraDefs = `<defs><marker id="rollhead" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 Z" fill="${C.accent}"/></marker></defs>`;
  return svgDoc(W, H, DEFS_SIDE + extraDefs, panels.join('\n'), `${m.title} — step by step`);
}

// ---------- the moves ----------
const MOVES = {};

MOVES['aerial-foundations/first-touches'] = {
  title: 'First touch off the bounce',
  D: 6,
  car: track([
    [0, { x: 40, y: CAR_Y, a: 0 }],
    [2.3, { x: 395, y: CAR_Y }],
    [2.7, { x: 425, y: 194, a: -10 }, 'out'],
    [3.1, { x: 442, y: 180, a: -6 }, 'out'],
    [3.7, { x: 462, y: CAR_Y, a: 0 }, 'in'],
  ]),
  ball: track([
    [0, { x: 470, y: 40 }],
    [1.0, { y: BALL_Y }, 'in'],
    [2.0, { y: 110 }, 'out'],
    [2.7, { y: 160 }, 'in'],
    [3.4, { x: 680, y: 30 }, 'out'],
  ]),
  steps: [
    { label: 'Drive to where it will land', from: 0, to: 2.3 },
    { label: 'Jump as it starts to fall', from: 2.3, to: 2.7 },
    { label: 'Hit it with the front of the car', from: 2.7, to: 6 },
  ],
  frames: [
    { t: 1.6, label: 'Drive to the landing spot' },
    { t: 2.45, label: 'Jump as it comes down' },
    { t: 2.7, label: 'Front of the car hits it' },
  ],
};

MOVES['aerial-foundations/basic-aerial'] = {
  title: 'The basic aerial',
  D: 6.5,
  car: track([
    [0, { x: 40, y: CAR_Y, a: 0 }],
    [1.2, { x: 190 }],
    [1.5, { x: 215, y: 222, a: -30 }, 'out'],
    [1.75, { x: 234, y: 208, a: -40 }],
    [3.3, { x: 432, y: 124, a: -24 }],
    [3.9, { x: 482, y: 116, a: -14 }, 'out'],
    [4.8, { x: 540, y: CAR_Y, a: 0 }, 'in'],
  ]),
  ball: track([
    [0, { x: 470, y: 100 }],
    [3.3, {}],
    [3.9, { x: 680, y: 25 }, 'out'],
  ]),
  boost: [[1.5, 3.3]],
  steps: [
    { label: 'Line up facing the ball', from: 0, to: 1.2 },
    { label: 'Jump', from: 1.2, to: 1.5 },
    { label: 'Tilt back (nose up)', from: 1.5, to: 1.75 },
    { label: 'Hold boost, steer at the ball', from: 1.75, to: 3.3 },
    { label: 'Hit!', from: 3.3, to: 6.5 },
  ],
  frames: [
    { t: 0.6, label: 'Line up' },
    { t: 1.35, label: 'Jump' },
    { t: 1.75, label: 'Tilt back, start boosting' },
    { t: 2.6, label: 'Steer at the ball' },
    { t: 3.3, label: 'Hit' },
  ],
};

// Fast aerial: taller canvas with a controller-input timeline underneath.
{
  const D = 5.5;
  const inputs = [
    { label: 'Boost', bars: [[0.6, 2.2]] },
    { label: 'Jump', bars: [[0.6, 0.85], [0.95, 1.07]] },
    { label: 'Stick back', bars: [[0.6, 2.2]] },
  ];
  const x0 = 120;
  const x1 = 610;
  const top = 300;
  const tx = (t) => x0 + ((x1 - x0) * t) / D;
  const rows = inputs
    .map((row, i) => {
      const y = top + 12 + i * 22;
      return `<text x="${x0 - 10}" y="${y + 11}" font-size="12" text-anchor="end" fill="${C.muted}">${row.label}</text>
      <rect x="${x0}" y="${y}" width="${x1 - x0}" height="14" rx="4" fill="#1b1f29"/>
      ${row.bars.map(([a, b]) => `<rect x="${r2(tx(a))}" y="${y}" width="${r2(tx(b) - tx(a))}" height="14" rx="4" fill="${row.label === 'Jump' ? C.good : C.accent}"/>`).join('')}`;
    })
    .join('\n');
  const playhead = `<g>${animTransform('translate', D, [0, D], [`${x0} 0`, `${x1} 0`])}<line x1="0" x2="0" y1="${top + 6}" y2="${top + 80}" stroke="${C.text}" stroke-width="2"/></g>`;
  const note = `<text x="${r2(tx(0.95) + 4)}" y="${top + 4}" font-size="11" fill="${C.good}">↓ 2nd jump, quickly</text>`;

  MOVES['aerial-foundations/fast-aerial'] = {
    title: 'The fast aerial',
    D,
    height: 390,
    car: track([
      [0, { x: 340, y: CAR_Y, a: 0 }],
      [0.6, { x: 350 }],
      [0.95, { x: 362, y: 205, a: -45 }, 'out'],
      [1.4, { x: 378, y: 135, a: -62 }, 'out'],
      [2.2, { x: 402, y: 55, a: -70 }],
      [2.7, { x: 414, y: 42, a: -50 }, 'out'],
      [3.6, { x: 446, y: CAR_Y, a: 0 }, 'in'],
    ]),
    boost: [[0.6, 2.2]],
    steps: [
      { label: 'Boost + jump, hold jump', from: 0.6, to: 0.95 },
      { label: 'Jump again, stick still back', from: 0.95, to: 1.4 },
      { label: 'Keep boosting upward', from: 1.4, to: 2.2 },
      { label: 'Land on your wheels', from: 2.2, to: 5.5 },
    ],
    overlay: `<rect x="0" y="${GROUND + 26}" width="${W}" height="${390 - GROUND - 26}" fill="${C.bg}"/>
      <text x="16" y="${top - 4}" font-size="12" font-weight="700" fill="${C.text}">Controller inputs</text>
      ${note}${rows}${playhead}`,
    frames: [
      { t: 0.85, label: 'Boost + jump, tilt back' },
      { t: 1.2, label: 'Second jump, stick back' },
      { t: 2.0, label: 'Keep boosting up' },
    ],
  };
}

MOVES['recovery-and-movement/land-on-wheels'] = {
  title: 'Landing on your wheels',
  D: 5,
  car: track([
    [0, { x: 80, y: 205, a: 0 }],
    [0.6, { x: 220, y: 128, a: -200 }, 'out'],
    [1.3, { x: 330, y: 122, a: -300 }],
    [2.1, { x: 420, y: 195, a: -352 }, 'in'],
    [2.4, { x: 455, y: CAR_Y, a: -360 }, 'in'],
    [3.4, { x: 600 }],
  ]),
  steps: [
    { label: 'Knocked into the air: look at the ground', from: 0, to: 1.3 },
    { label: 'Rotate wheels-down (air roll / pitch)', from: 1.3, to: 2.1 },
    { label: 'Land level and drive away', from: 2.1, to: 5 },
  ],
  frames: [
    { t: 0.6, label: 'Spinning: find the ground' },
    { t: 1.7, label: 'Rotate wheels toward it' },
    { t: 2.4, label: 'Land level, keep driving' },
  ],
};

MOVES['recovery-and-movement/half-flip'] = {
  title: 'The half-flip',
  D: 6,
  car: track([
    [0, { x: 80, y: CAR_Y, a: 0, sx: -1, sy: 1 }],
    [1.2, { x: 250 }],
    [1.45, { x: 285, y: 215, a: 60 }, 'out'],
    [1.75, { x: 320, y: 196, a: 170 }],
    [2.0, { x: 345, y: 192, a: 180 }, 'out'],
    [2.5, { x: 385, y: 205, sy: -1 }, 'io'],
    [2.8, { x: 420, y: CAR_Y }, 'in'],
    [3.8, { x: 600 }],
  ]),
  steps: [
    { label: 'Drive backward', from: 0, to: 1.2 },
    { label: 'Backflip', from: 1.2, to: 1.75 },
    { label: 'Cancel: push stick forward', from: 1.75, to: 2.0 },
    { label: 'Air roll upright', from: 2.0, to: 2.5 },
    { label: 'Drive away forward', from: 2.5, to: 6 },
  ],
  decor: `<text x="${W / 2}" y="${GROUND + 26}" font-size="12" text-anchor="middle" fill="${C.muted}">momentum → keeps going the same way</text>`,
  frames: [
    { t: 0.8, label: 'Drive backward' },
    { t: 1.5, label: 'Backflip' },
    { t: 1.95, label: 'Cancel (stick forward)' },
    { t: 2.2, label: 'Air roll upright', fx: 'roll' },
    { t: 3.1, label: 'Drive away' },
  ],
};

{
  const slow = track([
    [0, { x: 40, y: CAR_Y, a: 0 }],
    [3.3, { x: 502 }],
  ]);
  MOVES['recovery-and-movement/wavedash'] = {
    title: 'The wavedash',
    D: 5,
    ghost: { fn: slow, label: 'no wavedash' },
    car: track([
      [0, { x: 40, y: CAR_Y, a: 0 }],
      [1.0, { x: 180 }],
      [1.3, { x: 215, y: CAR_Y - 26, a: -4 }, 'out'],
      [1.55, { x: 245, y: CAR_Y - 6, a: -12 }, 'in'],
      [1.65, { x: 262, y: CAR_Y, a: 0 }],
      [2.5, { x: 432 }, 'out'],
      [3.3, { x: 560 }],
    ]),
    underCar: (() => {
      const dust = animVisible(5, [[1.55, 1.95]]);
      const lines = animVisible(5, [[1.65, 2.45]]);
      const speed = track([[0, { x: 262, y: CAR_Y }], [1.65, {}], [2.5, { x: 432 }, 'out'], [3.3, { x: 560 }]]);
      return `<g opacity="${dust.initial}">${dust.tag}
          <circle cx="232" cy="${GROUND - 4}" r="7" fill="#6b7280" opacity=".6"/><circle cx="245" cy="${GROUND - 8}" r="9" fill="#6b7280" opacity=".5"/><circle cx="258" cy="${GROUND - 4}" r="6" fill="#6b7280" opacity=".6"/>
        </g>
        <g opacity="${lines.initial}">${lines.tag}${animatedPoint(5, speed, `<path d="M-70,-18 h-34 M-66,-8 h-46 M-70,2 h-30" stroke="${C.text}" stroke-width="3" stroke-linecap="round" opacity=".7"/>`)}</g>`;
    })(),
    steps: [
      { label: 'Small jump', from: 1.0, to: 1.3 },
      { label: 'Tilt nose up slightly', from: 1.3, to: 1.55 },
      { label: 'Dodge as back wheels touch', from: 1.55, to: 1.7 },
      { label: 'Skid away faster', from: 1.7, to: 5 },
    ],
    frames: [
      { t: 1.25, label: 'Small jump' },
      { t: 1.5, label: 'Nose up slightly' },
      { t: 1.6, label: 'Dodge as wheels touch', fx: 'dust' },
      { t: 2.1, label: 'Skid away faster', fx: 'speed' },
    ],
  };
}

// ---------- top-down scenes ----------
function topField(H) {
  let lines = '';
  for (let y = 60; y < H; y += 60) lines += `<line x1="0" x2="${W}" y1="${y}" y2="${y}" stroke="#1d3324" stroke-width="1"/>`;
  return `<rect width="${W}" height="${H}" fill="${C.turf}"/>${lines}`;
}

function aerialShots() {
  const D = 4.5;
  const H = 320;
  const goal = `<rect x="260" y="10" width="120" height="30" fill="#1b2a3a" stroke="${C.text}" stroke-width="2"/>
    <line x1="230" x2="410" y1="40" y2="40" stroke="${C.text}" stroke-width="3"/>
    <text x="320" y="31" font-size="13" font-weight="700" text-anchor="middle" fill="${C.text}">GOAL</text>`;
  const aim = `<line x1="320" y1="40" x2="320" y2="210" stroke="${C.accent}" stroke-width="2" stroke-dasharray="6 6" opacity=".8"/>`;
  const target = `<g transform="translate(320 166)"><circle r="6" fill="none" stroke="${C.accent}" stroke-width="2.5"/><circle r="2" fill="${C.accent}"/></g>`;
  const car = track([
    [0, { x: 130, y: 290, a: 40 }],
    [1.2, { x: 250, y: 240, a: 25 }, 'lin'],
    [2.0, { x: 320, y: 205, a: 0 }, 'out'],
    [2.3, { x: 320, y: 186 }],
    [3.0, { x: 320, y: 178 }, 'out'],
  ]);
  const ball = track([
    [0, { x: 320, y: 150 }],
    [2.3, {}],
    [2.9, { y: 24 }, 'out'],
  ]);
  const goalFlash = animVisible(D, [[2.9, 4.5]]);
  const steps = [
    { label: 'Check where the goal is', from: 0, to: 1.2 },
    { label: 'Line up behind the ball', from: 1.2, to: 2.0 },
    { label: 'Hit the side facing away from goal', from: 2.0, to: 2.9 },
    { label: 'The ball goes the opposite way', from: 2.9, to: 4.5 },
  ];
  const T = grid(D);
  const S = T.map(car);
  const carSvg = `<g>${animTransform('translate', D, T, S.map((s) => `${r2(s.x)} ${r2(s.y)}`))}<g>${animTransform('rotate', D, T, S.map((s) => r2(s.a)))}<use href="#tcar"/></g></g>`;
  const clip = svgDoc(W, H, DEFS_TOP, [
    topField(H), goal, aim, target,
    animatedPoint(D, ball, '<use href="#tball"/>'),
    carSvg,
    `<g opacity="${goalFlash.initial}">${goalFlash.tag}<text x="430" y="34" font-size="18" font-weight="800" fill="${C.good}">GOAL!</text></g>`,
    `<rect x="${W - 312}" y="${H - 116}" width="304" height="108" rx="10" fill="${C.bg}" opacity=".85"/>`,
    stepLegend(D, steps, W - 304, H - 96),
    `<text x="12" y="22" font-size="11" fill="${C.muted}">View from above · simplified illustration</text>`,
  ].join('\n'), 'Aiming an aerial shot (animated, view from above)');

  // Static diagram: where to hit the ball.
  const diagram = svgDoc(W, H, DEFS_TOP, [
    topField(H), goal, aim,
    `<g transform="translate(320 150)"><use href="#tball"/></g>`,
    `<g transform="translate(320 166)"><circle r="7" fill="none" stroke="${C.accent}" stroke-width="3"/><circle r="2.5" fill="${C.accent}"/></g>`,
    `<g transform="translate(320 205)"><use href="#tcar"/></g>`,
    `<g opacity=".3"><g transform="translate(250 240) rotate(25)"><use href="#tcar"/></g><g transform="translate(130 290) rotate(40)"><use href="#tcar"/></g></g>`,
    `<path d="M352,140 L352,60" stroke="${C.good}" stroke-width="4" marker-end="url(#arrow)"/>`,
    `<defs><marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 Z" fill="${C.good}"/></marker></defs>`,
    `<text x="362" y="100" font-size="14" font-weight="700" fill="${C.good}">ball travels this way</text>`,
    `<line x1="338" y1="168" x2="430" y2="190" stroke="${C.accent}" stroke-width="1.5"/>`,
    `<text x="436" y="186" font-size="14" font-weight="700" fill="${C.accent}">hit here:</text>`,
    `<text x="436" y="204" font-size="13" fill="${C.text}">the side facing</text>`,
    `<text x="436" y="220" font-size="13" fill="${C.text}">away from the goal</text>`,
    `<text x="200" y="276" font-size="12" fill="${C.muted}">approach, then line up</text>`,
    `<text x="${W - 12}" y="${H - 10}" font-size="11" text-anchor="end" fill="${C.muted}">View from above · simplified illustration</text>`,
  ].join('\n'), 'Where to hit the ball to aim at the goal (view from above)');
  return { clip, diagram };
}

function powerslide() {
  const D = 4.5;
  const H = 320;
  const yBottom = 290;
  const yTurn = 140;
  const lane = (cx, R, turnSpeed, slide) => {
    const v = 200;
    const straight = (yBottom - yTurn) / v;
    const turn = (Math.PI * R) / turnSpeed;
    const end = straight * 2 + turn;
    const fn = (t) => {
      if (t <= straight) return { x: cx - R, y: yBottom - v * t, a: 0, sx: 1, sy: 1 };
      if (t <= straight + turn) {
        const u = (t - straight) / turn;
        const th = Math.PI * u; // 0 → π over the top, clockwise
        const drift = slide ? 22 * Math.sin(Math.PI * u) : 0;
        return { x: cx - R * Math.cos(th), y: yTurn - R * Math.sin(th), a: (180 * u) + drift, sx: 1, sy: 1 };
      }
      const tt = Math.min(t, end) - straight - turn;
      return { x: cx + R, y: yTurn + v * tt, a: 180, sx: 1, sy: 1 };
    };
    return { fn, start: straight, end: straight + turn, finish: end, R, cx };
  };
  const wide = lane(170, 78, 200, false);
  const tight = lane(470, 30, 150, true);
  const pathD = (l) => `M${l.cx - l.R},${yBottom} L${l.cx - l.R},${yTurn} A${l.R},${l.R} 0 0 1 ${l.cx + l.R},${yTurn} L${l.cx + l.R},${yBottom}`;
  const T = grid(D);
  const carFor = (l) => {
    const S = T.map(l.fn);
    return `<g>${animTransform('translate', D, T, S.map((s) => `${r2(s.x)} ${r2(s.y)}`))}<g>${animTransform('rotate', D, T, S.map((s) => r2(s.a)))}<use href="#tcar"/></g></g>`;
  };
  const skid = animVisible(D, [[tight.start, D]]);
  const slideLabel = animVisible(D, [[tight.start, tight.end + 0.2]]);
  const wideDone = animVisible(D, [[wide.finish, D]]);
  const tightDone = animVisible(D, [[tight.finish, D]]);
  const body = [
    topField(H),
    `<line x1="320" x2="320" y1="0" y2="${H}" stroke="${C.bg}" stroke-width="6"/>`,
    `<text x="160" y="28" font-size="15" font-weight="700" text-anchor="middle" fill="${C.text}">No powerslide</text>`,
    `<text x="160" y="46" font-size="12" text-anchor="middle" fill="${C.muted}">wide, slow turn</text>`,
    `<text x="480" y="28" font-size="15" font-weight="700" text-anchor="middle" fill="${C.text}">Short powerslide</text>`,
    `<text x="480" y="46" font-size="12" text-anchor="middle" fill="${C.muted}">tight, quick turn</text>`,
    `<path d="${pathD(wide)}" fill="none" stroke="${C.text}" stroke-width="2" stroke-dasharray="4 8" opacity=".35"/>`,
    `<path d="${pathD(tight)}" fill="none" stroke="${C.text}" stroke-width="2" stroke-dasharray="4 8" opacity=".35"/>`,
    `<g opacity="${skid.initial}">${skid.tag}<path d="M${tight.cx - tight.R - 9},${yTurn} A${tight.R + 9},${tight.R + 9} 0 0 1 ${tight.cx + tight.R + 9},${yTurn} M${tight.cx - tight.R + 9},${yTurn} A${tight.R - 9},${tight.R - 9} 0 0 1 ${tight.cx + tight.R - 9},${yTurn}" fill="none" stroke="#0b0d12" stroke-width="5" opacity=".7"/></g>`,
    carFor(wide),
    carFor(tight),
    `<g opacity="${slideLabel.initial}">${slideLabel.tag}<rect x="530" y="${yTurn - 70}" width="96" height="24" rx="12" fill="${C.accent}"/><text x="578" y="${yTurn - 53}" font-size="12" font-weight="800" text-anchor="middle" fill="#14161c">POWERSLIDE</text></g>`,
    `<g opacity="${tightDone.initial}">${tightDone.tag}<text x="${tight.cx + tight.R + 26}" y="${yBottom - 8}" font-size="14" font-weight="800" fill="${C.good}">done ✓</text></g>`,
    `<g opacity="${wideDone.initial}">${wideDone.tag}<text x="${wide.cx + wide.R + 22}" y="${yBottom - 8}" font-size="14" font-weight="800" fill="${C.muted}">done</text></g>`,
    `<text x="${W - 12}" y="${H - 10}" font-size="11" text-anchor="end" fill="${C.muted}">View from above · simplified illustration</text>`,
  ];
  return svgDoc(W, H, DEFS_TOP, body.join('\n'), 'Turning with and without a short powerslide (animated, view from above)');
}

// Static version: both turn paths with the car shown at a few moments.
function powerslideDiagram() {
  const H = 320;
  const yBottom = 290;
  const yTurn = 140;
  const lanes = [
    { cx: 170, R: 78, title: 'No powerslide', sub: 'wide, slow turn', drift: 0 },
    { cx: 470, R: 30, title: 'Short powerslide', sub: 'tight, quick turn', drift: 22 },
  ];
  const parts = [topField(H), `<line x1="320" x2="320" y1="0" y2="${H}" stroke="${C.bg}" stroke-width="6"/>`];
  for (const l of lanes) {
    const tx = l.cx < 320 ? 160 : 480;
    parts.push(`<text x="${tx}" y="28" font-size="15" font-weight="700" text-anchor="middle" fill="${C.text}">${l.title}</text>`);
    parts.push(`<text x="${tx}" y="46" font-size="12" text-anchor="middle" fill="${C.muted}">${l.sub}</text>`);
    parts.push(`<path d="M${l.cx - l.R},${yBottom} L${l.cx - l.R},${yTurn} A${l.R},${l.R} 0 0 1 ${l.cx + l.R},${yTurn} L${l.cx + l.R},${yBottom}" fill="none" stroke="${C.text}" stroke-width="2" stroke-dasharray="4 8" opacity=".4"/>`);
    if (l.drift) parts.push(`<path d="M${l.cx - l.R - 9},${yTurn} A${l.R + 9},${l.R + 9} 0 0 1 ${l.cx + l.R + 9},${yTurn} M${l.cx - l.R + 9},${yTurn} A${l.R - 9},${l.R - 9} 0 0 1 ${l.cx + l.R - 9},${yTurn}" fill="none" stroke="#0b0d12" stroke-width="5" opacity=".7"/>`);
    [0, 0.5, 1].forEach((u, i) => {
      const th = Math.PI * u;
      const x = l.cx - l.R * Math.cos(th);
      const y = yTurn - l.R * Math.sin(th);
      const a = 180 * u + (l.drift ? l.drift * Math.sin(th) : 0);
      parts.push(`<g opacity="${[0.4, 0.7, 1][i]}" transform="translate(${r2(x)} ${r2(y)}) rotate(${r2(a)})"><use href="#tcar"/></g>`);
    });
  }
  parts.push(`<rect x="530" y="${yTurn - 78}" width="96" height="24" rx="12" fill="${C.accent}"/><text x="578" y="${yTurn - 61}" font-size="12" font-weight="800" text-anchor="middle" fill="#14161c">POWERSLIDE</text>`);
  parts.push(`<text x="${W - 12}" y="${H - 10}" font-size="11" text-anchor="end" fill="${C.muted}">View from above · simplified illustration</text>`);
  return svgDoc(W, H, DEFS_TOP, parts.join('\n'), 'Turning with and without a short powerslide (view from above)');
}

function practiceLoop() {
  const H = 300;
  const cx = 320;
  const cy = 150;
  const RX = 225;
  const RY = 100;
  const nodes = [
    { a: -90, label: 'Pick a unit', sub: 'one mechanic' },
    { a: 0, label: 'Do the reps', sub: 'count with +1' },
    { a: 90, label: 'Complete & next', sub: 'progress is saved' },
    { a: 180, label: 'Come back tomorrow', sub: 'keep the streak' },
  ];
  const pt = (deg) => [cx + RX * Math.cos((deg * Math.PI) / 180), cy + RY * Math.sin((deg * Math.PI) / 180)];
  const arcs = nodes
    .map((n, i) => {
 const [x1, y1] = pt(n.a + 30);
      const [x2, y2] = pt(n.a + 60);
      return `<path d="M${r2(x1)},${r2(y1)} A${RX},${RY} 0 0 1 ${r2(x2)},${r2(y2)}" fill="none" stroke="${C.accent}" stroke-width="3" marker-end="url(#ah)"/>`;
    })
    .join('');
  const boxes = nodes
    .map((n, i) => {
      const [x, y] = pt(n.a);
      return `<g transform="translate(${r2(x)} ${r2(y)})">
        <rect x="-82" y="-26" width="164" height="52" rx="12" fill="#1b1f29" stroke="#2f3646"/>
        <circle cx="-62" cy="0" r="12" fill="${C.accent}"/><text x="-62" y="4.5" font-size="13" font-weight="800" text-anchor="middle" fill="#14161c">${i + 1}</text>
        <text x="-44" y="-3" font-size="14" font-weight="700" fill="${C.text}">${esc(n.label)}</text>
        <text x="-44" y="14" font-size="12" fill="${C.muted}">${esc(n.sub)}</text>
      </g>`;
    })
    .join('');
  const center = `<text x="${cx}" y="${cy - 2}" font-size="18" font-weight="800" text-anchor="middle" fill="${C.text}">The rep loop</text>
    <text x="${cx}" y="${cy + 18}" font-size="12" text-anchor="middle" fill="${C.muted}">10–20 focused minutes</text>`;
  const defs = `<defs><marker id="ah" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 Z" fill="${C.accent}"/></marker></defs>`;
  return svgDoc(W, H, defs, arcs + boxes + center, 'The practice loop');
}


// ---------- controller-input clips (analog stick + buttons) ----------
// Stick: x = left(−1)…right(+1), y = forward(−1)…back(+1). With default
// controls, pulling the stick back tilts the car's nose up in the air.
const INPUT_BUTTONS = {
  Throttle: C.good,
  Reverse: '#a78bfa',
  Jump: '#38bdf8',
  Boost: C.accent,
  'Air roll': '#f472b6',
  Powerslide: '#facc15',
};

// Stretch every time in a move by `f` (f = 2 → half speed).
function slowDown(m, f) {
  const iv = (list) => list.map(([a, b]) => [a * f, b * f]);
  return {
    ...m,
    D: m.D * f,
    stick: m.stick.map(([t, st, e]) => [t * f, st, e]),
    buttons: m.buttons.map((b) => ({ ...b, on: iv(b.on) })),
    notes: (m.notes || []).map((n) => ({ ...n, from: n.from * f, to: n.to * f })),
    steps: m.steps.map((st) => ({ ...st, from: st.from * f, to: st.to * f })),
  };
}

function inputsClip(key, spec) {
  const f = spec.slow || 1.5;
  const m = slowDown(spec, f);
  const speed = f === 1 ? 'real speed' : f === 2 ? 'half speed' : `${Math.round(100 / f)}% speed`;
  const D = m.D;
  const H = 300;
  const sx = 150;
  const sy = 132;
  const R = 74;
  const travel = 50;
  const T = grid(D);

  // Stick base, axis labels and the moving thumb cap.
  const stickFn = track(m.stick);
  const cap = T.map(stickFn).map((p) => `${r2(sx + p.x * travel)} ${r2(sy + p.y * travel)}`);
  const stick = `
    <circle cx="${sx}" cy="${sy}" r="${R}" fill="#1b1f29" stroke="#2f3646" stroke-width="2"/>
    <circle cx="${sx}" cy="${sy}" r="${travel}" fill="none" stroke="#2a2f3b" stroke-dasharray="3 6"/>
    <line x1="${sx - R + 8}" x2="${sx + R - 8}" y1="${sy}" y2="${sy}" stroke="#2a2f3b"/>
    <line x1="${sx}" x2="${sx}" y1="${sy - R + 8}" y2="${sy + R - 8}" stroke="#2a2f3b"/>
    <text x="${sx}" y="${sy - R - 8}" font-size="12" text-anchor="middle" fill="${C.muted}">forward · nose down</text>
    <text x="${sx}" y="${sy + R + 18}" font-size="12" text-anchor="middle" fill="${C.muted}">back · nose up</text>
    <text x="${sx - R - 8}" y="${sy + 4}" font-size="12" text-anchor="end" fill="${C.muted}">left</text>
    <text x="${sx + R + 8}" y="${sy + 4}" font-size="12" fill="${C.muted}">right</text>
    <g>${animTransform('translate', D, T, cap)}
      <circle r="30" fill="#0b0d12" opacity=".5" cy="3"/>
      <circle r="28" fill="#3a4152" stroke="${C.accent}" stroke-width="3"/>
      <circle r="18" fill="#2b313f"/>
    </g>
    <text x="${sx}" y="22" font-size="13" font-weight="700" text-anchor="middle" fill="${C.text}">Left stick</text>`;

  // What the stick is doing right now, in words.
  const notes = (m.notes || [])
    .map((n) => {
      const v = animVisible(D, [[n.from, n.to]]);
      return `<g opacity="${v.initial}">${v.tag}<text x="${sx}" y="${H - 20}" font-size="13" font-weight="600" text-anchor="middle" fill="${C.accent}">${esc(n.text)}</text></g>`;
    })
    .join('');

  // Buttons: dim pill, lit while held.
  const bx = 318;
  const bw = 148;
  const bh = 30;
  const buttons = m.buttons
    .map((b, i) => {
      const x = bx + (i % 2) * (bw + 10);
      const y = 40 + Math.floor(i / 2) * (bh + 10);
      const color = INPUT_BUTTONS[b.label];
      const lit = animVisible(D, b.on);
      const dim = animVisible(D, b.on, 0, 1);
      return `<g opacity="${dim.initial}">${dim.tag}<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="15" fill="#1b1f29" stroke="#2f3646"/>
        <text x="${x + bw / 2}" y="${y + 20}" font-size="13" font-weight="600" text-anchor="middle" fill="${C.muted}">${esc(b.label)}</text></g>
        <g opacity="${lit.initial}">${lit.tag}<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="15" fill="${color}"/>
        <text x="${x + bw / 2}" y="${y + 20}" font-size="13" font-weight="800" text-anchor="middle" fill="#14161c">${esc(b.label)} — held</text></g>`;
    })
    .join('');
  const rows = Math.ceil(m.buttons.length / 2);
  const legendY = 40 + rows * (bh + 10) + 24;

  const body = [
    `<text x="${bx}" y="22" font-size="13" font-weight="700" fill="${C.text}">Buttons</text>`,
    stick, notes, buttons,
    stepLegend(D, m.steps, bx - 2, legendY),
    footer(H, `Default controls · shown at ${speed}`),
  ].join('\n');
  return svgDoc(W, H, '', body, `${m.title}: what to press (animated)`);
}

const INPUTS = {
  'aerial-foundations/first-touches': {
    stick: [[0, { x: 0, y: 0 }], [0.5, { x: 0.25 }], [1.6, { x: 0.25 }], [2.0, { x: 0 }]],
    buttons: [{ label: 'Throttle', on: [[0, 3.7]] }, { label: 'Jump', on: [[2.3, 2.7]] }],
    notes: [
      { from: 0, to: 2.3, text: 'Steer to where the ball will land' },
      { from: 2.3, to: 2.7, text: 'Jump as the ball starts to fall' },
      { from: 2.7, to: 6, text: 'Stick centered: hit it with the front' },
    ],
  },
  'aerial-foundations/basic-aerial': {
    stick: [[0, { x: 0, y: 0 }], [1.5, {}], [1.6, { y: 1 }], [1.75, {}], [2.0, { y: 0.35 }], [2.6, { x: 0.15, y: 0.45 }], [3.3, { x: 0, y: 0.3 }], [3.5, { y: 0 }]],
    buttons: [{ label: 'Throttle', on: [[0, 1.5]] }, { label: 'Jump', on: [[1.2, 1.5]] }, { label: 'Boost', on: [[1.5, 3.3]] }],
    notes: [
      { from: 0, to: 1.2, text: 'Drive at the ball' },
      { from: 1.2, to: 1.5, text: 'Jump' },
      { from: 1.5, to: 1.75, text: 'Pull back: nose up' },
      { from: 1.75, to: 3.3, text: 'Small corrections to aim' },
      { from: 3.3, to: 6.5, text: 'Let go after the touch' },
    ],
  },
  'aerial-foundations/fast-aerial': {
    slow: 2,
    stick: [[0, { x: 0, y: 0 }], [0.6, {}], [0.7, { y: 1 }], [2.2, {}], [2.45, { y: -0.4 }], [3.2, { y: 0 }]],
    buttons: [{ label: 'Throttle', on: [[0, 0.6]] }, { label: 'Jump', on: [[0.6, 0.85], [0.95, 1.07]] }, { label: 'Boost', on: [[0.6, 2.2]] }],
    notes: [
      { from: 0.6, to: 0.95, text: 'Boost + jump (hold), pull back' },
      { from: 0.95, to: 1.4, text: 'Tap jump again, stick STILL back' },
      { from: 1.4, to: 2.2, text: 'Keep boosting, nose up' },
      { from: 2.2, to: 3.4, text: 'Ease forward to level out' },
    ],
  },
  'aerial-foundations/aerial-shots': {
    title: 'Aerial shots',
    D: 4.5,
    steps: [
      { label: 'Check where the goal is', from: 0, to: 1.2 },
      { label: 'Line up behind the ball', from: 1.2, to: 2.0 },
      { label: 'Jump, tilt back, boost', from: 2.0, to: 2.9 },
      { label: 'Hit the far side of the ball', from: 2.9, to: 4.5 },
    ],
    stick: [[0, { x: 0, y: 0 }], [0.2, { x: -0.55 }], [1.6, {}], [1.9, { x: 0 }], [2.1, { y: 1 }], [2.3, {}], [2.5, { y: 0.35 }], [2.9, {}], [3.1, { y: 0 }]],
    buttons: [{ label: 'Throttle', on: [[0, 2.0]] }, { label: 'Jump', on: [[2.0, 2.25]] }, { label: 'Boost', on: [[2.25, 2.9]] }],
    notes: [
      { from: 0, to: 1.9, text: 'Steer to get behind the ball' },
      { from: 2.0, to: 2.4, text: 'Jump and pull back' },
      { from: 2.4, to: 2.9, text: 'Aim the nose at the far side' },
      { from: 2.9, to: 4.5, text: 'Ball goes away from your hit' },
    ],
  },
  'recovery-and-movement/land-on-wheels': {
    stick: [[0, { x: 0, y: 0 }], [1.3, {}], [1.4, { x: -1 }], [2.0, {}], [2.15, { x: 0 }]],
    buttons: [{ label: 'Air roll', on: [[1.3, 2.1]] }, { label: 'Throttle', on: [[2.4, 3.4]] }],
    notes: [
      { from: 0, to: 1.3, text: 'Hands off: look for the ground' },
      { from: 1.3, to: 2.1, text: 'Hold air roll + stick left/right' },
      { from: 2.1, to: 5, text: 'Land level, then drive' },
    ],
  },
  'recovery-and-movement/powerslide-turns': {
    slow: 2,
    title: 'Powerslide turns',
    D: 4.5,
    steps: [
      { label: 'Drive in straight', from: 0, to: 0.75 },
      { label: 'Steer + tap powerslide', from: 0.75, to: 1.1 },
      { label: 'Let go, keep steering', from: 1.1, to: 1.34 },
      { label: 'Drive out with speed', from: 1.34, to: 4.5 },
    ],
    stick: [[0, { x: 0, y: 0 }], [0.7, {}], [0.8, { x: 1 }], [1.3, {}], [1.42, { x: 0 }]],
    buttons: [{ label: 'Throttle', on: [[0, 2.1]] }, { label: 'Powerslide', on: [[0.8, 1.1]] }],
    notes: [
      { from: 0, to: 0.75, text: 'Straight' },
      { from: 0.75, to: 1.1, text: 'Full steer + a SHORT powerslide' },
      { from: 1.1, to: 1.42, text: 'Release powerslide as you face out' },
      { from: 1.42, to: 4.5, text: 'Straighten up' },
    ],
  },
  'recovery-and-movement/half-flip': {
    slow: 2,
    stick: [[0, { x: 0, y: 0 }], [1.25, {}], [1.32, { y: 1 }], [1.62, {}], [1.7, { y: -1 }], [2.0, {}], [2.08, { x: -1, y: 0 }], [2.45, {}], [2.55, { x: 0 }]],
    buttons: [
      { label: 'Reverse', on: [[0, 1.3]] },
      { label: 'Jump', on: [[1.2, 1.28], [1.4, 1.48]] },
      { label: 'Air roll', on: [[2.0, 2.5]] },
      { label: 'Throttle', on: [[2.5, 3.8]] },
    ],
    notes: [
      { from: 0, to: 1.2, text: 'Reverse away from where you want to go' },
      { from: 1.2, to: 1.7, text: 'Jump, then stick back + jump = backflip' },
      { from: 1.7, to: 2.0, text: 'Snap the stick FORWARD to cancel' },
      { from: 2.0, to: 2.5, text: 'Air roll + stick sideways to flip upright' },
      { from: 2.5, to: 6, text: 'Throttle: drive away' },
    ],
  },
  'recovery-and-movement/wavedash': {
    slow: 2.5,
    stick: [[0, { x: 0, y: 0 }], [1.3, {}], [1.38, { y: 0.45 }], [1.53, {}], [1.57, { y: -1 }], [1.7, {}], [1.82, { y: 0 }]],
    buttons: [{ label: 'Throttle', on: [[0, 3.3]] }, { label: 'Jump', on: [[1.0, 1.08], [1.55, 1.63]] }],
    notes: [
      { from: 1.0, to: 1.3, text: 'Tap jump for a small hop' },
      { from: 1.3, to: 1.55, text: 'Tilt back a little: nose up' },
      { from: 1.55, to: 1.7, text: 'Stick forward + jump as wheels touch' },
      { from: 1.7, to: 5, text: 'Skid away faster' },
    ],
  },
};


// ---------- backboard scenes (side view, YOUR goal on the right) ----------
const WALL_X = 600; // the backwall's face
const GOAL_TOP = GROUND - 70; // crossbar height
const ON_WALL_X = WALL_X - 12; // car center when driving on the wall

function backboardDecor() {
  let net = '';
  for (let y = GOAL_TOP + 10; y < GROUND; y += 12) net += `<line x1="${WALL_X}" x2="${W}" y1="${y}" y2="${y}" stroke="#2a3140" stroke-width="1"/>`;
  for (let x = WALL_X + 10; x < W; x += 12) net += `<line x1="${x}" x2="${x}" y1="${GOAL_TOP}" y2="${GROUND}" stroke="#2a3140" stroke-width="1"/>`;
  return `<rect x="${WALL_X}" y="0" width="${W - WALL_X}" height="${GOAL_TOP}" fill="#1c2a22"/>
    <line x1="${WALL_X}" x2="${WALL_X}" y1="0" y2="${GOAL_TOP}" stroke="${C.turfLine}" stroke-width="3"/>
    <rect x="${WALL_X}" y="${GOAL_TOP}" width="${W - WALL_X}" height="${GROUND - GOAL_TOP}" fill="#0b0f16"/>${net}
    <line x1="${WALL_X}" x2="${W}" y1="${GOAL_TOP}" y2="${GOAL_TOP}" stroke="${C.text}" stroke-width="4"/>
    <text transform="translate(${WALL_X + 24} ${GOAL_TOP / 2}) rotate(-90)" font-size="12" font-weight="700" text-anchor="middle" fill="${C.muted}" letter-spacing="2">BACKBOARD</text>
    <text x="${WALL_X + 20}" y="${GROUND - 10}" font-size="10" font-weight="700" text-anchor="middle" fill="${C.muted}">GOAL</text>`;
}

// One static picture: the whole scene, the ball's path, and the car at each
// numbered moment (faded → solid), with the step list underneath.
function sceneSteps(m) {
  const sceneH = 300;
  const H = sceneH + 16 + m.frames.length * 22;
  const parts = [ground(sceneH), backboardDecor()];
  if (m.extras) parts.push(m.extras);
  if (m.ball) {
    const [a, b] = m.ballPath || [0, m.D];
    const pts = [];
    for (let t = a; t <= b + 1e-9; t += (b - a) / 60) { const p = m.ball(t); pts.push(`${r2(p.x)},${r2(p.y)}`); }
    parts.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="${C.ball}" stroke-width="2" stroke-dasharray="3 7" opacity=".55"/>`);
  }
  m.frames.forEach((f, i) => {
    const s = m.car(f.t);
    const op = (0.45 + (0.55 * (i + 1)) / m.frames.length).toFixed(2);
    if (m.ball && f.showBall !== false) {
      const p = m.ball(f.t);
      parts.push(`<g opacity="${op}" transform="translate(${r2(p.x)} ${r2(p.y)})"><use href="#ball"/></g>`);
    }
    const boosting = m.boost && during(m.boost)(f.t);
    parts.push(`<g opacity="${op}" transform="translate(${r2(s.x)} ${r2(s.y)}) rotate(${r2(s.a)}) scale(${r2(s.sx)} ${r2(s.sy)})">${boosting ? '<use href="#flame"/>' : ''}<use href="#car"/></g>`);
    const [dx, dy] = f.badge || [0, -44];
    const bx = Math.min(W - 16, Math.max(16, s.x + dx));
    const by = Math.max(16, s.y + dy);
    parts.push(`<circle cx="${r2(bx)}" cy="${r2(by)}" r="12" fill="${C.accent}"/><text x="${r2(bx)}" y="${r2(by + 4.5)}" font-size="13" font-weight="800" text-anchor="middle" fill="#14161c">${i + 1}</text>`);
  });
  parts.push(`<rect x="0" y="${sceneH}" width="${W}" height="${H - sceneH}" fill="${C.bg}"/>`);
  m.frames.forEach((f, i) => {
    const y = sceneH + 22 + i * 22;
    parts.push(`<circle cx="26" cy="${y - 4}" r="9" fill="${C.accent}"/><text x="26" y="${y}" font-size="11" font-weight="800" text-anchor="middle" fill="#14161c">${i + 1}</text><text x="44" y="${y}" font-size="14" fill="${C.text}">${esc(f.label)}</text>`);
  });
  parts.push(`<text x="${W - 12}" y="${H - 8}" font-size="11" text-anchor="end" fill="${C.muted}">Side view · simplified illustration</text>`);
  return svgDoc(W, H, DEFS_SIDE, parts.join('\n'), `${m.title}: step by step`);
}

const teammate = (x, label = 'teammate in net') => `<g opacity=".4" transform="translate(${x} ${CAR_Y}) scale(-1 1)"><use href="#car"/></g><text x="${x}" y="${CAR_Y - 34}" font-size="11" text-anchor="middle" fill="${C.ghost}">${label}</text>`;

const BACKBOARD = {
  'backboard-defense/backboard-rotation': {
    title: 'Backboard rotation',
    D: 4.5,
    car: track([
      [0, { x: 120, y: CAR_Y, a: 0 }],
      [1.4, { x: 500 }],
      [1.62, { x: 574, y: CAR_Y - 2, a: -35 }],
      [1.8, { x: ON_WALL_X, y: 232, a: -90 }],
      [2.4, { y: 168 }],
      [3.0, {}],
      [3.6, { y: 86 }, 'out'],
    ]),
    ball: track([[0, { x: 60, y: 210 }], [2.4, {}], [3.6, { x: 548, y: 76 }, 'out']]),
    ballPath: [2.4, 3.6],
    boost: [[0.2, 1.4], [3.0, 3.5]],
    extras: teammate(500),
    steps: [
      { label: 'Rotate back on the backboard side', from: 0, to: 1.6 },
      { label: 'Drive up the wall, not into the net', from: 1.6, to: 2.4 },
      { label: 'Wait on the backboard', from: 2.4, to: 3.0 },
      { label: 'Meet the shot on the wall', from: 3.0, to: 4.5 },
    ],
    frames: [
      { t: 0.8, label: 'Rotate back toward the backboard, not behind your teammate', showBall: false },
      { t: 1.62, label: 'Drive up the wall above the goal', showBall: false, badge: [-6, -52] },
      { t: 2.4, label: 'Wait on the backboard, watching the play', showBall: false, badge: [-44, 0] },
      { t: 3.6, label: 'Meet the shot on the wall before it rebounds', badge: [-44, -40] },
    ],
    inputs: {
      stick: [[0, { x: 0, y: 0 }], [0.3, { x: 0.4 }], [1.3, {}], [1.5, { x: 0 }]],
      buttons: [{ label: 'Throttle', on: [[0, 2.4], [3.0, 3.6]] }, { label: 'Boost', on: [[0.2, 1.4], [3.0, 3.5]] }],
      notes: [
        { from: 0, to: 1.6, text: 'Steer toward the backboard side' },
        { from: 1.6, to: 2.4, text: 'Keep throttle: drive up the wall' },
        { from: 2.4, to: 3.0, text: 'Hold position, watch the ball' },
        { from: 3.0, to: 4.5, text: 'Throttle + boost to meet it' },
      ],
    },
  },
  'backboard-defense/reading-the-rebound': {
    title: 'Reading the rebound',
    D: 4.5,
    car: track([
      [0, { x: 556, y: CAR_Y, a: 0, sx: -1 }],
      [1.9, {}],
      [2.5, { x: 440 }],
      [2.9, { x: 410, y: 200, a: 15 }, 'out'],
      [3.5, { x: 430, y: CAR_Y, a: 0 }, 'in'],
    ]),
    ball: track([
      [0, { x: 120, y: 150 }],
      [1.6, { x: 582, y: 80 }, 'out'],
      [2.9, { x: 386, y: 184 }, 'in'],
      [3.5, { x: 150, y: 110 }, 'out'],
    ]),
    ballPath: [0, 2.9],
    extras: `<text x="300" y="${GROUND + 26}" font-size="12" text-anchor="middle" fill="${C.muted}">← the opponent is coming for this rebound</text>`,
    steps: [
      { label: 'Watch the ball onto the backboard', from: 0, to: 1.6 },
      { label: 'Read the rebound, move under it', from: 1.6, to: 2.5 },
      { label: 'Jump and clear it first', from: 2.5, to: 4.5 },
    ],
    frames: [
      { t: 1.2, label: 'Stay in front of the net and watch it hit the backboard', badge: [0, -44] },
      { t: 2.4, label: 'Read where it will come down and drive under it', badge: [0, -44] },
      { t: 2.9, label: 'Jump and meet it before the opponent can', badge: [10, -50] },
    ],
    inputs: {
      stick: [[0, { x: 0, y: 0 }], [2.5, {}], [2.58, { y: 0.5 }], [2.9, {}], [3.0, { y: 0 }]],
      buttons: [{ label: 'Throttle', on: [[1.9, 2.6]] }, { label: 'Jump', on: [[2.5, 2.9]] }],
      notes: [
        { from: 0, to: 1.6, text: 'Hands steady: watch, don’t guess' },
        { from: 1.6, to: 2.5, text: 'Drive out under where it will drop' },
        { from: 2.5, to: 3.2, text: 'Jump, tilt back slightly, hit it away' },
      ],
    },
  },
  'backboard-defense/half-volley-boom': {
    title: 'The half-volley boom',
    D: 4.5,
    car: track([
      [0, { x: ON_WALL_X, y: 200, a: -90, sx: 1 }],
      [1.5, { y: 120 }],
      [1.85, {}],
      [1.95, { x: 566, y: 120 }, 'out'],
      [2.2, { x: 520, y: 96, a: -55 }],
      [3.2, { x: 520, y: CAR_Y, a: 0 }, 'in'],
    ]),
    ball: track([
      [0, { x: 150, y: 40 }],
      [1.85, { x: 582, y: 80 }],
      [2.2, { x: 548, y: 54 }],
      [2.9, { x: 250, y: -40 }, 'out'],
    ]),
    ballPath: [0.6, 2.9],
    steps: [
      { label: 'Drive up under the ball', from: 0, to: 1.85 },
      { label: 'Let it bounce off the wall, jump', from: 1.85, to: 2.0 },
      { label: 'Side flip into the underside', from: 2.0, to: 2.4 },
      { label: 'Boom: it flies out, away from goal', from: 2.4, to: 4.5 },
    ],
    frames: [
      { t: 0.2, label: 'Get directly under the ball on the wall', showBall: false, badge: [-44, 10] },
      { t: 1.92, label: 'Let it hit the wall first, then jump off', badge: [-46, 34] },
      { t: 2.2, label: 'Side flip into its underside: it booms out', badge: [-40, 46] },
    ],
    inputs: {
      stick: [[0, { x: 0, y: 0 }], [1.98, {}], [2.02, { x: 1 }], [2.3, {}], [2.4, { x: 0 }]],
      buttons: [{ label: 'Throttle', on: [[0, 1.85]] }, { label: 'Jump', on: [[1.85, 1.95], [2.0, 2.08]] }],
      notes: [
        { from: 0, to: 1.85, text: 'Throttle: line up under it on the wall' },
        { from: 1.85, to: 2.0, text: 'Jump off the wall after the bounce' },
        { from: 2.0, to: 2.4, text: 'Stick sideways + jump = side flip' },
        { from: 2.4, to: 4.5, text: 'Land and recover' },
      ],
    },
  },
  'backboard-defense/defending-from-the-ground': {
    title: 'Defending from the ground',
    D: 4.5,
    car: track([
      [0, { x: 556, y: CAR_Y, a: 0, sx: -1 }],
      [0.8, {}],
      [1.3, { x: 470 }],
      [1.7, { x: 440, y: 178, a: 15 }, 'out'],
      [2.4, { x: 430, y: CAR_Y, a: 0 }, 'in'],
    ]),
    ball: track([
      [0, { x: 80, y: 140 }],
      [1.7, { x: 408, y: 150 }],
      [2.4, { x: 330, y: 40 }, 'out'],
    ]),
    ballPath: [0, 1.7],
    boost: [[0.9, 1.5]],
    extras: `<path d="M408,150 L548,126" stroke="${C.ball}" stroke-width="2" stroke-dasharray="3 6" opacity=".35"/><text x="520" y="110" font-size="11" text-anchor="middle" fill="${C.ghost}">where it was going</text>`,
    steps: [
      { label: 'Read: it’s heading for your backboard', from: 0, to: 0.8 },
      { label: 'Drive out and jump early', from: 0.8, to: 1.7 },
      { label: 'Cut it off toward the corner', from: 1.7, to: 4.5 },
    ],
    frames: [
      { t: 0.6, label: 'Read it: the ball is heading for your backboard', showBall: true },
      { t: 1.25, label: 'Go early, don’t wait on the goal line', badge: [0, -48] },
      { t: 1.7, label: 'Cut it off before the wall and send it toward a corner', badge: [30, -46] },
    ],
    inputs: {
      stick: [[0, { x: 0, y: 0 }], [1.35, {}], [1.42, { x: -0.7, y: 0.3 }], [1.9, {}], [2.0, { x: 0, y: 0 }]],
      buttons: [{ label: 'Throttle', on: [[0.8, 1.6]] }, { label: 'Boost', on: [[0.9, 1.5]] }, { label: 'Jump', on: [[1.3, 1.7]] }],
      notes: [
        { from: 0, to: 0.8, text: 'Read the shot’s height and speed' },
        { from: 0.8, to: 1.35, text: 'Throttle + boost out of the net' },
        { from: 1.35, to: 1.9, text: 'Jump, aim the nose toward a corner' },
        { from: 1.9, to: 4.5, text: 'Land and recover to back post' },
      ],
    },
  },
};

// View looking straight at your backwall: goal at the bottom, corners on each side.
function catchAndDumpDiagram() {
  const H = 300;
  const goalL = 230;
  const goalR = 410;
  const goalTop = 196;
  const floor = 262;
  const frames = [
    { x: 320, y: 120, a: 0, ball: [320, 92], label: 'Meet it high and take a soft first touch on the top-front of your car' },
    { x: 420, y: 112, a: 55, ball: [446, 96], label: 'Carry it along the wall with small touches' },
    { x: 545, y: 130, a: 90, ball: [586, 128], label: 'Dump it into the corner, or pass to a teammate' },
  ];
  const parts = [
    `<rect width="${W}" height="${H}" fill="#1c2a22"/>`,
    `<rect x="0" y="${floor}" width="${W}" height="${H - floor}" fill="${C.turf}"/><line x1="0" x2="${W}" y1="${floor}" y2="${floor}" stroke="${C.turfLine}" stroke-width="2"/>`,
    `<rect x="${goalL}" y="${goalTop}" width="${goalR - goalL}" height="${floor - goalTop}" fill="#0b0f16" stroke="${C.text}" stroke-width="4"/>`,
    `<text x="320" y="${goalTop + 40}" font-size="12" font-weight="700" text-anchor="middle" fill="${C.muted}">YOUR GOAL</text>`,
    `<path d="M0,0 Q40,150 0,${floor}" fill="#13201a"/><path d="M${W},0 Q${W - 40},150 ${W},${floor}" fill="#13201a"/>`,
    `<text x="22" y="40" font-size="11" font-weight="700" fill="${C.muted}">CORNER</text><text x="${W - 22}" y="40" font-size="11" font-weight="700" text-anchor="end" fill="${C.muted}">CORNER</text>`,
    `<path d="M320,92 C380,70 470,80 590,128" fill="none" stroke="${C.ball}" stroke-width="2" stroke-dasharray="3 7" opacity=".6"/>`,
  ];
  frames.forEach((f, i) => {
    const op = (0.5 + (0.5 * (i + 1)) / frames.length).toFixed(2);
    parts.push(`<g opacity="${op}" transform="translate(${f.x} ${f.y}) rotate(${f.a})"><use href="#tcar"/></g>`);
    parts.push(`<g opacity="${op}" transform="translate(${f.ball[0]} ${f.ball[1]})"><use href="#tball"/></g>`);
    parts.push(`<circle cx="${f.x - 34}" cy="${f.y + 30}" r="12" fill="${C.accent}"/><text x="${f.x - 34}" y="${f.y + 34.5}" font-size="13" font-weight="800" text-anchor="middle" fill="#14161c">${i + 1}</text>`);
  });
  const legendTop = H;
  const HH = H + 16 + frames.length * 22;
  parts.push(`<rect x="0" y="${legendTop}" width="${W}" height="${HH - legendTop}" fill="${C.bg}"/>`);
  frames.forEach((f, i) => {
    const y = legendTop + 22 + i * 22;
    parts.push(`<circle cx="26" cy="${y - 4}" r="9" fill="${C.accent}"/><text x="26" y="${y}" font-size="11" font-weight="800" text-anchor="middle" fill="#14161c">${i + 1}</text><text x="44" y="${y}" font-size="14" fill="${C.text}">${esc(f.label)}</text>`);
  });
  parts.push(`<text x="${W - 12}" y="${HH - 8}" font-size="11" text-anchor="end" fill="${C.muted}">Looking at your backwall · simplified illustration</text>`);
  return svgDoc(W, HH, DEFS_TOP, parts.join('\n'), 'Catch and dump to the corner: step by step');
}

const CATCH_AND_DUMP_INPUTS = {
  title: 'Catch and dump',
  D: 4.5,
  steps: [
    { label: 'Meet it high on the wall', from: 0, to: 1.0 },
    { label: 'Soft first touch: let it land on you', from: 1.0, to: 1.6 },
    { label: 'Carry it along the wall to the corner', from: 1.6, to: 2.8 },
    { label: 'Dump it into the corner or pass', from: 2.8, to: 4.5 },
  ],
  stick: [[0, { x: 0, y: 0 }], [1.6, {}], [1.75, { x: 0.6 }], [2.7, {}], [2.85, { x: 1 }], [3.1, {}], [3.25, { x: 0 }]],
  buttons: [{ label: 'Throttle', on: [[0, 1.0], [1.6, 3.1]] }, { label: 'Jump', on: [[2.85, 2.95]] }],
  notes: [
    { from: 0, to: 1.0, text: 'Drive up to meet it high' },
    { from: 1.0, to: 1.6, text: 'Ease off: cushion the first touch' },
    { from: 1.6, to: 2.8, text: 'Steer gently toward the corner' },
    { from: 2.8, to: 4.5, text: 'Flick it off the wall into the corner' },
  ],
};

// Overview for the first lesson: what a backboard attack looks like.
function backboardOverview() {
  const H = 300;
  const ball = track([[0, { x: 140, y: 200 }], [1, { x: 582, y: 70 }, 'out'], [2, { x: 400, y: 170 }, 'in']]);
  const pts = [];
  for (let t = 0; t <= 2.0001; t += 0.04) { const p = ball(t); pts.push(`${r2(p.x)},${r2(p.y)}`); }
  const parts = [
    ground(H), backboardDecor(),
    `<polyline points="${pts.join(' ')}" fill="none" stroke="${C.ball}" stroke-width="2.5" stroke-dasharray="4 7" opacity=".8"/>`,
    `<g transform="translate(140 200)"><use href="#ball"/></g>`,
    `<g opacity=".55" transform="translate(110 ${CAR_Y})"><use href="#car"/></g>`,
    `<text x="110" y="${GROUND + 24}" font-size="12" text-anchor="middle" fill="${C.ghost}">opponent</text>`,
    `<g transform="translate(582 70)"><circle r="22" fill="none" stroke="${C.accent}" stroke-width="2.5" stroke-dasharray="4 4"/></g>`,
    `<text x="588" y="34" font-size="13" font-weight="700" text-anchor="end" fill="${C.accent}">1. ball hits your backboard</text>`,
    `<ellipse cx="410" cy="168" rx="58" ry="34" fill="${C.accent}" opacity=".14" stroke="${C.accent}" stroke-dasharray="4 4"/>`,
    `<text x="410" y="222" font-size="13" font-weight="700" text-anchor="middle" fill="${C.accent}">2. the rebound: danger zone</text>`,
    `<text x="410" y="238" font-size="11" text-anchor="middle" fill="${C.muted}">opponents follow up here (double tap)</text>`,
    `<text x="20" y="26" font-size="15" font-weight="800" fill="${C.text}">What you're defending</text>`,
    `<text x="20" y="46" font-size="12" fill="${C.muted}">High balls at your backwall come back out fast and hard to read.</text>`,
    `<text x="${W - 12}" y="${H - 10}" font-size="11" text-anchor="end" fill="${C.muted}">Side view · simplified illustration</text>`,
  ];
  return svgDoc(W, H, DEFS_SIDE, parts.join('\n'), 'A backboard attack: the ball hits your backwall and rebounds into the danger zone');
}


// ---------- intermediate courses: free air roll & shooting ----------
// View from BEHIND the car: shows roll. Wheels at the bottom (y ≈ +18).
const DEFS_REAR = `<defs><g id="rcar">
  <rect x="-36" y="-8" width="72" height="20" rx="7" fill="${C.car}" stroke="${C.carDark}" stroke-width="1.5"/>
  <path d="M-24,-8 L-17,-24 L17,-24 L24,-8 Z" fill="${C.car}" stroke="${C.carDark}" stroke-width="1.5"/>
  <path d="M-18,-10 L-13,-21 L13,-21 L18,-10 Z" fill="${C.glass}"/>
  <rect x="-33" y="-3" width="9" height="5" rx="1.5" fill="#ef4444"/><rect x="24" y="-3" width="9" height="5" rx="1.5" fill="#ef4444"/>
  <rect x="-35" y="9" width="12" height="9" rx="3" fill="#1f2229"/><rect x="23" y="9" width="12" height="9" rx="3" fill="#1f2229"/>
</g>
<marker id="ah2" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 Z" fill="${C.accent}"/></marker>
<marker id="ahg" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 Z" fill="${C.good}"/></marker>
</defs>`;
const ALL_DEFS = DEFS_SIDE + DEFS_TOP + DEFS_REAR;

function rollArrow(dir, r = 50) {
  // Arc over the top of the car; "right" = clockwise as seen from behind.
  const a1 = dir === 'right' ? -150 : -30;
  const a2 = dir === 'right' ? -30 : -150;
  const p = (a) => [r * Math.cos((a * Math.PI) / 180), r * Math.sin((a * Math.PI) / 180)];
  const [x1, y1] = p(a1);
  const [x2, y2] = p(a2);
  return `<path d="M${r2(x1)},${r2(y1)} A${r},${r} 0 0 ${dir === 'right' ? 1 : 0} ${r2(x2)},${r2(y2)}" fill="none" stroke="${C.accent}" stroke-width="3" marker-end="url(#ah2)"/>`;
}

function miniStick(x, y, st = {}) {
  const sx = st.x || 0;
  const sy = st.y || 0;
  return `<g transform="translate(${x} ${y})">
    <circle r="15" fill="#1b1f29" stroke="#2f3646"/>
    <circle cx="${r2(sx * 8)}" cy="${r2(sy * 8)}" r="6" fill="${C.accent}"/>
    ${st.ar ? `<rect x="-26" y="19" width="52" height="15" rx="7.5" fill="#f472b6"/><text y="30" font-size="9" font-weight="800" text-anchor="middle" fill="#14161c">AIR ROLL</text>` : ''}
    ${st.jump ? `<rect x="-26" y="${st.ar ? 37 : 19}" width="52" height="15" rx="7.5" fill="#38bdf8"/><text y="${st.ar ? 48 : 30}" font-size="9" font-weight="800" text-anchor="middle" fill="#14161c">JUMP</text>` : ''}
  </g>`;
}

// Comic strip of the car seen from behind, one panel per moment.
function rollStrip(m) {
  const n = m.frames.length;
  const pw = W / n;
  const ph = 190;
  const H = ph + 64;
  const panels = m.frames.map((f, i) => {
    const px = i * pw;
    const cx = px + pw / 2;
    const cy = 104;
    const ground = f.ground ? `<rect x="${px + 4}" y="${ph - 30}" width="${pw - 8}" height="26" fill="${C.turf}"/><line x1="${px + 4}" x2="${px + pw - 4}" y1="${ph - 30}" y2="${ph - 30}" stroke="${C.turfLine}" stroke-width="2"/>` : '';
    const ball = f.ball ? `<g transform="translate(${r2(cx + f.ball[0])} ${r2(cy + f.ball[1])}) scale(.8)"><use href="#ball"/></g>` : '';
    const ballArrow = f.ballArrow !== undefined ? `<path d="M${r2(cx + (f.ball ? f.ball[0] : 0))},${r2(cy + (f.ball ? f.ball[1] : -60) - 18)} l${r2(f.ballArrow * 0.6)},-20" stroke="${C.good}" stroke-width="3" marker-end="url(#ahg)"/>` : '';
    const roof = f.roofArrow ? (() => {
      const a = ((f.roll - 90) * Math.PI) / 180;
      return `<path d="M${r2(cx + 30 * Math.cos(a))},${r2(cy + 30 * Math.sin(a))} L${r2(cx + 62 * Math.cos(a))},${r2(cy + 62 * Math.sin(a))}" stroke="${C.good}" stroke-width="3" marker-end="url(#ahg)"/>`;
    })() : '';
    const lines = wrap(f.label, Math.floor(pw / 7.4));
    return `<g>
      <rect x="${px + 4}" y="4" width="${pw - 8}" height="${ph - 8}" rx="10" fill="#151923" stroke="#2a2f3b"/>
      ${ground}${ball}${ballArrow}
      <g transform="translate(${r2(cx)} ${cy})">${f.arrow ? rollArrow(f.arrow) : ''}<g transform="rotate(${r2(f.roll || 0)})"><use href="#rcar"/></g></g>
      ${roof}
      ${f.st ? miniStick(px + pw - 30, 30, f.st) : ''}
      <circle cx="${px + 22}" cy="24" r="12" fill="${C.accent}"/>
      <text x="${px + 22}" y="28.5" font-size="13" font-weight="800" text-anchor="middle" fill="#14161c">${i + 1}</text>
      ${lines.map((l, j) => `<text x="${cx}" y="${ph + 18 + j * 17}" font-size="13" font-weight="${j === 0 ? 600 : 500}" text-anchor="middle" fill="${C.text}">${esc(l)}</text>`).join('')}
    </g>`;
  });
  panels.push(`<text x="${W - 10}" y="${H - 6}" font-size="10" text-anchor="end" fill="${C.muted}">View from behind the car · simplified</text>`);
  return svgDoc(W, H, ALL_DEFS, panels.join('\n'), `${m.title}: step by step`);
}

// Three panels: what the stick does with and without air roll.
function freeAirRollExplained() {
  const H = 280;
  const pw = W / 3;
  const panel = (i, title, sub, inner, st) => {
    const px = i * pw;
    return `<rect x="${px + 6}" y="6" width="${pw - 12}" height="${H - 12}" rx="12" fill="#151923" stroke="#2a2f3b"/>
      <text x="${px + pw / 2}" y="32" font-size="14" font-weight="700" text-anchor="middle" fill="${C.text}">${esc(title)}</text>
      <g transform="translate(${px + pw / 2} 120)">${inner}</g>
      ${miniStick(px + pw / 2, 192, st)}
      <text x="${px + pw / 2}" y="${H - 18}" font-size="13" font-weight="700" text-anchor="middle" fill="${C.accent}">${esc(sub)}</text>`;
  };
  const yaw = `<g opacity=".3"><use href="#tcar"/></g><g transform="rotate(35)"><use href="#tcar"/></g><path d="M-8,-44 A44,44 0 0 1 30,-30" fill="none" stroke="${C.accent}" stroke-width="3" marker-end="url(#ah2)"/><text y="-62" font-size="11" text-anchor="middle" fill="${C.muted}">seen from above</text>`;
  const roll = `<g opacity=".3"><use href="#rcar"/></g><g transform="rotate(35)"><use href="#rcar"/></g>${rollArrow('right', 48)}<text y="-62" font-size="11" text-anchor="middle" fill="${C.muted}">seen from behind</text>`;
  const pitch = `<g opacity=".3"><use href="#car"/></g><g transform="rotate(-30)"><use href="#car"/></g><path d="M50,8 A50,50 0 0 0 40,-30" fill="none" stroke="${C.accent}" stroke-width="3" marker-end="url(#ah2)"/><text y="-62" font-size="11" text-anchor="middle" fill="${C.muted}">seen from the side</text>`;
  const body = [
    panel(0, 'Stick left/right', 'turns the car (yaw)', yaw, { x: 1 }),
    panel(1, 'Hold air roll + left/right', 'rolls the car', roll, { x: 1, ar: true }),
    panel(2, 'Stick back/forward', 'tilts nose up/down (pitch)', pitch, { y: 1 }),
  ].join('\n');
  return svgDoc(W, H, ALL_DEFS, body, 'What the stick does in the air, with and without air roll');
}

// Top-down helpers (goal at the top).
function topGoal(cx = 320, w = 120) {
  return `<rect x="${cx - w / 2}" y="10" width="${w}" height="28" fill="#1b2a3a" stroke="${C.text}" stroke-width="2"/><line x1="${cx - w / 2 - 30}" x2="${cx + w / 2 + 30}" y1="38" y2="38" stroke="${C.text}" stroke-width="3"/><text x="${cx}" y="29" font-size="12" font-weight="700" text-anchor="middle" fill="${C.text}">GOAL</text>`;
}
const arrowTo = (x1, y1, x2, y2, color = C.good, dash = '') => `<path d="M${x1},${y1} L${x2},${y2}" stroke="${color}" stroke-width="3" ${dash ? `stroke-dasharray="${dash}"` : ''} marker-end="url(#${color === C.good ? 'ahg' : 'ah2'})"/>`;
const note = (x, y, t, anchor = 'start', color = C.text, size = 13, weight = 600) => `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" fill="${color}">${esc(t)}</text>`;
const badge = (x, y, n) => `<circle cx="${x}" cy="${y}" r="11" fill="${C.accent}"/><text x="${x}" y="${y + 4.5}" font-size="12" font-weight="800" text-anchor="middle" fill="#14161c">${n}</text>`;

function powerBasics() {
  const H = 320;
  const parts = [topField(H), topGoal(),
    `<path d="M150,300 L300,200" stroke="${C.text}" stroke-width="2" stroke-dasharray="4 8" opacity=".4"/>`,
    `<g opacity=".35" transform="translate(190 273) rotate(56)"><use href="#tcar"/></g>`,
    `<g transform="translate(296 204) rotate(56)"><use href="#tcar"/></g>`,
    `<path d="M150,300 h-40 M160,288 h-46 M150,276 h-34" stroke="${C.text}" stroke-width="3" opacity=".5" stroke-linecap="round"/>`,
    `<g transform="translate(320 170)"><use href="#tball"/></g>`,
    arrowTo(320, 152, 320, 48),
    badge(118, 248, 1), note(134, 252, 'Speed into the ball (yours + the ball’s)'),
    badge(390, 196, 2), note(406, 200, 'Hit it with your nose or front corner'),
    badge(390, 106, 3), note(406, 110, 'Flip direction = shot direction'),
    note(W - 12, H - 10, 'View from above · simplified illustration', 'end', C.muted, 11, 400),
  ];
  return svgDoc(W, H, ALL_DEFS, parts.join('\n'), 'What makes a powerful shot');
}

function contactPoints() {
  const H = 300;
  const pw = W / 3;
  const scene = (i, offset, label) => {
    const px = i * pw;
    const cx = px + pw / 2;
    const bx = cx;
    const by = 150;
    const carX = bx + offset;
    const dir = -offset * 2.2;
    return `<g>
      <rect x="${px + 6}" y="6" width="${pw - 12}" height="${H - 12}" rx="12" fill="${C.turf}" stroke="#2a2f3b"/>
      <rect x="${cx - 40}" y="14" width="80" height="20" fill="#1b2a3a" stroke="${C.text}"/><text x="${cx}" y="28" font-size="10" font-weight="700" text-anchor="middle" fill="${C.text}">GOAL</text>
      <g transform="translate(${bx} ${by})"><use href="#tball"/></g>
      <g transform="translate(${carX} ${by + 37})"><use href="#tcar"/></g>
      ${arrowTo(bx, by - 18, bx + dir, 52)}
      <circle cx="${bx + offset * 0.55}" cy="${by + 13}" r="4" fill="${C.accent}"/>
      ${note(cx, H - 40, label, 'middle', C.text, 13, 700)}
    </g>`;
  };
  const body = [
    scene(0, -14, 'Hit its left side → goes right'),
    scene(1, 0, 'Hit dead center → straight'),
    scene(2, 14, 'Hit its right side → goes left'),
    note(W - 12, H - 14, 'View from above · simplified', 'end', C.muted, 10, 400),
  ].join('\n');
  return svgDoc(W, H, ALL_DEFS, body, 'Where you hit the ball decides where it goes');
}

function turnShot() {
  const H = 320;
  const parts = [topField(H), topGoal(),
    `<path d="M320,300 L320,150" stroke="${C.ball}" stroke-width="2" stroke-dasharray="3 7" opacity=".6"/>`,
    `<g opacity=".35" transform="translate(320 270)"><use href="#tball"/></g>`,
    `<g opacity=".35" transform="translate(262 292)"><use href="#tcar"/></g>`,
    `<g opacity=".6" transform="translate(262 232) rotate(-6)"><use href="#tcar"/></g>`,
    `<path d="M262,292 C262,220 270,190 305,168" fill="none" stroke="${C.text}" stroke-width="2" stroke-dasharray="4 8" opacity=".5"/>`,
    `<g transform="translate(298 176) rotate(48)"><use href="#tcar"/></g>`,
    `<g transform="translate(320 150)"><use href="#tball"/></g>`,
    arrowTo(326, 134, 360, 48),
    badge(232, 300, 1), note(150, 304, 'Stay close', 'start'),
    badge(232, 230, 2), note(70, 234, 'Drift to one side', 'start'),
    badge(272, 160, 3), note(120, 150, 'Turn into it — no flip', 'start'),
    note(380, 110, 'nose or corner hits it', 'start', C.good, 12, 700),
    note(W - 12, H - 10, 'View from above · simplified illustration', 'end', C.muted, 11, 400),
  ];
  return svgDoc(W, H, ALL_DEFS, parts.join('\n'), 'The ground power shot (turn shot): step by step');
}

function aimWithRoll() {
  const H = 320;
  const parts = [topField(H),
    `<rect x="200" y="10" width="240" height="28" fill="#1b2a3a" stroke="${C.text}" stroke-width="2"/><line x1="170" x2="470" y1="38" y2="38" stroke="${C.text}" stroke-width="3"/>`,
    `<g opacity=".7" transform="translate(320 58) rotate(180)"><use href="#tcar"/></g>`, note(320, 116, 'defender', 'middle', C.ghost, 11, 400),
    `<g transform="translate(320 230)"><use href="#tball"/></g>`,
    arrowTo(320, 212, 220, 30, C.good, '6 6'), arrowTo(320, 212, 290, 30, C.good), arrowTo(320, 212, 420, 30, C.good, '6 6'),
    note(150, 140, 'big roll right →', 'start', C.text, 12), note(150, 156, 'far left', 'start', C.good, 12, 700),
    note(250, 190, 'slight roll:', 'end', C.text, 12), note(250, 206, 'near the middle', 'end', C.good, 12, 700),
    note(470, 140, '← big roll left', 'end', C.text, 12), note(470, 156, 'far right', 'end', C.good, 12, 700),
    note(320, 300, 'Rolling right aims left of the defender; rolling left aims right. More roll = further to that side.', 'middle', C.muted, 12, 400),
  ];
  return svgDoc(W, H, ALL_DEFS, parts.join('\n'), 'Aiming your shot with air roll (view from above)');
}

function redirectDiagram() {
  const H = 320;
  const parts = [topField(H), topGoal(),
    `<path d="M610,250 C520,210 420,180 330,160" fill="none" stroke="${C.ball}" stroke-width="2" stroke-dasharray="3 7" opacity=".7"/>`,
    `<g opacity=".4" transform="translate(560 230)"><use href="#tball"/></g>`, note(600, 290, 'pass', 'end', C.ghost, 12, 400),
    `<g transform="translate(330 160)"><use href="#tball"/></g>`,
    `<g opacity=".35" transform="translate(300 290) rotate(-10)"><use href="#tcar"/></g>`,
    `<g transform="translate(318 196) rotate(-20)"><use href="#tcar"/></g>`,
    arrowTo(330, 142, 320, 48),
    badge(74, 296, 1), note(90, 300, 'Read the pass, take off early', 'start', C.text, 12),
    badge(74, 192, 2), note(90, 196, 'Air roll to angle your car', 'start', C.text, 12),
    badge(372, 150, 3), note(392, 132, 'The angle of your car', 'start', C.text, 12), note(392, 148, 'sends it at the goal', 'start', C.good, 12, 700),
    note(W - 12, H - 10, 'View from above · simplified illustration', 'end', C.muted, 11, 400),
  ];
  return svgDoc(W, H, ALL_DEFS, parts.join('\n'), 'Air roll redirects: step by step');
}

// Side-view strips for the power shots (reuse sideSteps).
const SHOT_MOVES = {
  'shooting-and-power-shooting/bounce-powershot': {
    title: 'The bounce power shot',
    D: 3,
    car: track([
      [0, { x: 60, y: CAR_Y, a: 0 }],
      [1.4, { x: 330 }],
      [1.6, { x: 360, y: 236, a: -5 }, 'out'],
      [1.75, { x: 385, y: 228, a: 25 }],
    ]),
    ball: track([[0, { x: 470, y: 110 }], [1.0, { x: 440, y: BALL_Y }, 'in'], [1.75, { x: 425, y: 212 }, 'out']]),
    boost: [[0.4, 1.5]],
    frames: [
      { t: 0.95, label: 'Read the bounce, drive to meet it' },
      { t: 1.6, label: 'Jump as it comes up' },
      { t: 1.75, label: 'Flip into it: nose or corner' },
    ],
  },
  'shooting-and-power-shooting/aerial-powershot': {
    title: 'The aerial power shot',
    D: 3,
    car: track([
      [0, { x: 80, y: CAR_Y, a: 0 }],
      [1.0, { x: 220 }],
      [1.3, { x: 250, y: 215, a: -35 }, 'out'],
      [2.4, { x: 400, y: 110, a: -30 }],
      [2.55, { x: 425, y: 104, a: 20 }],
    ]),
    ball: track([[0, { x: 560, y: 60 }], [2.55, { x: 466, y: 86 }]]),
    boost: [[1.3, 2.5]],
    frames: [
      { t: 1.2, label: 'Line it up, then jump' },
      { t: 2.0, label: 'Boost to meet it' },
      { t: 2.55, label: 'Flip toward goal as you hit it' },
    ],
  },
};

const ROLL_STRIPS = {
  'free-air-roll/rolling-control': { title: 'Rolling control', frames: [
    { roll: 0, ground: true, st: { ar: true, jump: true }, label: 'Jump, then hold air roll' },
    { roll: -90, arrow: 'left', st: { x: -1, ar: true }, label: 'Stick left: it rolls left' },
    { roll: -180, arrow: 'left', st: { x: -1, ar: true }, label: 'Keep rolling: upside down' },
    { roll: -320, arrow: 'left', st: { x: -0.4, ar: true }, label: 'Ease off as the wheels come round' },
    { roll: -360, ground: true, st: {}, label: 'Center the stick: stop level' },
  ] },
  'free-air-roll/stop-on-an-angle': { title: 'Stopping on an angle', frames: [
    { roll: 0, st: { ar: true }, label: 'Start level, hold air roll' },
    { roll: -90, arrow: 'left', st: { x: -1, ar: true }, label: 'Tap left: stop at 90°' },
    { roll: -180, arrow: 'left', st: { x: -1, ar: true }, label: 'Tap again: stop upside down' },
    { roll: 0, arrow: 'right', st: { x: 1, ar: true }, label: 'Roll back right to level' },
  ] },
  'free-air-roll/roll-to-steer': { title: 'Roll, then pitch, to steer', frames: [
    { roll: 0, ball: [62, 14], st: { y: 1 }, label: 'The ball is off to your right' },
    { roll: 90, arrow: 'right', ball: [62, 14], st: { x: 1, ar: true }, label: 'Air roll right 90°' },
    { roll: 90, roofArrow: true, ball: [62, 14], st: { y: 1 }, label: 'Stick back: the nose swings toward it' },
  ] },
  'shooting-with-free-air-roll/roll-and-aim': { title: 'Roll changes where the ball goes', frames: [
    { roll: -30, ball: [0, -52], ballArrow: 40, st: { x: -1, ar: true }, label: 'Roll left → ball goes right' },
    { roll: 0, ball: [0, -52], ballArrow: 0, st: {}, label: 'Level → straight' },
    { roll: 30, ball: [0, -52], ballArrow: -40, st: { x: 1, ar: true }, label: 'Roll right → ball goes left' },
  ] },
  'shooting-with-free-air-roll/air-roll-shot': { title: 'The air roll shot', frames: [
    { roll: 0, ground: true, ball: [0, -52], st: { jump: true }, label: 'Jump toward the ball' },
    { roll: -35, arrow: 'left', ball: [0, -52], st: { x: -0.6, ar: true }, label: 'Air roll a little: line up a front corner' },
    { roll: -35, ball: [0, -52], ballArrow: 34, st: { x: 0.7, y: -0.7, jump: true }, label: 'Dodge diagonally: the corner hits it' },
  ] },
};

const INTERMEDIATE_INPUTS = {
  'free-air-roll/rolling-control': { title: 'Rolling control', D: 5, slow: 1.5,
    steps: [
      { label: 'Jump', from: 0.3, to: 0.6 },
      { label: 'Hold air roll + stick left', from: 0.6, to: 3.0 },
      { label: 'Ease off to stop level', from: 3.0, to: 3.6 },
      { label: 'Land on your wheels', from: 3.6, to: 5 },
    ],
    stick: [[0, { x: 0, y: 0 }], [0.8, {}], [0.9, { x: -1 }], [3.0, {}], [3.3, { x: 0 }]],
    buttons: [{ label: 'Jump', on: [[0.3, 0.55]] }, { label: 'Air roll', on: [[0.6, 3.6]] }],
    notes: [
      { from: 0.3, to: 0.6, text: 'Jump (hold it for height)' },
      { from: 0.6, to: 3.0, text: 'Air roll held: left/right now ROLLS' },
      { from: 3.0, to: 3.6, text: 'Center the stick to stop the roll' },
      { from: 3.6, to: 5, text: 'Wheels down, land and drive' },
    ] },
  'free-air-roll/stop-on-an-angle': { title: 'Stopping on an angle', D: 6, slow: 1.5,
    steps: [
      { label: 'Roll left to 90° and stop', from: 1.0, to: 2.4 },
      { label: 'Roll to upside down and stop', from: 2.4, to: 3.8 },
      { label: 'Roll back to level', from: 3.8, to: 6 },
    ],
    stick: [[0, { x: 0, y: 0 }], [1.0, {}], [1.05, { x: -1 }], [1.55, {}], [1.6, { x: 0 }], [2.4, {}], [2.45, { x: -1 }], [2.95, {}], [3.0, { x: 0 }], [3.8, {}], [3.85, { x: 1 }], [4.95, {}], [5.0, { x: 0 }]],
    buttons: [{ label: 'Jump', on: [[0.3, 0.55]] }, { label: 'Air roll', on: [[0.6, 5.2]] }],
    notes: [
      { from: 1.0, to: 1.6, text: 'Short tap left: a quarter roll' },
      { from: 1.6, to: 2.4, text: 'Stick centered: it stays at 90°' },
      { from: 2.4, to: 3.8, text: 'Another tap: now upside down' },
      { from: 3.8, to: 5.2, text: 'Hold right to roll back level' },
    ] },
  'free-air-roll/roll-to-steer': { title: 'Roll, then pitch, to steer', D: 5, slow: 1.5,
    steps: [
      { label: 'Take off toward the ball', from: 0.3, to: 1.2 },
      { label: 'Air roll right 90°', from: 1.2, to: 1.8 },
      { label: 'Stick back: nose swings to it', from: 1.9, to: 3.0 },
      { label: 'Boost into the ball', from: 3.0, to: 5 },
    ],
    stick: [[0, { x: 0, y: 0 }], [0.35, { y: 1 }], [1.1, {}], [1.2, { y: 0 }], [1.25, { x: 1 }], [1.75, {}], [1.85, { x: 0 }], [1.95, { y: 1 }], [2.9, {}], [3.0, { y: 0 }]],
    buttons: [{ label: 'Jump', on: [[0.3, 0.55], [0.65, 0.75]] }, { label: 'Boost', on: [[0.3, 3.6]] }, { label: 'Air roll', on: [[1.2, 1.8]] }],
    notes: [
      { from: 0.3, to: 1.2, text: 'Aerial up as normal' },
      { from: 1.2, to: 1.8, text: 'Air roll + right: a quarter roll' },
      { from: 1.9, to: 3.0, text: 'Pitch (stick back) now turns you right' },
      { from: 3.0, to: 5, text: 'Keep boosting at the ball' },
    ] },
  'shooting-and-power-shooting/ground-shots': { title: 'Ground shots', D: 4,
    steps: [
      { label: 'Line up behind the ball', from: 0, to: 1.2 },
      { label: 'Drive through it', from: 1.2, to: 2.0 },
      { label: 'Follow through', from: 2.0, to: 4 },
    ],
    stick: [[0, { x: 0, y: 0 }], [0.4, { x: 0.3 }], [1.1, {}], [1.2, { x: 0 }]],
    buttons: [{ label: 'Throttle', on: [[0, 2.4]] }, { label: 'Boost', on: [[0.8, 2.0]] }],
    notes: [
      { from: 0, to: 1.2, text: 'Steer to hit the side you want' },
      { from: 1.2, to: 2.0, text: 'Throttle + boost through the ball' },
      { from: 2.0, to: 4, text: 'Keep driving: don’t brake into it' },
    ] },
  'shooting-and-power-shooting/turn-powershot': { title: 'The turn shot', D: 4.5,
    steps: [
      { label: 'Stay close to the ball', from: 0, to: 0.6 },
      { label: 'Drift to one side', from: 0.6, to: 1.4 },
      { label: 'Turn into it', from: 1.4, to: 2.3 },
      { label: 'No flip: recover fast', from: 2.3, to: 4.5 },
    ],
    stick: [[0, { x: 0, y: 0 }], [0.6, {}], [0.7, { x: -0.4 }], [1.2, {}], [1.4, { x: 1 }], [2.2, {}], [2.3, { x: 0 }]],
    buttons: [{ label: 'Throttle', on: [[0, 3]] }, { label: 'Boost', on: [[1.4, 2.4]] }],
    notes: [
      { from: 0, to: 0.6, text: 'Drive alongside the rolling ball' },
      { from: 0.6, to: 1.4, text: 'Slight steer away to make space' },
      { from: 1.4, to: 2.3, text: 'Hard turn + boost into the ball' },
      { from: 2.3, to: 4.5, text: 'You’re still on the ground: chase it' },
    ] },
  'shooting-and-power-shooting/bounce-powershot': { title: 'The bounce power shot', D: 3, slow: 2,
    steps: [
      { label: 'Read the bounce', from: 0, to: 1.0 },
      { label: 'Drive to meet it', from: 1.0, to: 1.55 },
      { label: 'Jump as it comes up', from: 1.55, to: 1.7 },
      { label: 'Diagonal flip into it', from: 1.7, to: 3 },
    ],
    stick: [[0, { x: 0, y: 0 }], [1.66, {}], [1.7, { x: 0.7, y: -0.7 }], [1.95, {}], [2.0, { x: 0, y: 0 }]],
    buttons: [{ label: 'Throttle', on: [[0, 1.7]] }, { label: 'Boost', on: [[0.4, 1.5]] }, { label: 'Jump', on: [[1.55, 1.62], [1.72, 1.8]] }],
    notes: [
      { from: 0, to: 1.0, text: 'Watch where it will land' },
      { from: 1.0, to: 1.55, text: 'Get there as it bounces up' },
      { from: 1.55, to: 1.7, text: 'Quick jump right as you meet it' },
      { from: 1.7, to: 3, text: 'Stick diagonal + jump = flip into it' },
    ] },
  'shooting-and-power-shooting/aerial-powershot': { title: 'The aerial power shot', D: 3.2, slow: 1.5,
    steps: [
      { label: 'Line it up and jump', from: 0, to: 1.25 },
      { label: 'Boost to meet it', from: 1.25, to: 2.48 },
      { label: 'Flip toward goal on contact', from: 2.48, to: 3.2 },
    ],
    stick: [[0, { x: 0, y: 0 }], [1.05, {}], [1.1, { y: 1 }], [1.5, {}], [1.55, { y: 0.3 }], [2.45, {}], [2.48, { y: -1 }], [2.75, {}], [2.8, { y: 0 }]],
    buttons: [{ label: 'Throttle', on: [[0, 1.0]] }, { label: 'Jump', on: [[1.0, 1.25], [2.5, 2.58]] }, { label: 'Boost', on: [[1.25, 2.5]] }],
    notes: [
      { from: 0, to: 1.25, text: 'Face the goal, then take off' },
      { from: 1.25, to: 2.48, text: 'Boost and aim the nose at the ball' },
      { from: 2.48, to: 3.2, text: 'Stick forward + jump as you hit it' },
    ] },
  'shooting-with-free-air-roll/air-roll-shot': { title: 'The air roll shot', D: 3, slow: 2,
    steps: [
      { label: 'Jump toward the ball', from: 0.5, to: 0.8 },
      { label: 'Air roll a little', from: 0.8, to: 1.45 },
      { label: 'Diagonal dodge into it', from: 1.45, to: 1.8 },
      { label: 'Front corner sends it', from: 1.8, to: 3 },
    ],
    stick: [[0, { x: 0, y: 0 }], [0.82, {}], [0.88, { x: -0.6 }], [1.4, {}], [1.46, { x: 0.7, y: -0.7 }], [1.7, {}], [1.76, { x: 0, y: 0 }]],
    buttons: [{ label: 'Throttle', on: [[0, 0.5]] }, { label: 'Jump', on: [[0.5, 0.7], [1.5, 1.58]] }, { label: 'Air roll', on: [[0.8, 1.45]] }],
    notes: [
      { from: 0.5, to: 0.8, text: 'Jump at the ball' },
      { from: 0.8, to: 1.45, text: 'Air roll + stick: a small roll only' },
      { from: 1.45, to: 1.8, text: 'Diagonal + jump: dodge, don’t front flip' },
      { from: 1.8, to: 3, text: 'Land and follow the shot' },
    ] },
  'shooting-with-free-air-roll/aim-with-roll': { title: 'Aiming with roll', D: 4.5, slow: 1.5,
    steps: [
      { label: 'Aerial toward the ball', from: 0.3, to: 1.6 },
      { label: 'Roll right: a little or a lot', from: 1.6, to: 2.1 },
      { label: 'Hit it: the ball goes left', from: 2.1, to: 4.5 },
    ],
    stick: [[0, { x: 0, y: 0 }], [0.35, { y: 1 }], [1.0, {}], [1.1, { y: 0.3 }], [1.6, { y: 0.3 }], [1.65, { x: 1, y: 0 }], [2.05, {}], [2.1, { x: 0 }]],
    buttons: [{ label: 'Jump', on: [[0.3, 0.55], [0.65, 0.75]] }, { label: 'Boost', on: [[0.3, 2.6]] }, { label: 'Air roll', on: [[1.6, 2.1]] }],
    notes: [
      { from: 0.3, to: 1.6, text: 'Aerial up to the ball' },
      { from: 1.6, to: 2.1, text: 'Air roll + right: more roll = more angle' },
      { from: 2.1, to: 4.5, text: 'The ball goes left of the defender' },
    ] },
  'shooting-with-free-air-roll/air-roll-redirects': { title: 'Air roll redirects', D: 4.5, slow: 1.5,
    steps: [
      { label: 'Read the pass, take off early', from: 0.3, to: 1.5 },
      { label: 'Air roll to angle your car', from: 1.5, to: 2.3 },
      { label: 'Meet it: your angle aims it', from: 2.3, to: 4.5 },
    ],
    stick: [[0, { x: 0, y: 0 }], [0.35, { y: 1 }], [1.0, {}], [1.1, { y: 0.3 }], [1.5, {}], [1.55, { x: -0.7, y: 0 }], [2.25, {}], [2.3, { x: 0 }]],
    buttons: [{ label: 'Jump', on: [[0.3, 0.55], [0.65, 0.75]] }, { label: 'Boost', on: [[0.3, 2.7]] }, { label: 'Air roll', on: [[1.5, 2.3]] }],
    notes: [
      { from: 0.3, to: 1.5, text: 'Go early to meet the pass' },
      { from: 1.5, to: 2.3, text: 'Air roll to face your car at the goal' },
      { from: 2.3, to: 4.5, text: 'Hold the angle through the touch' },
    ] },
};

// ---------- write files ----------
function write(rel, svg) {
  const file = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, svg);
  console.log(`  ${path.relative(path.join(__dirname, '..'), file)}  (${(svg.length / 1024).toFixed(1)} KB)`);
}

console.log('Building course media…');
for (const [key, m] of Object.entries(MOVES)) {
  const [course, name] = key.split('/');
  write(`${course}/media/${name}-steps.svg`, sideSteps(m));
}
for (const [key, spec] of Object.entries(INPUTS)) {
  const [course, name] = key.split('/');
  const base = MOVES[key] || {};
  write(`${course}/media/${name}-inputs-clip.svg`, inputsClip(key, { ...base, ...spec }));
}
write('aerial-foundations/media/aerial-shots-diagram.svg', aerialShots().diagram);
write('recovery-and-movement/media/powerslide-turns-diagram.svg', powerslideDiagram());
write('aerial-foundations/media/practice-loop.svg', practiceLoop());

for (const [key, m] of Object.entries(BACKBOARD)) {
  const [course, name] = key.split('/');
  write(`${course}/media/${name}-steps.svg`, sceneSteps(m));
  write(`${course}/media/${name}-inputs-clip.svg`, inputsClip(key, { ...m, ...m.inputs }));
}
write('backboard-defense/media/catch-and-dump-steps.svg', catchAndDumpDiagram());
write('backboard-defense/media/catch-and-dump-inputs-clip.svg', inputsClip('backboard-defense/catch-and-dump', CATCH_AND_DUMP_INPUTS));
write('backboard-defense/media/backboard-overview.svg', backboardOverview());

for (const [key, m] of Object.entries(ROLL_STRIPS)) {
  const [course, name] = key.split('/');
  write(`${course}/media/${name}-steps.svg`, rollStrip(m));
}
for (const [key, m] of Object.entries(SHOT_MOVES)) {
  const [course, name] = key.split('/');
  write(`${course}/media/${name}-steps.svg`, sideSteps(m));
}
for (const [key, spec] of Object.entries(INTERMEDIATE_INPUTS)) {
  const [course, name] = key.split('/');
  write(`${course}/media/${name}-inputs-clip.svg`, inputsClip(key, spec));
}
write('free-air-roll/media/free-air-roll-explained.svg', freeAirRollExplained());
write('shooting-and-power-shooting/media/power-basics.svg', powerBasics());
write('shooting-and-power-shooting/media/ground-shots-steps.svg', contactPoints());
write('shooting-and-power-shooting/media/turn-powershot-steps.svg', turnShot());
write('shooting-with-free-air-roll/media/aim-with-roll-steps.svg', aimWithRoll());
write('shooting-with-free-air-roll/media/air-roll-redirects-steps.svg', redirectDiagram());
console.log('Done.');
