// The tutorials, from easy to hard. Each lesson is a list of steps; a step
// with `done` waits until you have done what it asks for. `tut` (the running
// Tutorial) gives the helpers: tut.did('Fillet') is true once a change with
// that name has happened during the step (tut.didMatch(/^Set /) for names
// that start the same), tut.toolBtn('rect') points at a
// tool in the tools menu, tut.ctx('Extrude') at a button in the bar at the
// bottom of the view.
import { modKey, isMac } from './dom.js';
import { t } from '../core/i18n.js';

export const LEVELS = [
  { id: 1, label: 'Beginner', desc: 'Start here' },
  { id: 2, label: 'Intermediate', desc: 'More tools, real parts' },
  { id: 3, label: 'Advanced', desc: 'Change designs later, sizes with names, printing and drawings' },
];

// A box to work on, in the middle of the grid.
async function box(app, width = 60, depth = 40, height = 20) {
  const r = await app.kernel.call('primitive', { type: 'box', params: { width, depth, height } });
  app.cmd.applyResult('Box', r);
  app.selection.clear();
  app.vp.setView('iso', { fit: true });
}

const finish = (text) => ({ title: 'Well done!', text, place: 'center', final: true });

export const LESSONS = [
  {
    id: 'basics',
    level: 1,
    minutes: 3,
    icon: 'learn',
    title: 'The basics: your first part',
    desc: 'Move around, draw a rectangle, make it 3D and round its edges.',
    steps: (tut) => basicsSteps(tut),
  },
  {
    id: 'shapes',
    level: 1,
    minutes: 3,
    icon: 'box',
    title: 'Shapes, moving and cutting',
    desc: 'Add a box and a cylinder, move one into the other and cut a hole.',
    steps: (tut) => [
      {
        title: 'Shapes, moving and cutting',
        text: 'Ready-made shapes are a quick start. You will make a box with a round hole through it.',
        place: 'center',
      },
      {
        title: 'Pick the Box',
        text: 'Click <b>Box</b> in the Shapes tools.',
        target: tut.toolBtn('box'),
        place: 'left',
        enter: () => tut.openTool('box'),
        done: () => tut.tool('box'),
      },
      {
        title: 'Place the box',
        text: 'Set the size in the panel if you like (try <kbd>60</kbd>, <kbd>40</kbd>, <kbd>20</kbd>). Then click on the grid to place it.',
        target: () => document.querySelector('#tool-panel:not([hidden])'),
        place: 'right',
        done: () => tut.did('Box'),
      },
      {
        title: 'Now a cylinder',
        text: 'Click <b>Cylinder</b> in the Shapes tools.',
        target: tut.toolBtn('cylinder'),
        place: 'left',
        enter: () => tut.openTool('cylinder'),
        done: () => tut.tool('cylinder'),
      },
      {
        title: 'Put it on the box',
        text: 'Give it a <b>Height</b> of <kbd>40</kbd> in the panel. Then click on the <b>top of the box</b>: the cylinder stands on the face you click.',
        place: 'top',
        done: () => tut.did('Cylinder'),
      },
      {
        title: 'Select the cylinder',
        text: 'Press <kbd>Esc</kbd> to put the tool away. Then <b>double-click</b> the cylinder: a double-click selects a whole body.',
        place: 'top',
        enter: () => (tut.bodyCount = tut.app.doc.bodies.length),
        done: () => tut.app.tools.isSelect && tut.app.selection.list.some((it) => it.kind === 'body'),
      },
      {
        title: 'Move it down',
        text: 'Click <b>Move</b> in the bar at the bottom (or press <kbd>M</kbd>).',
        target: tut.ctx('Move'),
        place: 'top',
        done: () => tut.tool('move'),
      },
      {
        title: 'Push it through the box',
        text: 'Drag the <b>blue arrow</b> down until the cylinder comes out under the box, or type <kbd>-30</kbd> in <b>Move Z</b>. Then press <kbd>Enter</kbd>.',
        place: 'top',
        done: () => tut.did('Move') && tut.app.tools.isSelect,
      },
      {
        title: 'Select both bodies',
        text: 'Double-click the <b>box</b> first, then double-click the <b>cylinder</b>. Clicking adds to the selection.',
        place: 'top',
        enter: () => tut.app.selection.clear(),
        done: () => new Set(tut.app.selection.list.filter((it) => it.kind === 'body').map((it) => it.bodyId)).size >= 2,
      },
      {
        title: 'Cut the hole',
        text: 'Click <b>Subtract</b> in the bar at the bottom. The first body you picked is kept; the others cut into it. Press <kbd>Enter</kbd> to finish.',
        target: tut.ctx('Subtract'),
        place: 'top',
        done: () => tut.did('Subtract'),
      },
      finish(t('You made a hole with shapes. <b>Union</b> joins bodies and <b>Intersect</b> keeps only where they overlap.<br><br>Made a mistake? <b>Undo</b> with <kbd>{mod}Z</kbd>.', { mod: modKey() })),
    ],
  },
  {
    id: 'sizes',
    level: 1,
    minutes: 4,
    icon: 'dimension',
    title: 'Exact sizes in sketches',
    desc: 'Type sizes while you draw and change them later with dimensions.',
    steps: (tut) => {
      const doc = tut.app.doc;
      const has = (type) => doc.sketches.some((s) => s.entities.some((e) => e.type === type));
      return [
        {
          title: 'Exact sizes in sketches',
          text: 'Parts often need exact sizes. You can type them while you draw, and change them afterwards.',
          place: 'center',
        },
        {
          title: 'A rectangle of 50 × 30',
          text: 'Press <kbd>R</kbd> and click on the grid for the first corner. Then type <kbd>50</kbd> <kbd>Tab</kbd> <kbd>30</kbd> <kbd>Enter</kbd>.<br><small>The sizes you type stay with the sketch as dimensions.</small>',
          place: 'top',
          done: () => doc.sketches.some((s) => s.entities.filter((e) => e.type === 'line').length >= 4),
        },
        {
          title: 'A circle inside it',
          text: 'Press <kbd>C</kbd>, click inside the rectangle for the centre, then type a size like <kbd>12</kbd> and press <kbd>Enter</kbd>.',
          place: 'top',
          done: () => has('circle'),
        },
        {
          title: 'Put the tool away',
          text: 'Press <kbd>Esc</kbd>. The shaded areas are <b>regions</b>: you can pull each one into 3D.',
          place: 'top',
          done: () => tut.app.tools.isSelect,
        },
        {
          title: 'Change a size',
          text: 'Click the <b>50</b> on the rectangle, type <kbd>70</kbd> and press <kbd>Enter</kbd>. The rectangle stretches.<br><small>You can also click the shape and type its <b>Width</b> or <b>Height</b> in the bar at the bottom.</small>',
          place: 'top',
          done: () => tut.didMatch(/^Set /),
        },
        {
          title: 'Add a dimension',
          text: 'Press <kbd>L</kbd> and draw a line next to the rectangle: click, click, then <kbd>Esc</kbd>. Press <kbd>D</kbd> for <b>Dimension</b>, click the line, type <kbd>25</kbd> and press <kbd>Enter</kbd>.',
          place: 'top',
          done: () => tut.didMatch(/^Set /),
        },
        finish('Dimensions <b>drive</b> the sketch: change the number and the drawing follows. Select two lines and use <b>Constrain</b> in the bar at the bottom to make them parallel, equal or at an angle.'),
      ];
    },
  },
  {
    id: 'pushpull',
    level: 1,
    minutes: 2,
    icon: 'extrude',
    title: 'Push and pull faces',
    desc: 'Change a body by dragging its faces.',
    setup: (app) => box(app, 40, 40, 20),
    steps: (tut) => [
      {
        title: 'Push and pull faces',
        text: 'Any flat face of a body can be pushed in or pulled out. Here is a box to try it on.',
        place: 'center',
      },
      {
        title: 'Select the top face',
        text: 'Click the <b>top face</b> of the box.',
        place: 'top',
        done: () => tut.app.selection.list.some((it) => it.kind === 'face'),
      },
      {
        title: 'Pull it up',
        text: 'Click <b>Extrude</b> in the bar at the bottom (or press <kbd>E</kbd>). Drag the arrow up, or type <kbd>10</kbd>, and press <kbd>Enter</kbd>.',
        target: tut.ctx('Extrude'),
        place: 'top',
        done: () => tut.did('Extrude') && tut.app.tools.isSelect,
      },
      {
        title: 'Push a side in',
        text: 'Now click a <b>side face</b>, press <kbd>E</kbd> and type <kbd>-5</kbd> to push it in. Press <kbd>Enter</kbd>.',
        place: 'top',
        done: () => tut.did('Extrude') && tut.app.tools.isSelect,
      },
      finish('Pushing and pulling is the fastest way to change a body. Drawing on a face and extruding the shape adds or cuts just that part.'),
    ],
  },
  {
    id: 'edges',
    level: 2,
    minutes: 4,
    icon: 'fillet',
    title: 'Round, bevel and hollow',
    desc: 'Fillet and chamfer edges, then hollow the part out with Shell.',
    setup: (app) => box(app, 50, 40, 25),
    steps: (tut) => [
      {
        title: 'Round, bevel and hollow',
        text: 'Soft edges look better and are nicer to hold. You will round one edge, bevel another and make the box hollow.',
        place: 'center',
      },
      {
        title: 'Round an edge',
        text: 'Click an <b>edge</b> on the top of the box, then <b>Fillet</b> in the bar at the bottom. Type a radius like <kbd>4</kbd> and press <kbd>Enter</kbd>.',
        place: 'top',
        done: () => tut.did('Fillet') && tut.app.tools.isSelect,
      },
      {
        title: 'Bevel another edge',
        text: 'Click another edge, then <b>Chamfer</b>. Type <kbd>3</kbd> and press <kbd>Enter</kbd>.<br><small>Click more edges before you press Enter to do them all at once.</small>',
        place: 'top',
        done: () => tut.did('Chamfer') && tut.app.tools.isSelect,
      },
      {
        title: 'Hollow it out',
        text: 'Click the <b>top face</b>, then <b>Shell</b> in the bar at the bottom. The face you picked is left open. Set the wall to <kbd>2</kbd> and press <kbd>Enter</kbd>.',
        place: 'top',
        done: () => tut.did('Shell') && tut.app.tools.isSelect,
      },
      {
        title: 'Look inside',
        text: 'Press <kbd>X</kbd> for a <b>Section view</b> and drag the arrow to cut through the part. Press <kbd>Esc</kbd> when you are done.',
        place: 'top',
        done: () => tut.tool('section'),
      },
      finish('Fillets, chamfers and shells are some of the most used tools. Tip: round edges <b>before</b> you shell, so the inside is round too.'),
    ],
  },
  {
    id: 'revolve',
    level: 2,
    minutes: 3,
    icon: 'revolve',
    title: 'Revolve: spin a shape',
    desc: 'Turn a flat shape around an axis to make rings, cups and knobs.',
    steps: (tut) => [
      {
        title: 'Revolve: spin a shape',
        text: 'Round parts like rings, cups and knobs are made by spinning a flat shape around a line.',
        place: 'center',
      },
      {
        title: 'Draw the shape',
        text: 'Press <kbd>R</kbd> and draw a small rectangle a bit to the <b>right</b> of the green line in the middle of the grid. It must not touch the line.',
        place: 'top',
        done: () => tut.app.doc.sketches.some((s) => s.entities.filter((e) => e.type === 'line').length >= 4),
      },
      {
        title: 'Select it',
        text: 'Press <kbd>Esc</kbd>, then click inside the rectangle.',
        place: 'top',
        done: () => tut.app.tools.isSelect && tut.app.selection.list.some((it) => it.kind === 'region'),
      },
      {
        title: 'Revolve it',
        text: 'Click <b>Revolve</b> in the bar at the bottom (or press <kbd>Q</kbd>).',
        target: tut.ctx('Revolve'),
        place: 'top',
        done: () => tut.tool('revolve'),
      },
      {
        title: 'Pick the axis',
        text: 'In the panel, set <b>Or world axis</b> to <b>Y</b> (the green line). Try an <b>Angle</b> of <kbd>270</kbd> to see a part turn. Press <kbd>Enter</kbd>.',
        target: () => document.querySelector('#tool-panel:not([hidden])'),
        place: 'right',
        done: () => tut.did('Revolve'),
      },
      finish('You can also click a line of the sketch or an edge as the axis. Draw the side of a cup with the <b>Line</b> tool and revolve it for a real cup.'),
    ],
  },
  {
    id: 'holes',
    level: 2,
    minutes: 4,
    icon: 'patternLinear',
    title: 'A plate with a row of holes',
    desc: 'Draw on a face, repeat a circle and cut all the holes at once.',
    setup: (app) => box(app, 80, 40, 6),
    steps: (tut) => {
      const doc = tut.app.doc;
      const circles = () => Math.max(0, ...doc.sketches.map((s) => s.entities.filter((e) => e.type === 'circle').length));
      return [
        {
          title: 'A plate with a row of holes',
          text: 'Mounting plates and brackets need holes. You will draw one hole, repeat it and cut them all through the plate.',
          place: 'center',
        },
        {
          title: 'Draw on the top face',
          text: 'Press <kbd>C</kbd> and click on the <b>top of the plate</b>, near the left end. Type <kbd>10</kbd> and press <kbd>Enter</kbd>.<br><small>Clicking a face puts the sketch on that face.</small>',
          place: 'top',
          done: () => circles() >= 1,
        },
        {
          title: 'Repeat the circle',
          text: 'Press <kbd>Esc</kbd>. Pick <b>Pattern</b> in the Sketch tools and click the circle. Set <b>Count</b> to <kbd>4</kbd> and <b>Distance</b> to <kbd>18</kbd>, then press <kbd>Enter</kbd>.<br><small>If the copies run off the plate, change <b>Direction</b>.</small>',
          target: tut.toolBtn('sketchPattern'),
          place: 'left',
          enter: () => tut.openTool('sketchPattern'),
          done: () => circles() >= 3,
        },
        {
          title: 'Select the holes',
          text: 'Press <kbd>Esc</kbd>. Click inside each circle, beside the dot in the middle — every click adds one.',
          place: 'top',
          done: () => tut.app.tools.isSelect && tut.app.selection.list.filter((it) => it.kind === 'region').length >= 2,
        },
        {
          title: 'Cut them through',
          text: 'Click <b>Extrude</b> and type <kbd>-6</kbd>: a minus goes down into the plate, which is 6 mm thick. Press <kbd>Enter</kbd>.<br><small>For thicker parts, turn on <b>Through everything</b>.</small>',
          target: tut.ctx('Extrude'),
          place: 'top',
          done: () => tut.did('Extrude'),
        },
        finish('Shapes drawn on a face cut into the body when you extrude them inwards. <b>Pattern</b> in the Transform tools repeats whole bodies the same way.'),
      ];
    },
  },
  {
    id: 'text',
    level: 2,
    minutes: 3,
    icon: 'text',
    title: 'Text: name tags and labels',
    desc: 'Write on a face and engrave or raise the letters.',
    setup: (app) => box(app, 80, 30, 8),
    steps: (tut) => [
      {
        title: 'Text: name tags and labels',
        text: 'Letters are sketch curves, so you can raise them or cut them in. Let’s make a name tag.',
        place: 'center',
      },
      {
        title: 'Pick the Text tool',
        text: 'Click <b>Text</b> in the Sketch tools.',
        target: tut.toolBtn('text'),
        place: 'left',
        enter: () => tut.openTool('text'),
        done: () => tut.tool('text'),
      },
      {
        title: 'Write your name',
        text: 'Type your name in the panel. Then click in the middle of the <b>top face</b> to place it.',
        target: () => document.querySelector('#tool-panel:not([hidden])'),
        place: 'right',
        done: () => tut.did('Text'),
      },
      {
        title: 'Engrave it',
        text: 'The letters are selected. Click <b>Extrude</b> in the bar at the bottom (or press <kbd>E</kbd>) and type <kbd>-1</kbd> to cut them 1 mm deep. Press <kbd>Enter</kbd>.<br><small>A positive number raises them instead.</small>',
        place: 'top',
        done: () => tut.did('Extrude'),
      },
      finish('For text on round things, like a mug or a ball, use <b>Wrap & Emboss</b> in the Model tools.'),
    ],
  },
  {
    id: 'history',
    level: 3,
    minutes: 3,
    icon: 'history',
    title: 'Change it later with History',
    desc: 'Every step is kept. Change an old step and the design follows.',
    setup: (app) => box(app, 50, 40, 20),
    steps: (tut) => [
      {
        title: 'Change it later with History',
        text: 'ShaperBuild remembers how you made your design. You can go back to any step and change it.',
        place: 'center',
      },
      {
        title: 'Round an edge',
        text: 'Click an edge on top of the box, then <b>Fillet</b>. Type <kbd>2</kbd> and press <kbd>Enter</kbd>.',
        place: 'top',
        done: () => tut.did('Fillet') && tut.app.tools.isSelect,
      },
      {
        title: 'Open the History',
        text: 'Click <b>History</b> at the top of the list on the left (or press <kbd>Shift</kbd>+<kbd>H</kbd>).',
        target: () => document.querySelector('#items .items-tab[data-tab="history"]'),
        place: 'right',
        enter: () => {
          if (document.getElementById('items').classList.contains('collapsed')) tut.app.toggleItems();
        },
        done: () => tut.app.items.tab === 'history',
      },
      {
        title: 'Change the fillet',
        text: 'Click the <b>Fillet</b> step. Change its radius to <kbd>8</kbd> and press <kbd>Enter</kbd>. The edge is rebuilt.',
        target: () => document.getElementById('items'),
        place: 'right',
        done: () => tut.didMatch(/^Edit /),
      },
      finish('Drag the blue bar in the History list up to see the design as it was earlier. Right-click a step to turn it off or delete it.'),
    ],
  },
  {
    id: 'variables',
    level: 3,
    minutes: 4,
    icon: 'variable',
    title: 'Sizes with names (variables)',
    desc: 'Name a size once, use it everywhere and change it in one place.',
    steps: (tut) => {
      const doc = tut.app.doc;
      const named = () => doc.variables.filter((v) => !/^(length|angle|number)\d+$/.test(v.name));
      return [
        {
          title: 'Sizes with names (variables)',
          text: 'Give a size a name, like <b>width</b>, and type that name in any number field. Change the variable and everything that uses it follows.',
          place: 'center',
        },
        {
          title: 'Open the History',
          text: 'Variables are at the top of the <b>History</b> list. Click <b>History</b>.',
          target: () => document.querySelector('#items .items-tab[data-tab="history"]'),
          place: 'right',
          enter: () => {
            if (document.getElementById('items').classList.contains('collapsed')) tut.app.toggleItems();
          },
          done: () => tut.app.items.tab === 'history',
        },
        {
          title: 'Add a variable',
          text: 'Click the <b>+</b> next to <b>Variables</b> and pick <b>Length</b>.',
          target: () => document.querySelector('#items .vars-head'),
          place: 'right',
          done: () => doc.variables.length > 0,
        },
        {
          title: 'Name it and set it',
          text: 'Double-click its name and call it <kbd>width</kbd>. Set the value to <kbd>40</kbd> and press <kbd>Enter</kbd>.',
          target: () => document.querySelector('#items .var-row'),
          place: 'right',
          done: () => named().length > 0,
        },
        {
          title: 'Use it',
          text: 'Pick <b>Box</b> in the Shapes tools. In the panel, type the variable’s name (like <kbd>width</kbd>) as the <b>Width</b>, then click on the grid.<br><small>You can also type things like <kbd>width / 2</kbd>.</small>',
          target: tut.toolBtn('box'),
          place: 'left',
          enter: () => tut.openTool('box'),
          done: () => doc.state.history.some((f) => f.exprs && Object.values(f.exprs).some((e) => named().some((v) => String(e).includes(v.name)))),
        },
        {
          title: 'Change it once',
          text: 'Press <kbd>Esc</kbd>. Change the variable to <kbd>80</kbd> in the History list. The box follows.',
          target: () => document.querySelector('#items .var-row'),
          place: 'right',
          done: () => tut.did('Edit variable'),
        },
        finish('Variables work in sketch dimensions and tool panels too. Use them for sizes that must match, like a lid and its box.'),
      ];
    },
  },
  {
    id: 'visual',
    level: 3,
    minutes: 3,
    icon: 'camera',
    title: 'Materials, light and pictures',
    desc: 'Make your design look real and save a picture of it.',
    setup: (app) => box(app, 50, 50, 30),
    steps: (tut) => [
      {
        title: 'Materials, light and pictures',
        text: 'Show your design off: give it a material, set the light and save a picture.',
        place: 'center',
      },
      {
        title: 'Switch to Visualization',
        text: 'Click <b>Visualization</b> at the top.',
        target: () => document.querySelector('#mode-seg [data-mode="visual"]'),
        place: 'bottom',
        done: () => !!tut.app.visual,
      },
      {
        title: 'Pick a material',
        text: 'Click a material on the right, like <b>Walnut</b> or <b>Brushed metal</b>. Click a body first to change only that one.',
        target: () => document.getElementById('materials'),
        place: 'left',
        done: () => tut.did('Material'),
      },
      {
        title: 'Set the light',
        text: 'Scroll down to <b>Lighting</b> and drag <b>Light direction</b> to move the shadows.',
        target: () => document.getElementById('materials'),
        place: 'left',
        enter: () => (tut.light = JSON.stringify(tut.app.settings.lighting || null)),
        done: () => JSON.stringify(tut.app.settings.lighting || null) !== tut.light,
      },
      {
        title: 'Save a picture',
        text: 'Orbit to a nice angle, then click <b>Screenshot…</b> at the bottom of the panel to save a PNG.',
        target: () => document.querySelector('#materials [data-action="screenshot"]'),
        place: 'left',
      },
      finish('Click <b>Modeling</b> at the top to keep working on the design. Export a GLB file to show it in 3D on the web or in AR on a phone.'),
    ],
  },
  {
    id: 'print',
    level: 3,
    minutes: 2,
    icon: 'printer',
    title: 'Get ready to 3D print',
    desc: 'Check your part and save a file for your slicer.',
    setup: (app) => box(app, 40, 40, 15),
    steps: (tut) => [
      {
        title: 'Get ready to 3D print',
        text: 'ShaperBuild checks that your part can be printed and saves the file your printer’s slicer needs.',
        place: 'center',
      },
      {
        title: 'Open 3D Print',
        text: t('Click <b>3D Print</b> at the top (or press <kbd>{mod}P</kbd>).', { mod: modKey() }),
        target: () => document.getElementById('btn-print'),
        place: 'bottom',
        done: () => !!document.querySelector('.print-modal'),
      },
      {
        title: 'Read the checks',
        text: 'Green means fine. The list tells you if the part is not closed, too big for your printer, or has very thin walls.',
        target: () => document.querySelector('.print-modal'),
        place: 'right',
      },
      {
        title: 'Save the file',
        text: 'Pick your printer and <b>3MF</b> (or STL), then save. If your slicer is installed, ShaperBuild can open the file in it straight away.',
        target: () => document.querySelector('.print-modal'),
        place: 'right',
      },
      finish('Close the window when you are done. Tip: lay the flattest side of the part on the print bed.'),
    ],
  },
  {
    id: 'drawing',
    level: 3,
    minutes: 2,
    icon: 'file',
    title: '2D drawings for the workshop',
    desc: 'Make a drawing with views and sizes, as a PDF, SVG or DXF.',
    setup: (app) => box(app, 60, 40, 20),
    steps: (tut) => [
      {
        title: '2D drawings for the workshop',
        text: 'A drawing shows the part from the front, top and side with its sizes — handy for a workshop or a laser cutter.',
        place: 'center',
      },
      {
        title: 'Open the drawing',
        text: 'Click <b>Export</b> at the top and pick <b>2D drawing</b>.',
        target: () => document.getElementById('btn-export'),
        place: 'bottom',
        done: () => !!document.querySelector('.drawing-modal'),
      },
      {
        title: 'Choose what it shows',
        text: 'Turn views on or off, pick the scale and the paper size, and add a title. Sizes are added for you.',
        target: () => document.querySelector('.drawing-modal'),
        place: 'right',
      },
      finish('Save it as <b>PDF</b> to print, <b>SVG</b> for the web, or <b>DXF</b> for laser cutters and CNC machines.'),
    ],
  },
];

// The first lesson (also offered on the very first start).
function basicsSteps(tut) {
  const app = tut.app;
  const mac = isMac();
  const trackpad = app.vp.scrollMode === 'orbit';
  const doc = app.doc;
  return [
    {
      title: 'Welcome! Let’s build your first part',
      text: 'In a few short steps you will learn to move around, draw a sketch, turn it into a 3D body and round its edges.<br><br>Each step waits for you to try it. Use <b>Skip</b> if you already know it.',
      place: 'center',
    },
    {
      title: 'Orbit: turn the view',
      text: trackpad
        ? 'Swipe with <b>two fingers</b> on the trackpad, or hold the <b>right mouse button</b> and drag.<br><small>No mouse? Hold <kbd>Space</kbd> and drag, or press the arrow keys.</small>'
        : 'Hold the <b>right mouse button</b> and drag in the view.<br><small>On a laptop: hold <kbd>Space</kbd> and drag, or press the arrow keys.</small>',
      place: 'top',
      enter: () => (tut.navCount.orbit = 0),
      done: () => tut.navCount.orbit >= 6,
    },
    {
      title: 'Pan: slide the view',
      text: trackpad
        ? 'Hold <kbd>Shift</kbd> and swipe with two fingers, or drag with the <b>middle mouse button</b>.<br><small>Or hold <kbd>Shift</kbd>+<kbd>Space</kbd> and drag.</small>'
        : 'Drag with the <b>middle mouse button</b> (press the wheel), or hold <kbd>Shift</kbd> and right-drag.<br><small>Or hold <kbd>Shift</kbd>+<kbd>Space</kbd> and drag.</small>',
      place: 'top',
      enter: () => (tut.navCount.pan = 0),
      done: () => tut.navCount.pan >= 5,
    },
    {
      title: 'Zoom: get closer',
      text: trackpad ? '<b>Pinch</b> on the trackpad, or press <kbd>+</kbd> and <kbd>−</kbd>. It zooms towards your pointer.' : 'Turn the <b>scroll wheel</b> over the spot you want to see, or press <kbd>+</kbd> and <kbd>−</kbd>.',
      place: 'top',
      enter: () => (tut.navCount.zoom = 0),
      done: () => tut.navCount.zoom >= 3,
    },
    {
      title: 'Your view controls',
      text: 'These buttons help too: <b>Fit</b> shows everything (<kbd>Z</kbd>), <b>Views</b> jumps to top/front/right, and <b>Orbit</b> / <b>Pan</b> let you drag with the left button. Click the <b>cube</b> to face a side.<br><br>Hover a button to see what it does. The <b>mouse</b> button lists every control.',
      target: () => document.getElementById('view-controls'),
      place: 'left',
    },
    {
      title: 'All tools are on the right',
      text: t('Tools are grouped into <b>Sketch</b>, <b>Model</b>, <b>Transform</b>, <b>Shapes</b> and <b>Inspect</b>. Hover a tool to see what it does.<br><br>Can’t find something? Type in <b>Search tools</b> (<kbd>{mod}K</kbd>) — try “hole” or “round”.', { mod: modKey() }),
      target: () => document.getElementById('tools'),
      place: 'left',
    },
    {
      title: 'Pick the Rectangle tool',
      text: 'Click <b>Rectangle</b> in the Sketch tools, or press <kbd>R</kbd>.',
      target: tut.toolBtn('rect'),
      place: 'left',
      enter: () => tut.openTool('rect'),
      done: () => app.tools.activeId === 'rect',
    },
    {
      title: 'Draw a rectangle',
      text: 'Click on the grid for the first corner, move the pointer, and click again for the opposite corner.<br><small>For an exact size, type <kbd>40</kbd> <kbd>Tab</kbd> <kbd>30</kbd> <kbd>Enter</kbd> after the first click.</small>',
      place: 'top',
      done: () => doc.sketches.some((s) => s.entities.filter((e) => e.type === 'line').length >= 4),
    },
    {
      title: 'Finish the sketch',
      text: 'Press <kbd>Esc</kbd> (or the ✕ in the Rectangle panel) to put the tool away.',
      target: () => document.querySelector('#tool-panel:not([hidden])'),
      place: 'right',
      done: () => app.tools.isSelect,
    },
    {
      title: 'Select the shape',
      text: 'Click <b>inside</b> your rectangle. The shaded area is a <b>region</b> — a closed shape you can turn into 3D.',
      place: 'top',
      done: () => app.selection.list.some((it) => it.kind === 'region'),
    },
    {
      title: 'Extrude it',
      text: 'The bar at the bottom suggests tools for what you selected. Click <b>Extrude</b> (or press <kbd>E</kbd>).',
      target: tut.ctx('Extrude'),
      place: 'top',
      done: () => app.tools.activeId === 'extrude',
    },
    {
      title: 'Pull it up',
      text: 'Drag the <b>blue arrow</b> up, or type a height like <kbd>20</kbd>. Then press <kbd>Enter</kbd> or click <b>Done</b>.',
      place: 'top',
      enter: () => (tut.bodyCount = doc.bodies.length),
      done: () => doc.bodies.length > tut.bodyCount && app.tools.isSelect,
    },
    {
      title: 'Select an edge',
      text: 'Nice, that’s a 3D body! Now click one of the <b>edges</b> on its top (the lines around the faces).<br><small>Click more edges to add them. Click empty space to clear the selection.</small>',
      place: 'top',
      done: () => app.selection.list.some((it) => it.kind === 'edge'),
    },
    {
      title: 'Round it with Fillet',
      text: 'Click <b>Fillet</b> in the bar at the bottom (or press <kbd>F</kbd>).',
      target: tut.ctx('Fillet'),
      place: 'top',
      done: () => app.tools.activeId === 'fillet',
    },
    {
      title: 'Set the radius',
      text: 'Drag the arrow or type a radius like <kbd>3</kbd>, then press <kbd>Enter</kbd>.',
      place: 'top',
      enter: () => (tut.shapes = doc.bodies.map((b) => b.shapeId).join()),
      done: () => app.tools.isSelect && doc.bodies.map((b) => b.shapeId).join() !== tut.shapes,
    },
    {
      title: 'Everything you made',
      text: 'The <b>Items</b> list shows your bodies, meshes and sketches. Click the <b>eye</b> to hide one, double-click a name to rename it, right-click for more.<br><small>Show or hide this list with <kbd>Tab</kbd>.</small>',
      target: () => document.getElementById('items'),
      place: 'right',
      enter: () => {
        if (document.getElementById('items').classList.contains('collapsed')) app.toggleItems();
      },
    },
    {
      title: 'Ready to print',
      text: t('Click <b>3D Print</b> to check your part (closed shape, fits your printer) and save an STL or 3MF file — or open it straight in your slicer.<br><br>Made a mistake? <b>Undo</b> with <kbd>{mod}Z</kbd>. Save your design with <kbd>{mod}S</kbd>.', { mod: modKey() }),
      target: () => document.getElementById('btn-print'),
      place: 'bottom',
    },
    {
      title: 'You’re ready!',
      text: t('That’s the basics. A few more tips:<br>• Draw on any flat face of a body to add or cut shapes.<br>• Select a face and drag its arrow to push or pull it.<br>• {key}+K finds any tool. The <b>?</b> button has help and shortcuts.', { key: mac ? '⌘' : 'Ctrl' }),
      place: 'center',
      final: true,
    },
  ];
}
