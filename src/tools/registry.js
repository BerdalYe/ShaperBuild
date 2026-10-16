// Every tool, its icon, shortcut and where it sits in the tools menu.
import { SelectTool } from './select.js';
import { LineTool, RectTool, CircleTool, ArcTool, PolygonTool, SplineTool, EllipseTool, PointTool } from './sketch.js';
import { TrimTool, OffsetTool, toggleConstruction } from './sketchedit.js';
import { ExtrudeTool, RevolveTool, SweepTool, LoftTool, FilletTool, ChamferTool, ShellTool, UnionTool, SubtractTool, IntersectTool, SplitTool, MirrorTool, LinearPatternTool, CircularPatternTool, ScaleTool } from './model.js';
import { TransformTool } from './transform.js';
import { PrimitiveTool } from './primitive.js';
import { MeasureTool, SectionTool } from './inspect.js';

const def = (id, label, icon, Tool, extra = {}) => ({ id, label, icon, Tool, ...extra });

export const TOOL_SECTIONS = [
  {
    title: 'Sketch',
    tools: [
      def('line', 'Line', 'line', LineTool, { key: 'L', desc: 'Draw connected straight lines. Click the first point again to close the shape.' }),
      def('rect', 'Rectangle', 'rect', RectTool, { key: 'R', desc: 'Draw a rectangle from a corner or its center.' }),
      def('circle', 'Circle', 'circle', CircleTool, { key: 'C', desc: 'Click the center, then the size.' }),
      def('arc', 'Arc', 'arc', ArcTool, { key: 'A', desc: 'Three-point or center arc.' }),
      def('polygon', 'Polygon', 'polygon', PolygonTool, { key: 'P', desc: 'Regular polygon with any number of sides.' }),
      def('spline', 'Spline', 'spline', SplineTool, { key: 'B', desc: 'Smooth curve through the points you click.' }),
      def('ellipse', 'Ellipse', 'ellipse', EllipseTool, { desc: 'Center, axis, then width.' }),
      def('point', 'Point', 'point', PointTool, { desc: 'Reference point for snapping.' }),
      def('trim', 'Trim', 'trim', TrimTool, { key: 'T', desc: 'Remove pieces of curves between intersections.' }),
      def('offset', 'Offset', 'offset', OffsetTool, { desc: 'Copy curves at a distance.' }),
      { id: 'construction', label: 'Construction', icon: 'construction', action: (app) => toggleConstruction(app), desc: 'Turn selected curves into construction geometry (ignored for profiles).' },
    ],
  },
  {
    title: 'Model',
    tools: [
      def('extrude', 'Extrude', 'extrude', ExtrudeTool, { key: 'E', desc: 'Pull a sketch region or face into 3D. Also pushes and pulls faces of bodies.' }),
      def('revolve', 'Revolve', 'revolve', RevolveTool, { key: 'Q', desc: 'Spin a profile around an axis.' }),
      def('sweep', 'Sweep', 'sweep', SweepTool, { desc: 'Move a profile along a path.' }),
      def('loft', 'Loft', 'loft', LoftTool, { desc: 'Blend between two or more profiles.' }),
      def('fillet', 'Fillet', 'fillet', FilletTool, { key: 'F', desc: 'Round edges.' }),
      def('chamfer', 'Chamfer', 'chamfer', ChamferTool, { desc: 'Bevel edges.' }),
      def('shell', 'Shell', 'shell', ShellTool, { key: 'H', desc: 'Hollow out a body, leaving walls.' }),
      def('split', 'Split', 'split', SplitTool, { desc: 'Cut a body in two with a plane or face.' }),
      def('union', 'Union', 'union', UnionTool, { key: 'U', desc: 'Join bodies into one.' }),
      def('subtract', 'Subtract', 'subtract', SubtractTool, { desc: 'Cut bodies out of another.' }),
      def('intersect', 'Intersect', 'intersect', IntersectTool, { desc: 'Keep only the overlap.' }),
    ],
  },
  {
    title: 'Transform',
    tools: [
      def('move', 'Move / Rotate', 'move', TransformTool, { key: 'M', desc: 'Move and rotate bodies and sketches.' }),
      def('scale', 'Scale', 'scale', ScaleTool, { desc: 'Resize bodies uniformly.' }),
      def('mirror', 'Mirror', 'mirror', MirrorTool, { desc: 'Mirror bodies across a plane.' }),
      def('patternLinear', 'Linear pattern', 'patternLinear', LinearPatternTool, { desc: 'Copies in a row.' }),
      def('patternCircular', 'Circular pattern', 'patternCircular', CircularPatternTool, { desc: 'Copies around an axis.' }),
    ],
  },
  {
    title: 'Shapes',
    tools: [
      def('box', 'Box', 'box', PrimitiveTool, { shape: 'box', desc: 'Add a box.' }),
      def('cylinder', 'Cylinder', 'cylinder', PrimitiveTool, { shape: 'cylinder', desc: 'Add a cylinder.' }),
      def('sphere', 'Sphere', 'sphere', PrimitiveTool, { shape: 'sphere', desc: 'Add a sphere.' }),
      def('cone', 'Cone', 'cone', PrimitiveTool, { shape: 'cone', desc: 'Add a cone.' }),
      def('torus', 'Torus', 'torus', PrimitiveTool, { shape: 'torus', desc: 'Add a torus (ring).' }),
    ],
  },
  {
    title: 'Inspect',
    tools: [
      def('measure', 'Measure', 'measure', MeasureTool, { key: 'K', desc: 'Lengths, areas, volumes, distances and angles.' }),
      def('section', 'Section view', 'section', SectionTool, { key: 'X', desc: 'Cut through the design to look inside.' }),
      { id: 'convert', label: 'Mesh → Solid', icon: 'convert', action: (app) => app.cmd.convertToSolid(), desc: 'Turn selected STL/OBJ meshes into editable solids.' },
    ],
  },
];

export const TOOLS = { select: def('select', 'Select', 'select', SelectTool) };
for (const s of TOOL_SECTIONS) for (const t of s.tools) TOOLS[t.id] = t;

// Single-key shortcuts.
export const TOOL_KEYS = {};
for (const t of Object.values(TOOLS)) if (t.key) TOOL_KEYS[t.key.toLowerCase()] = t.id;
