/*
 * Site analytics (track AM-10149, REQ-2): Google Analytics 4 through Google's own tag (gtag.js), started only after the
 * visitor presses Accept on a small notice. No build step, no dependencies. The plugins have no analytics; this is the site only.
 *
 * - GA_MEASUREMENT_ID empty (as committed): this script does nothing at all: no notice, no request, no storage, no listener.
 * - Before Accept nothing is loaded or stored. The only thing kept is the visitor's choice, in localStorage 'lc_consent'
 *   ('granted' or 'denied'), a first-party record that is named in the sentence in the footer of index.html (#analytics-note).
 * - Decline: gtag.js is never loaded.
 * - Accept: consent default (all four types denied) BEFORE config, then an update that grants analytics_storage only;
 *   ad_storage, ad_user_data and ad_personalization stay denied; Google signals and ad personalization signals off.
 * - Events (after Accept only): copy_install, github_click, comparison_click, wiki_click. Each carries the visitor's `src`
 *   (the ?src= tag of the link they came by, first-touch within the session, kept in sessionStorage only after Accept).
 *   `src` must be registered once as an event-scoped custom dimension in GA4 to appear in reports.
 * - Change of mind: the "change your choice" link in the footer note sets Google's ga-disable flag, withdraws analytics
 *   consent, clears the stored choice and the session tag, and shows the notice again.
 */
(function () {
  'use strict';

  const GA_MEASUREMENT_ID = '';

  var CONSENT_KEY = 'lc_consent';
  var SRC_KEY = 'lc_src';
  var ID = GA_MEASUREMENT_ID;
  if (!ID || !/^G-[A-Z0-9]+$/.test(ID)) return; // nothing visible, nothing sent, nothing stored

  var win = window;
  var doc = document;
  var started = false;
  var allowed = false; // true only between Accept and a later withdrawal

  function readChoice() {
    try { return win.localStorage.getItem(CONSENT_KEY); } catch (e) { return null; }
  }
  function writeChoice(v) {
    try { if (v) win.localStorage.setItem(CONSENT_KEY, v); else win.localStorage.removeItem(CONSENT_KEY); } catch (e) { /* storage blocked */ }
  }

  /* The visit's source tag: first touch within the session, short and plain, kept in sessionStorage (called only after Accept). */
  function readSrc() {
    try {
      var stored = win.sessionStorage.getItem(SRC_KEY);
      if (stored) return stored;
      var m = /[?&]src=([^&#]*)/.exec(String((win.location && win.location.search) || ''));
      var v = m ? decodeURIComponent(m[1]) : '';
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(v)) return '';
      win.sessionStorage.setItem(SRC_KEY, v);
      return v;
    } catch (e) { return ''; }
  }
  function clearSrc() {
    try { win.sessionStorage.removeItem(SRC_KEY); } catch (e) { /* ignore */ }
  }

  function gtag() { win.dataLayer.push(arguments); } // gtag must push the arguments object itself (Google's snippet)

  /* Only called after Accept (a stored 'granted' or the Accept button). The only place that talks to Google. */
  function start() {
    allowed = true;
    win['ga-disable-' + ID] = false;
    if (started) { // consent given again after a withdrawal: the tag is already on the page
      gtag('consent', 'update', { analytics_storage: 'granted' });
      return;
    }
    started = true;
    var src = readSrc();
    win.dataLayer = win.dataLayer || [];
    win.gtag = gtag;
    gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' });
    gtag('consent', 'update', { analytics_storage: 'granted' });
    gtag('js', new Date());
    var cfg = { allow_google_signals: false, allow_ad_personalization_signals: false };
    if (src) cfg.src = src;
    gtag('config', ID, cfg);
    var s = doc.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(ID);
    doc.head.appendChild(s);
  }

  function stop() {
    allowed = false;
    win['ga-disable-' + ID] = true; // Google's documented switch: stops all sending for this id
    if (!started) return; // the tag was never loaded in this page: nothing to withdraw, nothing to touch
    gtag('consent', 'update', { analytics_storage: 'denied' });
    clearSrc();
    try { // remove Google's own analytics cookies from this site (best effort)
      var names = String(doc.cookie || '').split(';');
      for (var i = 0; i < names.length; i++) {
        var n = names[i].split('=')[0].replace(/^\s+/, '');
        if (n.indexOf('_ga') === 0) {
          doc.cookie = n + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
          doc.cookie = n + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=' + win.location.hostname;
        }
      }
    } catch (e) { /* ignore */ }
  }

  function sendEvent(name) {
    if (!allowed || !win.gtag) return;
    var p = { transport_type: 'beacon' };
    var src = readSrc();
    if (src) p.src = src;
    win.gtag('event', name, p);
  }

  /* One delegated listener: which of the four events (if any) a click belongs to. */
  function classify(a, target) {
    if (target && target.closest && target.closest('#copy-btn')) return 'copy_install';
    if (!a) return '';
    var url;
    try { url = new URL(a.href, win.location.href); } catch (e) { return ''; }
    var host = url.hostname.replace(/^www\./, '').toLowerCase();
    var path = url.pathname.toLowerCase();
    if (host === 'github.com' && path.indexOf('/meller/laneconductor/blob/main/docs/why-laneconductor.md') === 0) return 'comparison_click';
    if (host === 'github.com' && (path === '/meller/laneconductor' || path.indexOf('/meller/laneconductor/') === 0)) return 'github_click';
    var raw = String(a.getAttribute('href') || '');
    var sameSite = host === 'laneconductor.com' || host === String(win.location.hostname || '').replace(/^www\./, '').toLowerCase();
    if (sameSite && path === '/wiki.html' && raw.charAt(0) !== '#') return 'wiki_click'; // not a same-page #anchor
    return '';
  }

  function onClick(ev) {
    if (!allowed) return;
    var t = ev.target;
    var a = t && t.closest ? t.closest('a[href]') : null;
    var name = classify(a, t);
    if (name) sendEvent(name);
  }

  /* The notice. Self-contained: inline styles set here, literal colours (the pages differ in their own style blocks). */
  var banner = null;
  function hideBanner() {
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    banner = null;
  }
  function showBanner() {
    if (banner || !doc.body) return;
    banner = doc.createElement('div');
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', 'Analytics notice');
    banner.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483000;max-width:640px;margin:0 auto;padding:12px 16px;' +
      'background:#111113;color:#f4f4f5;border:1px solid rgba(255,255,255,0.15);border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,0.5);' +
      'font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;';
    var text = doc.createElement('span');
    text.style.cssText = 'flex:1 1 260px;color:#a1a1aa;';
    text.appendChild(doc.createTextNode('May this site count page views and a few button clicks with Google Analytics? Nothing is sent unless you accept. '));
    var more = doc.createElement('a');
    more.href = '/#analytics-note';
    more.target = '_blank';
    more.rel = 'noopener';
    more.style.cssText = 'color:#22d3ee;text-decoration:underline;';
    more.appendChild(doc.createTextNode('What is counted'));
    text.appendChild(more);
    banner.appendChild(text);
    var btnCss = 'font:inherit;font-weight:600;color:#f4f4f5;background:#18181b;border:1px solid rgba(255,255,255,0.25);border-radius:8px;padding:6px 16px;cursor:pointer;';
    var accept = doc.createElement('button');
    accept.type = 'button';
    accept.style.cssText = btnCss;
    accept.appendChild(doc.createTextNode('Accept'));
    var decline = doc.createElement('button');
    decline.type = 'button';
    decline.style.cssText = btnCss;
    decline.appendChild(doc.createTextNode('Decline'));
    accept.addEventListener('click', function () { writeChoice('granted'); hideBanner(); start(); });
    decline.addEventListener('click', function () { writeChoice('denied'); hideBanner(); stop(); });
    banner.appendChild(accept);
    banner.appendChild(decline);
    doc.body.appendChild(banner);
  }

  function init() {
    // The footer sentence on index.html stays hidden until there is an id, so it only ever describes what the code does.
    var note = doc.getElementById && doc.getElementById('analytics-note');
    if (note) note.hidden = false;
    var change = doc.getElementById && doc.getElementById('analytics-choice');
    if (change) {
      change.addEventListener('click', function (ev) {
        if (ev.preventDefault) ev.preventDefault();
        writeChoice(null);
        stop();
        showBanner();
      });
    }
    doc.addEventListener('click', onClick, true);
    var choice = readChoice();
    if (choice === 'granted') start();
    else if (choice !== 'denied') showBanner();
  }

  init();
})();
