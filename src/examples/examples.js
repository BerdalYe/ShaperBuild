// Ready-made example designs, built step by step with the same tools the AI
// assistant uses, so each opens with a full History to change: sizes, counts,
// twist, text…
//
// A step is [tool, input, name?]. A name keeps the step's result: the sketch
// id, or the first body it made. Later inputs use "$name" for it.

import { t } from '../core/i18n.js';

const C = Math.cos;
const S = Math.sin;
const rad = (d) => (d * Math.PI) / 180;

// A fir tree from stacked triangles and a trunk, standing on y = base.
function fir(x, base, width, height, layers = 4) {
  const out = [];
  for (let i = 0; i < layers; i++) {
    const y0 = base + (i * height) / (layers + 0.6);
    const w = width * (1 - i / (layers + 0.5));
    out.push({ type: 'polygon', points: [[x - w / 2, y0], [x + w / 2, y0], [x, y0 + height / (layers - 0.6)]] });
  }
  out.push({ type: 'rect', x, y: base - 1.5, width: width * 0.14, height: 4 });
  return out;
}

// A six-armed snowflake around c, `r` long.
function snowflake(c, r, arm = 1.2) {
  const six = { count: 6, around: c };
  const k = r / 10;
  return [
    { type: 'rect', x: c[0], y: c[1] + r / 2, width: arm, height: r, repeat: six },
    { type: 'polygon', points: [[c[0] - 3 * k, c[1] + 5.4 * k], [c[0], c[1] + 8.3 * k], [c[0], c[1] + 6.9 * k], [c[0] - 2.2 * k, c[1] + 4.7 * k]], repeat: six },
    { type: 'polygon', points: [[c[0] + 3 * k, c[1] + 5.4 * k], [c[0], c[1] + 8.3 * k], [c[0], c[1] + 6.9 * k], [c[0] + 2.2 * k, c[1] + 4.7 * k]], repeat: six },
    { type: 'circle', x: c[0], y: c[1], radius: 2.2 * k },
  ];
}

// A round frame with a hanging loop at the top.
const frame = (r, wall = 2.6) => [
  { type: 'circle', x: 0, y: 0, radius: r, wall },
  { type: 'circle', x: 0, y: r + 2.5, radius: 4.2, wall: 1.8 },
];

export const EXAMPLES = [
  {
    id: 'twisted-star',
    title: 'Twisted star fidget',
    desc: 'A hollow six-point star that twists and narrows as it rises. Change the twist or the size at the end in History.',
    icon: 'sparkle',
    steps: [
      ['sketch', { plane: 'XY', shapes: [{ type: 'star', x: 0, y: 0, tips: 6, radius: 30, inner_radius: 19, wall: 1.6 }] }, 'star'],
      ['extrude', { sketch_id: '$star', distance: 60, twist: 120, end_scale: 0.55, mode: 'new' }, 'body'],
      ['set_color', { body_ids: ['$body'], color: '#7e57c2' }],
      ['rename', { id: '$body', name: 'Twisted star' }],
    ],
  },
  {
    id: 'expanding-star',
    title: 'Expanding star fidget',
    desc: 'Eight nested star shells with a 0.4 mm gap. Printed flat, they pull out into a cone and catch on each other.',
    icon: 'patternLinear',
    steps: [
      ...Array.from({ length: 8 }, (_, i) => [
        'sketch',
        { plane: 'XY', shapes: [{ type: 'star', x: 0, y: 0, tips: 5, radius: 42, inner_radius: 21, offset: -i * 1.6, wall: 1.2 }] },
        `s${i}`,
      ]),
      ...Array.from({ length: 8 }, (_, i) => ['extrude', { sketch_id: `$s${i}`, distance: 10, taper: 8, mode: 'new' }, `b${i}`]),
      ['set_color', { body_ids: Array.from({ length: 8 }, (_, i) => `$b${i}`), color: '#ffb300' }],
      ['set_color', { body_ids: ['$b1', '$b3', '$b5', '$b7'], color: '#e53935' }],
    ],
  },
  {
    id: 'ornament-tree',
    title: 'Christmas ornament',
    desc: 'A round ornament with fir trees, a star, a little house and snowy ground, in one 2.5 mm piece with a loop to hang it.',
    icon: 'circle',
    steps: [
      [
        'sketch',
        {
          plane: 'XY',
          shapes: [
            ...frame(38),
            // Snowy ground: a wavy top, closed along the inside of the frame.
            { type: 'spline', closed: true, points: [[-25, -12], [-10, -10], [5, -13], [20, -10], ...[-10, -40, -70, -90, -110, -140, -170].map((d) => [37 * C(rad(d)), 37 * S(rad(d))])] },
            ...fir(-18, -11, 22, 34),
            { type: 'star', x: -18, y: 22.6, tips: 5, radius: 3.6, inner_radius: 1.5 },
            ...fir(-3, -11.5, 10, 15, 3),
            { type: 'rect', x: 16, y: -5, width: 14, height: 11 },
            { type: 'polygon', points: [[7.5, 0], [24.5, 0], [16, 8.5]] },
            { type: 'rect', x: 13, y: -5.5, width: 3.2, height: 3.2, hole: true },
            { type: 'rect', x: 20, y: -7.5, width: 2.6, height: 5, hole: true },
            ...[[-24, -22], [-8, -18], [6, -26], [22, -17], [-14, -29]].map(([x, y]) => ({ type: 'circle', x, y, radius: 0.9, hole: true })),
          ],
        },
        'art',
      ],
      ['extrude', { sketch_id: '$art', distance: 2.5, mode: 'new' }, 'body'],
      ['set_color', { body_ids: ['$body'], color: '#f5f5f5' }],
      ['rename', { id: '$body', name: 'Ornament' }],
    ],
  },
  {
    id: 'ornament-snowflake',
    title: 'Snowflake ornament',
    desc: 'A snowflake hanging in a round frame, made from one arm repeated six times.',
    icon: 'patternCircular',
    steps: [
      [
        'sketch',
        {
          plane: 'XY',
          shapes: [...frame(38), ...snowflake([0, -2], 24), { type: 'rect', x: 0, y: 29, width: 1.2, height: 15 }],
        },
        'art',
      ],
      ['extrude', { sketch_id: '$art', distance: 2.5, mode: 'new' }, 'body'],
      ['set_color', { body_ids: ['$body'], color: '#4fc3f7' }],
      ['rename', { id: '$body', name: 'Snowflake ornament' }],
    ],
  },
  {
    id: 'keychain',
    title: 'Name keychain',
    desc: 'A rounded tag with a ring hole and raised letters in a second colour. Use the Text tool (or ask the AI) to put your own name on it.',
    icon: 'text',
    steps: [
      ['sketch', { plane: 'XY', shapes: [{ type: 'rect', x: 0, y: 0, width: 64, height: 22, corner_radius: 11 }, { type: 'circle', x: -23, y: 0, radius: 3.2, hole: true }] }, 'tag'],
      ['extrude', { sketch_id: '$tag', distance: 3, mode: 'new' }, 'body'],
      ['fillet', { body_id: '$body', edges: 'top', radius: 0.8 }],
      ['sketch', { body_id: '$body', face: 'top', shapes: [{ type: 'text', text: 'MAKER', x: 6, y: 0, size: 9 }] }, 'name'],
      ['extrude', { sketch_id: '$name', distance: 1.2, mode: 'new' }, 'letters'],
      ['set_color', { body_ids: ['$body'], color: '#26a69a' }],
      ['set_color', { body_ids: ['$letters*'], color: '#fafafa' }],
      ['rename', { id: '$body', name: 'Tag' }],
    ],
  },
  {
    id: 'mug',
    title: 'Mug with a name',
    desc: 'A turned mug with a swept handle and text wrapped around its side.',
    icon: 'cylinder',
    steps: [
      ['sketch', { plane: 'XZ', shapes: [{ type: 'polygon', points: [[0, 0], [40, 0], [40, 95], [36.5, 95], [36.5, 6], [0, 6]] }] }, 'profile'],
      ['revolve', { sketch_id: '$profile', axis: 'Z' }, 'body'],
      ['sketch', { plane: 'XZ', shapes: [{ type: 'spline', points: [[39, 78], [62, 80], [70, 50], [60, 24], [39, 22]] }] }, 'path'],
      ['sketch', { plane: 'XY', offset: 78, shapes: [{ type: 'ellipse', x: 39, y: 0, radius_x: 6.5, radius_y: 4.5 }] }, 'grip'],
      ['sweep', { sketch_id: '$grip', path_sketch_id: '$path', mode: 'union' }],
      ['fillet', { body_id: '$body', edges: 'top', radius: 1.4 }],
      ['sketch', { plane: 'XZ', offset: 40, shapes: [{ type: 'text', text: 'COFFEE', x: -16, y: 50, size: 12 }] }, 'words'],
      ['wrap', { sketch_id: '$words', body_id: '$body', face: 'round', height: 1 }],
      ['set_color', { body_ids: ['$body'], color: '#ef6c00' }],
      ['rename', { id: '$body', name: 'Mug' }],
    ],
  },
  {
    id: 'phone-stand',
    title: 'Phone stand',
    desc: 'A side profile pulled out to both sides, with a cable slot and rounded edges.',
    icon: 'extrude',
    steps: [
      ['sketch', { plane: 'XZ', shapes: [{ type: 'polygon', points: [[-45, 0], [45, 0], [45, 6], [-6, 6], [-2, 14], [8, 14], [-26, 92], [-34, 88], [-6, 18], [-14, 4], [-45, 6]] }] }, 'side'],
      ['extrude', { sketch_id: '$side', distance: 70, symmetric: true, mode: 'new' }, 'body'],
      ['sketch', { plane: 'XY', offset: 6, shapes: [{ type: 'slot', x: 20, y: 0, length: 36, width: 12, angle: 90 }] }, 'slot'],
      ['extrude', { sketch_id: '$slot', distance: -6, mode: 'subtract' }],
      ['fillet', { body_id: '$body', edges: 'all', radius: 1.5 }],
      ['set_color', { body_ids: ['$body'], color: '#37474f' }],
      ['rename', { id: '$body', name: 'Phone stand' }],
    ],
  },
  {
    id: 'spiral-vase',
    title: 'Spiral vase',
    desc: 'A twelve-sided flower shape twisted a third of a turn, open at the top, with a solid base.',
    icon: 'revolve',
    steps: [
      ['sketch', { plane: 'XY', shapes: [{ type: 'star', x: 0, y: 0, tips: 12, radius: 40, inner_radius: 34 }] }, 'base'],
      ['extrude', { sketch_id: '$base', distance: 3, mode: 'new' }, 'body'],
      ['sketch', { plane: 'XY', offset: 3, shapes: [{ type: 'star', x: 0, y: 0, tips: 12, radius: 40, inner_radius: 34, wall: 1.8 }] }, 'wall'],
      ['extrude', { sketch_id: '$wall', distance: 120, twist: 120, end_scale: 0.75, mode: 'union' }],
      ['set_color', { body_ids: ['$body'], color: '#00897b' }],
      ['rename', { id: '$body', name: 'Vase' }],
    ],
  },
  {
    id: 'plant-pot',
    title: 'Plant pot and saucer',
    desc: 'A tapered pot with drainage holes, and a saucer that fits under it.',
    icon: 'shell',
    steps: [
      ['sketch', { plane: 'XZ', shapes: [{ type: 'polygon', points: [[0, 6], [34, 6], [44, 80], [41, 80], [31.2, 9], [0, 9]] }] }, 'pot'],
      ['revolve', { sketch_id: '$pot', axis: 'Z' }, 'body'],
      ['sketch', { plane: 'XY', offset: 6, shapes: [{ type: 'circle', x: 0, y: 0, radius: 3 }, { type: 'circle', x: 18, y: 0, radius: 2.5, repeat: { count: 5, around: [0, 0] } }] }, 'holes'],
      ['extrude', { sketch_id: '$holes', distance: 3, mode: 'subtract' }],
      ['sketch', { plane: 'XZ', shapes: [{ type: 'polygon', points: [[0, 0], [46, 0], [48, 8], [46, 8], [44, 2], [0, 2]] }] }, 'saucer'],
      ['revolve', { sketch_id: '$saucer', axis: 'Z', mode: 'new' }, 'plate'],
      ['set_color', { body_ids: ['$body'], color: '#d84315' }],
      ['set_color', { body_ids: ['$plate'], color: '#8d6e63' }],
      ['rename', { id: '$body', name: 'Pot' }],
      ['rename', { id: '$plate', name: 'Saucer' }],
    ],
  },
];

// Swap "$name" for the result kept under that name ("$name*": every body
// that step made).
function fill(v, names) {
  if (typeof v === 'string' && v[0] === '$') {
    if (!(v.slice(1) in names)) throw new Error(`example: nothing named ${v}`);
    return names[v.slice(1)];
  }
  if (Array.isArray(v)) return v.flatMap((x) => (typeof x === 'string' && x.endsWith('*') ? fill(x, names) : [fill(x, names)]));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x, names)]));
  return v;
}

// Build an example into the open (empty) design with `run(tool, input)`,
// which returns { text, error }. Calls onStep(i, n) as it goes.
export async function buildExample(ex, run, onStep = () => {}) {
  const names = {};
  for (let i = 0; i < ex.steps.length; i++) {
    const [tool, input, name] = ex.steps[i];
    onStep(i, ex.steps.length);
    const filled = fill(input, names);
    // Body names in the app's language.
    if (tool === 'rename') filled.name = t(filled.name);
    const res = await run(tool, filled);
    if (res.error) throw new Error(`${tool}: ${res.text}`);
    if (name) {
      const out = JSON.parse(res.text);
      names[name] = out.created?.[0]?.id ?? out.changed?.[0]?.id ?? out.id;
      names[`${name}*`] = (out.created || out.changed || []).map((b) => b.id);
    }
  }
}
