// Babel helpers and the async runtime use Function.prototype.bind. Old e-reader WebKit does not have it,
// and the polyfill plugin does not find calls in helper code. Thus this import is necessary.
import 'core-js/modules/es.function.bind.js';
import { Dashboard } from './app.js';

const boot = () => new Dashboard().start();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
