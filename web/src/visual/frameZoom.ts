// Zoom for diagrams inside the visual frame (spec: section-visuals). A visual that draws a diagram is wrapped in a
// viewport that fits it to the frame and offers zoom buttons; any other visual is left alone. Plain script, inlined
// into the frame document after the helper; the viewer cannot reach into the frame, so this runs inside it.

/** Runs inside the frame after the helper. Plain script: it is inlined into the document. */
export const ZOOM = String.raw`
(function () {
  var MARGIN = 24, MIN = 0.1, MAX = 8, STEP = 1.25;
  var stage = null, viewport = null;
  var scale = 1, x = 0, y = 0, natural = { w: 0, h: 0 };
  var fitted = true;
  function apply() {
    stage.style.transform = 'translate(' + x + 'px, ' + y + 'px) scale(' + scale + ')';
  }
  function fit() {
    var W = window.innerWidth, H = window.innerHeight;
    scale = Math.min(1, (W - MARGIN) / natural.w, (H - MARGIN) / natural.h);
    x = (W - natural.w * scale) / 2;
    y = (H - natural.h * scale) / 2;
    fitted = true;
    apply();
  }
  function zoomBy(factor) {
    var next = Math.min(MAX, Math.max(MIN, scale * factor));
    var k = next / scale;
    var cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    x = cx - (cx - x) * k;
    y = cy - (cy - y) * k;
    scale = next;
    fitted = false;
    apply();
  }
  function button(which, label, text) {
    var b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('data-xen-zoom', which);
    b.setAttribute('aria-label', label);
    b.textContent = text;
    return b;
  }
  window.xenagosZoom = {
    attach: function () {
      if (stage) return true;
      if (!document.querySelector('.mermaid svg')) return false;
      viewport = document.createElement('div');
      viewport.className = 'xen-viewport';
      stage = document.createElement('div');
      stage.className = 'xen-stage';
      Array.prototype.slice.call(document.body.childNodes).forEach(function (node) {
        if (node.nodeType === 1 && node.tagName === 'SCRIPT') return;
        stage.appendChild(node);
      });
      viewport.appendChild(stage);
      var controls = document.createElement('div');
      controls.className = 'xen-zoom';
      controls.appendChild(button('out', 'Zoom out', '−'));
      controls.appendChild(button('fit', 'Fit', 'Fit'));
      controls.appendChild(button('in', 'Zoom in', '+'));
      controls.addEventListener('click', function (event) {
        var target = event.target && event.target.closest ? event.target.closest('[data-xen-zoom]') : null;
        if (!target) return;
        var which = target.getAttribute('data-xen-zoom');
        if (which === 'in') zoomBy(STEP);
        else if (which === 'out') zoomBy(1 / STEP);
        else fit();
      });
      document.body.classList.add('xen-zoomable');
      document.body.insertBefore(viewport, document.body.firstChild);
      document.body.appendChild(controls);
      natural = { w: stage.offsetWidth || 1, h: stage.offsetHeight || 1 };
      fit();
      window.addEventListener('resize', function () { if (fitted) fit(); });
      return true;
    },
    // Task 5 brings an element into view; for now the frame leaves the view as it is.
    reveal: function (element) {},
    view: function () { return stage ? { scale: scale, x: x, y: y } : null; }
  };
})();
`
