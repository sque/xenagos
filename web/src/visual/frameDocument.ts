// The document a visual runs in (design decision 7; spec: section-visuals).
//
// The visual is agent-authored HTML. It runs in an iframe sandboxed with scripts only (no same origin, forms, popups
// or top navigation), so it cannot read or change the viewer. The document's first element is a content security
// policy that allows no connections and loads scripts only from inline code and the viewer's `/visual-assets/`, so a
// visual cannot reach the network; the viewer page itself forbids frame navigations (server: app.py). A visual talks
// to the viewer only by posting `link` and `select` messages naming an element, and receives `spotlight`.

import type { Visual } from '../generated/types'

/** Runs inside the frame before the visual's own code. Plain script: it is inlined into the document. */
const HELPER = String.raw`
(function () {
  var declared = [];
  var post = function (message) { parent.postMessage(Object.assign({ xenagos: 1 }, message), '*'); };
  window.addEventListener('error', function (event) { post({ type: 'error', message: String(event.message) }); });
  window.addEventListener('unhandledrejection', function (event) {
    post({ type: 'error', message: String(event.reason && event.reason.message || event.reason) });
  });
  function find(id) {
    var byId = document.getElementById(id);
    if (byId) return byId;
    var tagged = document.querySelector('[data-element="' + CSS.escape(id) + '"]');
    if (tagged) return tagged;
    // A Mermaid flowchart node: Mermaid names its group "flowchart-<id>-<n>", prefixed with the diagram's id in
    // Mermaid 12.
    var node = 'flowchart-' + CSS.escape(id) + '-';
    return document.querySelector('g[id^="' + node + '"], g[id*="-' + node + '"]');
  }
  function declaredAt(target) {
    for (var node = target; node && node !== document.body; node = node.parentElement) {
      for (var i = 0; i < declared.length; i++) if (find(declared[i].id) === node) return declared[i];
    }
    return null;
  }
  document.addEventListener('click', function (event) {
    var element = declaredAt(event.target);
    if (!element) return;
    event.preventDefault();
    var box = find(element.id).getBoundingClientRect();
    if (event.shiftKey || !element.linked) {
      post({ type: 'select', element: element.id, box: { left: box.left, top: box.top, right: box.right, bottom: box.bottom } });
    } else {
      post({ type: 'link', element: element.id });
    }
  });
  var marked = null;
  window.addEventListener('message', function (event) {
    if (event.source !== parent || !event.data || event.data.xenagos !== 1) return;
    if (event.data.type !== 'spotlight') return;
    if (marked) { marked.removeAttribute('data-xen-spot'); marked = null; }
    if (!event.data.element) return;
    marked = find(event.data.element);
    if (marked) {
      marked.setAttribute('data-xen-spot', event.data.form || 'box');
      marked.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  });
  window.xenagos = {
    link: function (id) { post({ type: 'link', element: String(id) }); },
    select: function (id) { post({ type: 'select', element: String(id) }); },
    start: function (elements) {
      declared = elements;
      var finish = function () {
        var missing = declared.filter(function (e) { return !find(e.id); }).map(function (e) { return e.id; });
        declared.forEach(function (e) { var node = find(e.id); if (node) node.setAttribute('data-xen-element', e.linked ? 'linked' : ''); });
        post({ type: 'ready', missing: missing, height: document.documentElement.scrollHeight });
      };
      if (!document.querySelector('.mermaid')) { finish(); return; }
      var script = document.createElement('script');
      script.src = window.xenagosAssets + 'mermaid.min.js';
      script.onload = function () {
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'default' });
        mermaid.run({ querySelector: '.mermaid' }).then(finish, function (error) {
          post({ type: 'error', message: 'Mermaid: ' + (error && error.message || error) });
        });
      };
      script.onerror = function () { post({ type: 'error', message: 'the Mermaid helper did not load' }); };
      document.head.appendChild(script);
    }
  };
})();
`

const STYLE = `
:root { color-scheme: light dark; }
body { margin: 0; padding: 12px; font: 14px/1.5 system-ui, sans-serif; }
[data-xen-element] { cursor: pointer; }
[data-xen-element="linked"]:hover { outline: 1px dashed rgb(234 179 8); outline-offset: 2px; }
[data-xen-spot] { outline: 3px solid rgb(234 179 8); outline-offset: 3px; }
[data-xen-spot="circle"] { border-radius: 50%; outline-offset: 6px; }
[data-xen-spot="lines"] { background: rgb(250 204 21 / 0.25); outline: none; }
`

/** The frame document for `visual`. `assets` is the absolute address of the viewer's `/visual-assets/` (the frame's
 * own origin is opaque, so a relative address would not resolve to the viewer). */
export function frameDocument(visual: Visual, assets: string): string {
  const policy = [
    "default-src 'none'",
    `script-src 'unsafe-inline' ${assets}`,
    "style-src 'unsafe-inline'",
    'img-src data: blob:',
    'font-src data:',
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ')
  const elements = (visual.elements ?? []).map((e) => ({ id: e.id, linked: e.link != null }))
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${policy}">
<style>${STYLE}</style>
<script>window.xenagosAssets = ${JSON.stringify(assets)};${HELPER}</script>
</head><body>
${visual.html}
<script>xenagos.start(${JSON.stringify(elements).replace(/</g, '\\u003c')})</script>
</body></html>`
}
