// Track AM-10149 tasks 2.2 and 2.3: the site's Google Analytics 4 script (landing/analytics.js) and the footer sentence.
// Static: no server, no network, no child processes. The script is evaluated in a minimal fake window and document (node:vm),
// never against a real browser, so a pass here is "the code behaves as written", not "Google receives a visit" (task 2.6).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const landing = path.resolve(import.meta.dirname, '..', '..', 'landing');
const read = (f) => fs.readFileSync(path.join(landing, f), 'utf8');
const SRC = read('analytics.js');
const FAKE_ID = 'G-TEST123456';
const PAGES = ['index.html', 'wiki.html', 'posts/index.html', 'posts/stop-guessing-what-your-agent-is-doing.html', 'posts/the-ai-engineer-and-the-jevons-paradox.html'];

/** Minimal browser: just what analytics.js touches. `stored` seeds localStorage; `search` is the page's query string. */
function fakeBrowser({ id = '', stored = null, search = '', pathname = '/', withNote = true } = {}) {
  const code = SRC.replace(/const GA_MEASUREMENT_ID = '[^']*';/, `const GA_MEASUREMENT_ID = '${id}';`);
  assert.match(code, new RegExp(`const GA_MEASUREMENT_ID = '${id}';`), 'the id substitution happened (else the id cases would pass vacuously)');
  const writes = [];
  const store = (seed) => {
    const m = new Map(Object.entries(seed || {}));
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => { writes.push(['set', k, v]); m.set(k, String(v)); },
      removeItem: (k) => { writes.push(['remove', k]); m.delete(k); },
    };
  };
  const make = (tag) => ({
    tagName: tag, children: [], attrs: {}, style: {}, listeners: {}, parentNode: null, hidden: false, text: '',
    setAttribute(k, v) { this.attrs[k] = v; },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; },
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
    click() { for (const fn of this.listeners.click || []) fn({ target: this, preventDefault() {} }); },
  });
  const body = make('body');
  const head = make('head');
  const note = make('p'); note.hidden = true;
  const change = make('a');
  const docListeners = {};
  const document = {
    head, body, cookie: '',
    createElement: make,
    createTextNode: (text) => ({ nodeType: 3, text }),
    getElementById: (i) => (withNote ? { 'analytics-note': note, 'analytics-choice': change }[i] || null : null),
    addEventListener: (t, fn, cap) => { (docListeners[t] = docListeners[t] || []).push({ fn, cap }); },
  };
  const sandbox = {
    document, URL, encodeURIComponent, decodeURIComponent,
    localStorage: store(stored ? { lc_consent: stored } : {}),
    sessionStorage: store({}),
    location: { search, pathname, hostname: 'laneconductor.com', href: `https://laneconductor.com${pathname}${search}` },
  };
  sandbox.window = sandbox;
  vm.runInNewContext(code, sandbox);
  const layer = () => JSON.parse(JSON.stringify((sandbox.dataLayer || []).map((e) => Array.from(e))));
  const scripts = () => head.children.filter((c) => c.tagName === 'script');
  const allNodes = (n) => [n, ...(n.children || []).flatMap(allNodes)];
  const buttons = () => allNodes(body).filter((n) => n.tagName === 'button');
  /** A click on `href` (an anchor) or on the copy button (copy: true). */
  const click = ({ href, rawHref = href, copy = false }) => {
    const a = href ? { href, getAttribute: () => rawHref } : null;
    const target = { closest: (sel) => (sel === '#copy-btn' ? (copy ? {} : null) : sel === 'a[href]' ? a : null) };
    for (const l of docListeners.click || []) l.fn({ target });
  };
  return { sandbox, document, writes, layer, scripts, buttons, click, docListeners, note, change, body };
}
const events = (b) => b.layer().filter((e) => e[0] === 'event').map((e) => [e[1], e[2]]);

test('analytics.js exists, is loaded by all five pages, and carries the measurement id of the property', () => {
  assert.ok(fs.existsSync(path.join(landing, 'analytics.js')));
  for (const p of PAGES) assert.ok(read(p).includes('<script src="/analytics.js" defer></script>'), `${p} loads /analytics.js`);
  assert.match(SRC, /const GA_MEASUREMENT_ID = 'G-B9TZ5RYLP4';/, 'the id of the property LaneConductor site (task 2.1, a public value)');
});

test('analytics.js never grants advertising consent, turns Google signals off, and has no dependencies', () => {
  assert.ok(!/(ad_storage|ad_user_data|ad_personalization)\s*['"]?\s*:\s*['"]granted/.test(SRC), 'no advertising grant');
  assert.match(SRC, /allow_google_signals:\s*false/);
  assert.match(SRC, /allow_ad_personalization_signals:\s*false/);
  assert.match(SRC, /analytics_storage:\s*'granted'/);
  // the default (all four denied) is declared before config
  const iDefault = SRC.indexOf("gtag('consent', 'default'");
  const iUpdate = SRC.indexOf("gtag('consent', 'update', { analytics_storage: 'granted' })", iDefault);
  assert.ok(iDefault > 0 && iUpdate > iDefault && SRC.indexOf("gtag('config'") > iUpdate);
  assert.match(SRC, /consent', 'default', \{ ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' \}/);
  assert.ok(!/\bimport\b|\brequire\(/.test(SRC));
  assert.ok(!/doNotTrack/i.test(SRC), 'Do Not Track is not part of this track');
});

test('every call to Google is behind the consent check: the tag URL is built in start(), which only a stored grant or the Accept button calls', () => {
  assert.equal((SRC.match(/googletagmanager\.com/g) || []).length, 1, 'one place builds the tag URL');
  const startBody = SRC.slice(SRC.indexOf('function start()'), SRC.indexOf('function stop()'));
  assert.ok(startBody.includes('googletagmanager.com') && startBody.includes("gtag('config'"));
  const callers = [...SRC.matchAll(/\bstart\(\)/g)].length; // definition + two calls
  assert.equal(callers, 3);
  assert.match(SRC, /accept\.addEventListener\('click', function \(\) \{ writeChoice\('granted'\); hideBanner\(\); start\(\); \}\)/);
  assert.match(SRC, /if \(choice === 'granted'\) start\(\);/);
  // events and the delegated listener check consent; gtag( outside start/stop is only inside sendEvent, after the `allowed` check
  assert.match(SRC, /function sendEvent\(name\) \{\s*if \(!allowed \|\| !win\.gtag\) return;/);
  assert.match(SRC, /function onClick\(ev\) \{\s*if \(!allowed\) return;/);
  assert.ok(SRC.indexOf("var ID = GA_MEASUREMENT_ID;") < SRC.indexOf('if (!ID'), 'the empty-id guard comes before any other work');
});

test('index.html: the footer sentence names what is counted, matches the code, and the notice links to it', () => {
  const html = read('index.html');
  const m = /<p id="analytics-note"([^>]*)>([\s\S]*?)<\/p>/.exec(html);
  assert.ok(m, 'footer sentence with id analytics-note');
  assert.match(m[1], /\bhidden\b/, 'hidden until the script has an id, so it only describes live behaviour');
  const text = m[2].replace(/<[^>]+>/g, '');
  for (const s of ['If you accept', 'Google Analytics', 'page views', 'copy the install command', 'GitHub', 'the comparison', 'the docs', 'the ?src tag', 'advertising features are off', 'lc_consent', 'in this browser']) {
    assert.ok(text.includes(s), `the sentence says: ${s}`);
  }
  assert.ok(html.includes('id="analytics-choice"'), 'the change-your-choice link is inside the sentence');
  assert.ok(html.indexOf('id="analytics-note"') > html.indexOf('<footer>') && html.indexOf('id="analytics-note"') < html.indexOf('</footer>'), 'in the footer');
  assert.ok(SRC.includes("'/#analytics-note'"), 'the notice links to it');
  assert.match(SRC, /'lc_consent'/);
  // the four events the sentence names are the four the code sends
  for (const e of ['copy_install', 'github_click', 'comparison_click', 'wiki_click']) assert.ok(SRC.includes(`'${e}'`), e);
});

test('empty id: the script does nothing (no notice, no listener, no storage write, no script element)', () => {
  const b = fakeBrowser({ id: '', stored: 'granted' });
  assert.equal(b.body.children.length, 0);
  assert.equal(b.scripts().length, 0);
  assert.deepEqual(b.writes, []);
  assert.deepEqual(b.docListeners, {});
  assert.equal(b.sandbox.dataLayer, undefined);
  assert.equal(b.note.hidden, true, 'the footer sentence stays hidden');
});

test('id set and a stored Decline: nothing is added, loaded or stored; clicks are ignored', () => {
  const b = fakeBrowser({ id: FAKE_ID, stored: 'denied', search: '?src=post-9' });
  assert.equal(b.scripts().length, 0, 'no script element');
  assert.equal(b.body.children.length, 0, 'no notice');
  assert.deepEqual(b.writes, [], 'nothing stored (not even the source tag)');
  assert.equal(b.sandbox.dataLayer, undefined);
  b.click({ href: 'https://github.com/meller/laneconductor' });
  assert.equal(b.sandbox.dataLayer, undefined);
});

test('id set and no choice yet: the notice shows two equal buttons and nothing is loaded or stored; Decline never loads the tag', () => {
  const b = fakeBrowser({ id: FAKE_ID, search: '?src=post-9' });
  assert.equal(b.note.hidden, false, 'footer sentence shown once there is an id');
  assert.equal(b.scripts().length, 0);
  assert.deepEqual(b.writes, []);
  assert.equal(b.sandbox.dataLayer, undefined);
  const [accept, decline] = b.buttons();
  assert.deepEqual([accept.children[0].text, decline.children[0].text], ['Accept', 'Decline']);
  assert.equal(accept.style.cssText, decline.style.cssText, 'equal weight');
  b.click({ copy: true });
  assert.equal(b.sandbox.dataLayer, undefined, 'a click before Accept sends nothing');
  decline.click();
  assert.deepEqual(b.writes, [['set', 'lc_consent', 'denied']], 'only the choice is stored');
  assert.equal(b.scripts().length, 0);
  assert.equal(b.body.children.length, 0, 'notice gone');
  b.click({ copy: true });
  assert.equal(b.sandbox.dataLayer, undefined);
});

test('Accept: consent default (all denied) precedes config, analytics_storage alone is granted, signals off, src on page_view config', () => {
  const b = fakeBrowser({ id: FAKE_ID, search: '?src=post-9' });
  b.buttons()[0].click();
  assert.equal(b.scripts().length, 1);
  assert.equal(b.scripts()[0].src, `https://www.googletagmanager.com/gtag/js?id=${FAKE_ID}`);
  const l = b.layer();
  assert.deepEqual(l[0], ['consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' }]);
  assert.deepEqual(l[1], ['consent', 'update', { analytics_storage: 'granted' }]);
  assert.equal(l[2][0], 'js');
  assert.deepEqual(l[3], ['config', FAKE_ID, { allow_google_signals: false, allow_ad_personalization_signals: false, src: 'post-9' }]);
  assert.deepEqual(b.writes.map((w) => w.slice(0, 3)), [['set', 'lc_consent', 'granted'], ['set', 'lc_src', 'post-9']]);
});

test('after Accept: the four events, one each, with src; the comparison link is not also a GitHub click; other links are ignored', () => {
  const b = fakeBrowser({ id: FAKE_ID, stored: 'granted', search: '?src=post-11' });
  assert.equal(b.scripts().length, 1, 'a stored grant starts the tag on load');
  b.click({ copy: true });
  b.click({ href: 'https://github.com/meller/laneconductor' });
  b.click({ href: 'https://github.com/meller/laneconductor/blob/main/docs/why-laneconductor.md' });
  b.click({ href: 'https://laneconductor.com/wiki.html' , rawHref: 'wiki.html#installation' });
  b.click({ href: 'https://laneconductor.com/wiki.html', rawHref: '/wiki.html' });
  b.click({ href: 'https://github.com/meller/tokentalos' });
  b.click({ href: 'https://laneconductor.com/#features', rawHref: '#features' });
  b.click({ href: 'https://laneconductor.com/wiki.html#x', rawHref: '#x' }); // same-page anchor
  b.click({ href: 'https://example.com/' });
  const p = { transport_type: 'beacon', src: 'post-11' };
  assert.deepEqual(events(b), [['copy_install', p], ['github_click', p], ['comparison_click', p], ['wiki_click', p], ['wiki_click', p]]);
});

test('src: only a short plain tag is kept; without one, events carry no src', () => {
  const bad = fakeBrowser({ id: FAKE_ID, stored: 'granted', search: '?src=<script>alert(1)</script>' });
  assert.ok(!bad.layer().some((e) => e[0] === 'config' && 'src' in e[2]));
  const none = fakeBrowser({ id: FAKE_ID, stored: 'granted', search: '' });
  none.click({ copy: true });
  assert.deepEqual(events(none), [['copy_install', { transport_type: 'beacon' }]]);
});

test('change your choice: sending stops (ga-disable), the stored choice and source tag are cleared, the notice returns; Accept again resumes', () => {
  const b = fakeBrowser({ id: FAKE_ID, stored: 'granted', search: '?src=post-9' });
  b.click({ copy: true });
  assert.equal(events(b).length, 1);
  b.change.click();
  assert.equal(b.sandbox[`ga-disable-${FAKE_ID}`], true);
  assert.deepEqual(b.writes.slice(-2).map((w) => w.slice(0, 2)), [['remove', 'lc_consent'], ['remove', 'lc_src']]);
  assert.deepEqual(b.layer().at(-1), ['consent', 'update', { analytics_storage: 'denied' }]);
  assert.equal(b.buttons().length, 2, 'notice shown again');
  b.click({ copy: true });
  assert.equal(events(b).length, 1, 'no event after the withdrawal');
  b.buttons()[0].click();
  assert.equal(b.sandbox[`ga-disable-${FAKE_ID}`], false);
  assert.equal(b.scripts().length, 1, 'the tag is not loaded twice');
  b.click({ copy: true });
  assert.equal(events(b).length, 2);
});
