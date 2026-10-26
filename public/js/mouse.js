// Mouse input belongs to the captured canvas; touch/gamepad play does not capture it.
/**
 * @param {HTMLCanvasElement} canvas
 * @param {{look: (dx: number, dy: number) => void, press: (event: MouseEvent) => void,
 *   release: (event: MouseEvent) => void, getInvertY?: () => boolean}} on
 * @param {Document} [target]
 * @returns {() => void} Remove the page's mouse listeners.
 */
export function createMouse(canvas, on, target = document) {
  /** @param {(event: MouseEvent) => void} action */
  function whenCaptured(action) {
    /** @param {MouseEvent} event */
    return (event) => {
      if (target.pointerLockElement === canvas) action(event);
    };
  }
  const look = whenCaptured((event) => {
    on.look(event.movementX, on.getInvertY?.() ? -event.movementY : event.movementY);
  });
  const press = whenCaptured(on.press);
  const release = whenCaptured(on.release);
  target.addEventListener('mousemove', look);
  target.addEventListener('mousedown', press);
  target.addEventListener('mouseup', release);
  return () => {
    target.removeEventListener('mousemove', look);
    target.removeEventListener('mousedown', press);
    target.removeEventListener('mouseup', release);
  };
}
