// Renderer entry point.
import { App } from './app.js';

const app = new App();
window.__shaper = app; // handy for debugging and automated tests
app.start();
