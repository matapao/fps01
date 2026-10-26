/** Preserve the fixed three-component shape when transforming a position or direction.
 * @param {import('./contracts.ts').Vector3} vector
 * @param {(value: number, axis: import('./contracts.ts').Axis) => number} transform
 * @returns {import('./contracts.ts').Vector3}
 */
export function mapVector(vector, transform) {
  return [transform(vector[0], 0), transform(vector[1], 1), transform(vector[2], 2)];
}
/** @type {readonly import('./contracts.ts').Axis[]} */
export const AXES = [0, 1, 2];
