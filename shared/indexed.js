/** Read an algorithm's required array entry, rejecting a broken bounds invariant.
 * @template T @param {ArrayLike<T>} values @param {number} index @returns {T}
 */
export function indexed(values, index) {
  const value = values[index];
  if (value === undefined) throw new RangeError(`Missing array entry at ${index}`);
  return value;
}

/** Resolve a required validated identifier without inventing a fallback entry.
 * @template T @param {Readonly<Record<string, T>>} values @param {string} id @returns {T}
 */
export function lookup(values, id) {
  const value = values[id];
  if (value === undefined) throw new Error(`Missing validated reference ${id}`);
  return value;
}
