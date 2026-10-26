/** Required authored markup: fail at setup rather than dereference missing controls later. */
/** @template {HTMLElement} T @param {string} id @param {{new(): T}} kind @returns {T} */
export function element(id, kind) {
  const node = document.getElementById(id);
  if (!(node instanceof kind)) throw new Error(`Missing ${kind.name} #${id}`);
  return node;
}
/** @param {HTMLCanvasElement} canvas */
export function context2d(canvas) {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D rendering is unavailable');
  return context;
}

/** @template {HTMLElement} T @param {ParentNode} root @param {string} selector @param {{new(): T}} kind @returns {T} */
export function child(root, selector, kind) {
  const node = root.querySelector(selector);
  if (!(node instanceof kind)) throw new Error(`Missing ${kind.name} ${selector}`);
  return node;
}
