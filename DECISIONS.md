# Decisions

Where the Shapr3D-style specification leaves a gap, or where ShaperBuild
works differently on purpose, the choice is written down here.

## Languages

- English and Norwegian (bokmål). The language is chosen on the first
  start and changed in Settings; the window restarts and the open design
  stays as it was.
- Text in the code is English and is looked up when shown. Data in a
  design (history step names, undo labels) is stored in English, so a
  design looks right in either language. Names people type are never
  translated.
- Norwegian shows decimal commas. Typed numbers accept `12,5` and `12.5`.

## Numbers, expressions and variables

- Every number field takes an expression: `+ - * / ^ ( )`, units
  (`mm cm m in ft " '` and `deg rad °`), the functions from the spec with
  their aliases, `pi`, and variables.
- Plain numbers use the design's unit in length fields and degrees in angle
  fields. One unit at the very end of plain numbers applies to all of them
  (`10+5 mm` is 15 mm), as before.
- Trigonometry works in degrees, like every angle in the app:
  `sin(30)` is 0.5, `asin(0.5)` is 30°. `radians(x)` gives radians.
- Values carry their dimension: `area / length` is a length; a length
  plus an angle is an error; a length field refuses an area.
- Function arguments are separated with `,`, or with `;` when decimal
  commas are used (`max(1,5; 2)`).
- Imperial mixed numbers: `1 1/2"` and `1' 6"` work; the whole inches must
  be written (`0 1/2"`).
- Results are rounded to 1e-9 (the spec asks for 1e-8 tolerance).
- Variables belong to the design and are listed at the top of the History
  tab. Kinds: length, angle, number. Names follow the spec's rules and
  cannot be a unit or function name.
- A plain number typed for a length variable is stored with the unit
  (`20` becomes `20 mm`), so changing the design's unit later does not
  change the variable.
- Circular references are reported on the variables involved. A variable
  that something uses cannot be deleted; the message lists what uses it.
  Renaming a variable updates every formula that uses it.
- A value typed with a variable stays linked to it: tool values (kept in
  the history step), values changed in History, and sketch dimensions
  (shown with ƒ). When the variable changes, linked values are worked out
  again and the design is rebuilt. Changing the value another way (for
  example dragging the arrow) removes the link.

## Number fields

- Drag a field's name left or right to change the value (one step per
  6 pixels), or use − and +. A step is one unit of the design (1 mm, 1 in…),
  1° or 1; Shift makes it 10× bigger, Alt 10× smaller. Arrow keys do the
  same while typing.

## Keyboard shortcuts

- Two ready-made sets: **ShaperBuild** (the keys the app always had) and
  **Shapr3D style** (spec parts 4.1 and 4.2). Any key can be changed in
  Settings > Keyboard shortcuts, or as JSON. A key given to one action is
  taken away from the action that had it.
- Both sets: Ctrl+1–7 for the standard views, Ctrl+Shift+A clears the
  selection, Shift+letter adds sketch constraints (spec 4.2).
- Shapr3D style conflicts in the spec itself are resolved like this: E and
  F stay Extrude and Fillet; the face and edge filters are Shift+F and
  Shift+G, B selects bodies only, and Tab cycles the filter. While dragging
  a selection box, B, F, E and A switch the filter (as in Shapr3D).
  Ctrl+I is Intersect in that set (Import stays in the File menu), and
  Select Through is Ctrl+Shift+S (Save As stays in the File menu).
- Translate (N) has no key yet because there is no Translate tool yet.
- The native menus show the ShaperBuild keys.
- A short tap on Space over a flat face looks straight at it (spec "zoom
  to face"); holding Space and dragging still orbits.

## Selection

- Filters: all items, bodies only, faces only, edges only (status bar,
  Settings, keys). With "bodies only" a click on a face selects its body.
- Box selection: left to right selects what is fully inside, right to left
  everything the box touches (dashed green box). Touching a body means a
  point of its surface is inside the box, or the box lies on the body.
  With "faces only" the box selects faces.
- Select Through and overlapping items share one list: every face under
  the pointer, nearest first (at most 16), from the right-click menu or the
  Select Through key.
- "Show in Items" in the right-click menu scrolls Items to the selection.

## Snapping and grid

- The menu next to the Snap button turns each kind on or off: endpoints,
  midpoints, centres, intersections, body corners, points on curves,
  alignment guides, the grid, and the hint text.
- Intersection snapping covers straight lines (the spec's "linear sketch
  elements"); the first 300 lines of the sketch plane are checked.
- The status bar shows the grid size. Clicking it locks the grid at that
  size; clicking again lets it follow the zoom.

## Sketching

- Fully defined curves are drawn green: the constraints leave none of
  their values free (including moving or turning the whole sketch, so lock
  a point or dimension to it). Other curves keep the normal sketch colour
  instead of turning blue, so sketches without constraints look as before.
  Sketches with more than 800 values are not checked.
- Rectangle has a third mode, **3 points**: one side, then the height. It
  is held together by perpendicular and parallel constraints, not
  horizontal and vertical ones, so it can stay turned.
- Splines can be shaped by **control points** (cubic B-spline with uniform
  knots; open ones start and end on their first and last points, closed
  ones are periodic). The geometry engine builds the exact same curve.
- **Symmetric**: two points and a line, or two lines (or two circles) and
  the mirror line selected last. Two lines pair up their ends the way that
  is closest already; two circles also get the same size.
- **Unlock** removes a point's lock. **Disconnect** removes the
  constraints that tie curves together at a point. Curves whose ends touch
  still count as joined, so hold **Alt** and drag the point to pull one
  curve's end away.
- **Sketch pattern** copies curves in a row, a grid (a second direction at
  right angles) or around a point (the sketch origin unless a point is
  clicked). The copies are ordinary curves; there is no pattern constraint
  keeping them related.

## Construction planes and axes

- Plane types: Offset (as before), Midplane (between two flat things;
  halves the angle when they are not parallel), 3 points, Across a curve
  (at a percentage of the curve's length), Through a line (at an angle) and
  Parallel at a point. Planes are not history steps; they stay where they
  were made.
- Axes are a new item: through two points, where two planes meet, through
  a round face (cylinders and cones; or a circular edge), along an edge or
  line, or standing on a face. Revolve, Circular pattern, Linear pattern
  (as a direction), Rotate around axis and the plane tool can use them.
  They are not history steps either.

## Transform

- **Translate** moves bodies from one picked point to another. **Rotate
  around axis** turns them about an edge, line, axis or round face (the
  angle stays editable in History). **Align** puts a face, edge or corner of
  a body onto another: flat faces end up touching and centred, round faces
  and circular edges end up on the same axis (keeping their position along
  it), straight edges end up along each other. Translate and Align become
  ordinary Move steps (editable X/Y/Z and angles).
- Linear patterns take up to three directions (a grid); the distance can
  be the gap between copies or the total. Circular patterns can keep the
  copies' direction instead of turning them.
- Scale has an **X, Y and Z** type that stretches each direction on its
  own. The geometry engine used here has no way to stretch solids unevenly
  (no binding for it), so this works on meshes only; solids get a message.
  Scale can also make a copy.
- Copies made by transforms are independent bodies (no linked copies).
