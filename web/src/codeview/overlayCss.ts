// Styles of the overlay layer. They live inside the library's shadow root (passed as its `unsafeCSS`), so colours
// come from custom properties set on the page, which do cross the shadow boundary.
export const OVERLAY_CSS = `
/* The layer is a zero-size item at the end of the code element's flex row, so it scrolls with the code. The code
   element itself must not be made a positioned box: the library's virtualiser measures offsets through it. */
.xen-layer { position: relative; flex: none; align-self: flex-start; width: 0; height: 0; pointer-events: none; z-index: 2; }
.xen-mark { position: absolute; box-sizing: border-box; border-radius: 4px; }
.xen-mark[data-form="lines"] {
  background: var(--xen-spot-fill, rgb(250 204 21 / 0.18));
  border-left: 3px solid var(--xen-spot, rgb(234 179 8));
  border-radius: 0;
}
.xen-mark[data-form="box"] { border: 2px solid var(--xen-spot, rgb(234 179 8)); }
.xen-mark[data-form="circle"] { border: 2px solid var(--xen-spot, rgb(234 179 8)); border-radius: 50%; }
.xen-mark[data-open-top] { border-top-style: dashed; border-top-left-radius: 0; border-top-right-radius: 0; }
.xen-mark[data-open-bottom] { border-bottom-style: dashed; border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
.xen-caption {
  position: absolute; box-sizing: border-box; max-width: 26rem; padding: 0.5rem 0.75rem; border-radius: 6px;
  font: 13px/1.45 system-ui, sans-serif; white-space: normal;
  color: var(--xen-caption-fg, #111); background: var(--xen-caption-bg, #fffbe6);
  border: 1px solid var(--xen-spot, rgb(234 179 8)); box-shadow: 0 4px 16px rgb(0 0 0 / 0.18);
  opacity: 0; transition: opacity 150ms ease;
}
.xen-caption[data-shown] { opacity: 1; }
@media (prefers-reduced-motion: reduce) { .xen-caption { transition: none; } }
`
