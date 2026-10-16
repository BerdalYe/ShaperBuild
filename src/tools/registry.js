// Every tool, its icon, shortcut and where it sits in the tools menu.
import { SelectTool } from './select.js';
import { LineTool, RectTool, CircleTool, ArcTool, PolygonTool, SplineTool, EllipseTool, PointTool } from './sketch.js';
import { TrimTool, OffsetTool, ProjectTool, toggleConstruction } from './sketchedit.js';
import { DimensionTool } from './dimension.js';
import { ExtrudeTool, RevolveTool, SweepTool, LoftTool, FilletTool, ChamferTool, ShellTool, DraftTool, UnionTool, SubtractTool, IntersectTool, SplitTool, MirrorTool, LinearPatternTool, CircularPatternTool, ScaleTool } from './model.js';
import { TransformTool } from './transform.js';
import { PrimitiveTool } from './primitive.js';
import { MeasureTool, SectionTool } from './inspect.js';

const def = (id, label, icon, Tool, extra = {}) => ({ id, label, icon, Tool, ...extra });

export const TOOL_SECTIONS = [
  {
    title: 'Sketch',
    subtitle: 'Draw 2D shapes',
    tools: [
      def('line', 'Line', 'line', LineTool, { key: 'L', keywords: 'polyline segment draw', desc: 'Draw connected straight lines. Click the first point again to close the shape.' }),
      def('rect', 'Rectangle', 'rect', RectTool, { key: 'R', keywords: 'square box draw', desc: 'Draw a rectangle from a corner or its center.' }),
      def('circle', 'Circle', 'circle', CircleTool, { key: 'C', keywords: 'hole diameter disc draw', desc: 'Click the center, then the size.' }),
      def('arc', 'Arc', 'arc', ArcTool, { key: 'A', keywords: 'curve bend draw', desc: 'Three-point or center arc.' }),
      def('polygon', 'Polygon', 'polygon', PolygonTool, { key: 'P', keywords: 'hexagon triangle sides nut draw', desc: 'Regular polygon with any number of sides.' }),
      def('spline', 'Spline', 'spline', SplineTool, { key: 'B', keywords: 'curve freeform bezier draw', desc: 'Smooth curve through the points you click.' }),
      def('ellipse', 'Ellipse', 'ellipse', EllipseTool, { keywords: 'oval draw', desc: 'Center, axis, then width.' }),
      def('point', 'Point', 'point', PointTool, { keywords: 'reference', desc: 'Reference point for snapping.' }),
      def('trim', 'Trim', 'trim', TrimTool, { key: 'T', keywords: 'cut erase remove delete segment', desc: 'Remove pieces of curves between intersections.' }),
      def('offset', 'Offset', 'offset', OffsetTool, { keywords: 'parallel copy wall thickness', desc: 'Copy curves at a distance.' }),
      def('project', 'Project', 'project', ProjectTool, { keywords: 'edges copy include reference', desc: 'Copy body edges into a sketch.' }),
      def('dimension', 'Dimension', 'dimension', DimensionTool, { key: 'D', keywords: 'constraint size length angle parallel tangent', desc: 'Add sizes that drive the sketch. Select curves to add constraints like parallel or tangent.' }),
      { id: 'construction', label: 'Construction', short: 'Construct', keywords: 'reference helper line', icon: 'construction', action: (app) => toggleConstruction(app), desc: 'Turn selected curves into construction geometry (ignored for profiles).' },
    ],
  },
  {
    title: 'Model',
    subtitle: 'Make and change bodies',
    tools: [
      def('extrude', 'Extrude', 'extrude', ExtrudeTool, { key: 'E', keywords: 'push pull pad height thicken 3d', desc: 'Pull a sketch region or face into 3D. Also pushes and pulls faces of bodies.' }),
      def('revolve', 'Revolve', 'revolve', RevolveTool, { key: 'Q', keywords: 'spin lathe turn rotate profile', desc: 'Spin a profile around an axis.' }),
      def('sweep', 'Sweep', 'sweep', SweepTool, { keywords: 'path pipe tube', desc: 'Move a profile along a path.' }),
      def('loft', 'Loft', 'loft', LoftTool, { keywords: 'blend transition profiles', desc: 'Blend between two or more profiles.' }),
      def('fillet', 'Fillet', 'fillet', FilletTool, { key: 'F', keywords: 'round radius smooth edge', desc: 'Round edges.' }),
      def('chamfer', 'Chamfer', 'chamfer', ChamferTool, { keywords: 'bevel edge', desc: 'Bevel edges.' }),
      def('shell', 'Shell', 'shell', ShellTool, { key: 'H', keywords: 'hollow wall thickness', desc: 'Hollow out a body, leaving walls.' }),
      def('draft', 'Draft', 'draft', DraftTool, { keywords: 'taper angle mould mold', desc: 'Tilt side faces by an angle (for moulds and easy printing).' }),
      def('split', 'Split', 'split', SplitTool, { keywords: 'cut divide slice', desc: 'Cut a body in two with a plane or face.' }),
      def('union', 'Union', 'union', UnionTool, { key: 'U', keywords: 'join combine merge add boolean', desc: 'Join bodies into one.' }),
      def('subtract', 'Subtract', 'subtract', SubtractTool, { keywords: 'cut difference remove hole boolean', desc: 'Cut bodies out of another.' }),
      def('intersect', 'Intersect', 'intersect', IntersectTool, { keywords: 'common overlap boolean', desc: 'Keep only the overlap.' }),
    ],
  },
  {
    title: 'Transform',
    subtitle: 'Move, copy, resize',
    tools: [
      def('move', 'Move / Rotate', 'move', TransformTool, { key: 'M', short: 'Move', keywords: 'rotate translate position turn align', desc: 'Move and rotate bodies and sketches.' }),
      def('scale', 'Scale', 'scale', ScaleTool, { keywords: 'resize size bigger smaller', desc: 'Resize bodies uniformly.' }),
      def('mirror', 'Mirror', 'mirror', MirrorTool, { keywords: 'flip symmetric reflect', desc: 'Mirror bodies across a plane.' }),
      def('patternLinear', 'Linear pattern', 'patternLinear', LinearPatternTool, { short: 'Linear Pattern', keywords: 'array copies repeat row grid', desc: 'Copies in a row.' }),
      def('patternCircular', 'Circular pattern', 'patternCircular', CircularPatternTool, { short: 'Circular Pattern', keywords: 'array copies repeat around radial polar', desc: 'Copies around an axis.' }),
    ],
  },
  {
    title: 'Shapes',
    subtitle: 'Ready-made bodies',
    tools: [
      def('box', 'Box', 'box', PrimitiveTool, { keywords: 'cube block primitive', shape: 'box', desc: 'Add a box.' }),
      def('cylinder', 'Cylinder', 'cylinder', PrimitiveTool, { keywords: 'rod tube primitive', shape: 'cylinder', desc: 'Add a cylinder.' }),
      def('sphere', 'Sphere', 'sphere', PrimitiveTool, { keywords: 'ball primitive', shape: 'sphere', desc: 'Add a sphere.' }),
      def('cone', 'Cone', 'cone', PrimitiveTool, { keywords: 'pyramid primitive', shape: 'cone', desc: 'Add a cone.' }),
      def('torus', 'Torus', 'torus', PrimitiveTool, { keywords: 'ring donut primitive', shape: 'torus', desc: 'Add a torus (ring).' }),
    ],
  },
  {
    title: 'Inspect',
    subtitle: 'Measure and look inside',
    tools: [
      def('measure', 'Measure', 'measure', MeasureTool, { key: 'K', keywords: 'distance size length area volume angle inspect', desc: 'Lengths, areas, volumes, distances and angles.' }),
      def('section', 'Section view', 'section', SectionTool, { key: 'X', short: 'Section', keywords: 'cut clip inside cross', desc: 'Cut through the design to look inside.' }),
      { id: 'convert', label: 'Mesh → Solid', keywords: 'stl obj convert editable', icon: 'convert', action: (app) => app.cmd.convertToSolid(), desc: 'Turn selected STL/OBJ meshes into editable solids.' },
    ],
  },
];

export const TOOLS = { select: def('select', 'Select', 'select', SelectTool) };
for (const s of TOOL_SECTIONS) for (const t of s.tools) TOOLS[t.id] = t;

// Single-key shortcuts.
export const TOOL_KEYS = {};
for (const t of Object.values(TOOLS)) if (t.key) TOOL_KEYS[t.key.toLowerCase()] = t.id;
