// Base class for interactive tools.
export class Tool {
  constructor(app, def) {
    this.app = app;
    this.def = def;
  }

  get id() {
    return this.def.id;
  }

  // Pick kinds the viewport should consider while this tool is active.
  get pickKinds() {
    return [];
  }

  activate() {}
  deactivate() {}
  onPointerDown() {}
  onPointerMove() {}
  onPointerUp() {}
  onDblClick() {}
  onKeyDown() {
    return false;
  }
  onSelectionChange() {}
  onContextMenu() {
    return false;
  }

  // Items to highlight in addition to the selection: [{ item, color }]
  highlights() {
    return [];
  }

  // Shape ids the tool still needs (previews) so they are not freed.
  heldShapes() {
    return [];
  }

  setHint(html) {
    this.app.status.hint(html);
  }

  done() {
    this.app.tools.activate('select');
  }
}
