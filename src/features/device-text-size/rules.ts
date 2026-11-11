/**
 * ADR 20260907-in-your-hands, slice 19d: use the device's body text size where
 * WebKit exposes it, without replacing DiveDay's font or lowering its floor.
 * `font: -apple-system-body` is a system-font shorthand, not a font family.
 * https://webkit.org/blog/3709/using-the-system-font-in-web-content/
 *
 * The parser executes this inline in <head>, before any body can paint. The
 * temporary, hidden probe is removed synchronously, even when a read fails.
 * The unmodified root is the browser default (globals.css sets no root size).
 * Never compound a larger browser default with the device request: take the
 * larger baseline, then express a needed increase relative to that default.
 * Normally 17 -> 16px and 34 -> 32px. Unsupported/default/smaller readings do nothing.
 * No UA sniffing, storage, network, hydration effect or font-family change.
 */
export function deviceTextSizeScript(): string {
  return '(function(){var p;try{if(!CSS.supports("font","-apple-system-body"))return;p=document.createElement("span");p.setAttribute("data-device-text-probe","");p.setAttribute("aria-hidden","true");p.style.cssText="all:initial;position:absolute;visibility:hidden;font:-apple-system-body";var r=document.documentElement;r.appendChild(p);var n=parseFloat(getComputedStyle(p).fontSize);var b=parseFloat(getComputedStyle(r).fontSize);var t=n/17*16;if(Number.isFinite(n)&&n>17&&Number.isFinite(b)&&b>0&&t>b){r.style.fontSize=(t/b*100)+"%";r.setAttribute("data-device-text-size","upward")}}catch(e){}finally{if(p)p.remove()}})()';
}
