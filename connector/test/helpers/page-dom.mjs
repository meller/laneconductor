// A tiny fake DOM to run the static board page (connector/src/board-page.html) without a browser, with `fetch` stubbed.
// The same shape as the one inside board-page.test.mjs; this one is shared by tests that start from board.json data.
import fs from 'node:fs';

export const PAGE = new URL('../../src/board-page.html', import.meta.url).pathname;

let fakeDoc = null;
class TextNode {
  constructor(t) { this.nodeType = 3; this._text = String(t); }
  get textContent() { return this._text; }
}
export class El {
  constructor(tag) { this.tag = tag; this.nodeType = 1; this.children = []; this.className = ''; this.dataset = {}; this.style = {}; this.attrs = {}; this._text = ''; this.hidden = false; this.handlers = {}; this.scrollTop = 0; }
  appendChild(c) { this.children.push(c); return c; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(e, f) { this.handlers[e] = f; }
  focus() { if (fakeDoc) fakeDoc.activeElement = this; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
}

export const flush = () => new Promise((r) => setTimeout(r, 5));
export const walk = (e, fn) => { fn(e); for (const c of e.children ?? []) walk(c, fn); };
export const all = (e, pred) => { const out = []; walk(e, (x) => { if (pred(x)) out.push(x); }); return out; };
export const cls = (name) => (x) => String(x.className).split(' ').includes(name);
export const ev = (key, extra = {}) => ({ key, stopped: false, stopPropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; }, ...extra });

let restore = () => {};
/** Runs the page once against `fetchStub`; returns the element table (`ids`), with `ids.__doc` the fake document. Call `restorePage()` when done. */
export async function runPage(fetchStub) {
  restore();
  const html = fs.readFileSync(PAGE, 'utf8');
  const code = html.match(/<script>\n([\s\S]*?)<\/script>/)[1];
  const ids = {};
  const had = { document: globalThis.document, fetch: globalThis.fetch };
  restore = () => {
    globalThis.document = had.document;
    if (had.fetch === undefined) delete globalThis.fetch; else globalThis.fetch = had.fetch;
    restore = () => {};
  };
  const created = [];
  fakeDoc = { activeElement: null, handlers: {}, created, getElementById: (id) => (ids[id] ??= new El(`#${id}`)), createElement: (t) => { created.push(t); return new El(t); }, createTextNode: (t) => new TextNode(t), addEventListener(e, f) { this.handlers[e] = f; } };
  globalThis.document = fakeDoc;
  globalThis.fetch = fetchStub;
  new Function(code)();
  await flush();
  ids.__doc = fakeDoc;
  return ids;
}
export const restorePage = () => restore();

const stubs = [];
/** Replaces a global for the test (restored by `unstub`). */
export function stubGlobal(name, value) {
  const d = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  stubs.push(() => { if (d) Object.defineProperty(globalThis, name, d); else delete globalThis[name]; });
}
export const unstub = () => { while (stubs.length) stubs.pop()(); };
