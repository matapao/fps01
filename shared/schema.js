// A JSON Schema validator (draft 2020-12) for the keywords the game's schemas use: the subset a zirbel
// host understands, so the engine checks its data at run time by the same rules the host checks it
// by before it takes a new revision. "x-zirbel-ref" (an id another block lists) isn't checked here:
// validate() hands back every value that carries one, for the caller to look up (shared/check.js).
//
//   const { problems, refs } = validate(schema, value, { schemas });   // schemas: other files, by name

/**
 * @typedef {boolean | SchemaObject} Schema
 * @typedef {{
 * $ref?: string, type?: string | string[], const?: unknown, enum?: unknown[],
 * minimum?: number, maximum?: number, exclusiveMinimum?: number, exclusiveMaximum?: number,
 * multipleOf?: number, minLength?: number, maxLength?: number, pattern?: string,
 * 'x-zirbel-ref'?: string, minItems?: number, maxItems?: number, prefixItems?: Schema[],
 * items?: Schema, uniqueItems?: boolean, contains?: Schema, minContains?: number, maxContains?: number,
 * minProperties?: number, maxProperties?: number, required?: string[],
 * dependentRequired?: Record<string, string[]>, patternProperties?: Record<string, Schema>,
 * propertyNames?: Schema, properties?: Record<string, Schema>, additionalProperties?: Schema,
 * allOf?: Schema[], anyOf?: Schema[], oneOf?: Schema[], not?: Schema, if?: Schema, then?: Schema, else?: Schema
 * }} SchemaObject
 * @typedef {{ path: string, message: string }} Problem
 * @typedef {{ path: string, block: string, value: string }} Reference
 * @typedef {{ schemas: Record<string, Schema>, problems: Problem[], refs: Reference[] }} Context
  @param {unknown} value @returns {value is Record<string, unknown>} */
const record = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** @type {Record<string, (value: unknown) => boolean>} */
const TYPES = {
  object: record,
  array: Array.isArray,
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  integer: Number.isInteger,
  boolean: (v) => typeof v === 'boolean',
  null: (v) => v === null,
};
const MOST_PROBLEMS = 50;

// problems: [{ path, message }] (a JSON Pointer to where, and what's wrong); refs: [{ path, block, value }].
/** @param {Schema} schema @param {unknown} value @param {{schemas?: Record<string, Schema>}} options */
export function validate(schema, value, { schemas = {} } = {}) {
  /** @type {Problem[]} */
  const problems = [];
  /** @type {Reference[]} */
  const refs = [];
  const root = schema;
  check(schema, value, '', root, { schemas, problems, refs });
  return { problems: problems.slice(0, MOST_PROBLEMS), refs };
}

// Whether a value passes, without collecting anything: for anyOf, oneOf, not and if.
/** @param {Schema | undefined} schema @param {unknown} value @param {Schema} root @param {Context} context */
function passes(schema, value, root, context) {
  const trial = { schemas: context.schemas, problems: [], refs: [] };
  check(schema, value, '', root, trial);
  return trial.problems.length === 0;
}

/** @param {Schema | undefined} schema @param {unknown} value @param {string} path @param {Schema} root @param {Context} context @returns {void} */
function check(schema, value, path, root, context) {
  if (schema === true || schema === undefined) return;
  /** @param {string} message */
  const fail = (message) => {
    if (context.problems.length < MOST_PROBLEMS) context.problems.push({ path: path || '/', message });
  };
  if (schema === false) return fail('is not allowed here');
  if (schema.$ref) {
    const [target, targetRoot] = resolve(schema.$ref, root, context.schemas);
    if (!target) return fail(`refers to ${schema.$ref}, which isn't there`);
    check(target, value, path, targetRoot, context);
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => TYPES[type]?.(value))) return fail(`should be ${types.join(' or ')}`);
  }
  if ('const' in schema && !same(value, schema.const)) fail(`should be ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((option) => same(option, value)))
    fail(`should be one of ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`);
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) fail(`should be at least ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) fail(`should be at most ${schema.maximum}`);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum)
      fail(`should be more than ${schema.exclusiveMinimum}`);
    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum)
      fail(`should be less than ${schema.exclusiveMaximum}`);
    if (
      schema.multipleOf !== undefined &&
      Math.abs(value / schema.multipleOf - Math.round(value / schema.multipleOf)) > 1e-9
    )
      fail(`should be a multiple of ${schema.multipleOf}`);
  }
  if (typeof value === 'string') {
    const length = [...value].length;
    if (schema.minLength !== undefined && length < schema.minLength)
      fail(`should be at least ${schema.minLength} characters`);
    if (schema.maxLength !== undefined && length > schema.maxLength)
      fail(`should be at most ${schema.maxLength} characters`);
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value))
      fail(`should match ${schema.pattern}`);
    if (schema['x-zirbel-ref'])
      context.refs.push({ path: path || '/', block: schema['x-zirbel-ref'], value });
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems)
      fail(`should have at least ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems)
      fail(`should have at most ${schema.maxItems} items`);
    const prefix = schema.prefixItems ?? [];
    prefix.forEach((item, i) => i < value.length && check(item, value[i], `${path}/${i}`, root, context));
    if (schema.items !== undefined)
      for (let i = prefix.length; i < value.length; i++)
        check(schema.items, value[i], `${path}/${i}`, root, context);
    if (schema.uniqueItems) {
      const seen = new Set();
      for (const item of value) {
        const key = JSON.stringify(item);
        if (seen.has(key)) fail('should have no item twice');
        seen.add(key);
      }
    }
    if (schema.contains !== undefined) {
      const count = value.filter((item) => passes(schema.contains, item, root, context)).length;
      if (count < (schema.minContains ?? 1)) fail('has too few of the items it must contain');
      if (schema.maxContains !== undefined && count > schema.maxContains)
        fail('has too many of the items it may contain');
    }
  }
  if (record(value)) {
    const keys = Object.keys(value);
    if (schema.minProperties !== undefined && keys.length < schema.minProperties)
      fail(`should have at least ${schema.minProperties} properties`);
    if (schema.maxProperties !== undefined && keys.length > schema.maxProperties)
      fail(`should have at most ${schema.maxProperties} properties`);
    for (const name of schema.required ?? []) if (!(name in value)) fail(`needs ${name}`);
    for (const [name, needs] of Object.entries(schema.dependentRequired ?? {})) {
      if (name in value)
        for (const other of needs) if (!(other in value)) fail(`needs ${other} with ${name}`);
    }
    const patterns = Object.entries(schema.patternProperties ?? {}).map(
      ([pattern, sub]) => /** @type {[RegExp, Schema]} */ ([new RegExp(pattern, 'u'), sub]),
    );
    for (const key of keys) {
      const where = `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`;
      if (schema.propertyNames) check(schema.propertyNames, key, where, root, context);
      let known = false;
      if (schema.properties && Object.hasOwn(schema.properties, key)) {
        known = true;
        check(schema.properties[key], value[key], where, root, context);
      }
      for (const [pattern, sub] of patterns) {
        if (!pattern.test(key)) continue;
        known = true;
        check(sub, value[key], where, root, context);
      }
      if (!known && schema.additionalProperties !== undefined) {
        if (schema.additionalProperties === false) fail(`has ${key}, which isn't one of its properties`);
        else check(schema.additionalProperties, value[key], where, root, context);
      }
    }
  }
  for (const sub of schema.allOf ?? []) check(sub, value, path, root, context);
  // Forms told apart by a constant (a part's "type", an alt-fire's "kind"): straight to the one meant.
  const tagged = schema.oneOf && pick(schema.oneOf, value, root, context);
  if (tagged) return check(tagged, value, path, root, context);
  if (schema.anyOf && !schema.anyOf.some((sub) => passes(sub, value, root, context))) {
    const close = closest(schema.anyOf, value, root, context);
    if (close) check(close, value, path, root, context);
    else fail('fits none of the forms it may take');
  }
  if (schema.oneOf) {
    const fits = schema.oneOf.filter((sub) => passes(sub, value, root, context));
    if (fits.length === 1)
      check(fits[0], value, path, root, context); // for the references it carries
    else if (fits.length > 1) fail('fits more than one of the forms it may take');
    else {
      const close = closest(schema.oneOf, value, root, context);
      if (close) check(close, value, path, root, context);
      else fail('fits none of the forms it may take');
    }
  } else if (schema.anyOf) {
    const fit = schema.anyOf.find((sub) => passes(sub, value, root, context));
    if (fit) check(fit, value, path, root, context);
  }
  if (schema.not !== undefined && passes(schema.not, value, root, context)) fail('is a form it may not take');
  if (schema.if !== undefined) {
    if (passes(schema.if, value, root, context)) {
      if (schema.then !== undefined) check(schema.then, value, path, root, context);
    } else if (schema.else !== undefined) check(schema.else, value, path, root, context);
  }
}

// Of forms that all say which they are by a constant property (type, kind), the one a value says
// it is. Null when the forms aren't like that.
/** @param {Schema[]} options @param {unknown} value @param {Schema} root @param {Context} context */
function pick(options, value, root, context) {
  if (!record(value)) return null;
  const resolved = options.map((option) =>
    objectSchema(
      typeof option === 'object' && option.$ref ? resolve(option.$ref, root, context.schemas)[0] : option,
    ),
  );
  for (const tag of ['type', 'kind']) {
    if (!resolved.every((option) => objectSchema(option.properties?.[tag]).const !== undefined)) continue;
    const i = resolved.findIndex((option) => objectSchema(option.properties?.[tag]).const === value[tag]);
    return i >= 0 ? options[i] : null;
  }
  return null;
}

// Of the forms a value may take, the one its "type" property (or, failing that, its JSON type)
// says it meant: its problems are the useful ones. Null if none says so.
/** @param {Schema[]} options @param {unknown} value @param {Schema} root @param {Context} context */
function closest(options, value, root, context) {
  const resolved = options.map((option) =>
    objectSchema(
      typeof option === 'object' && option.$ref ? resolve(option.$ref, root, context.schemas)[0] : option,
    ),
  );
  if (record(value) && typeof value['type'] === 'string') {
    const i = resolved.findIndex(
      (option) => objectSchema(option.properties?.['type']).const === value['type'],
    );
    if (i >= 0) return options[i];
  }
  const i = resolved.findIndex(
    (option) =>
      option.type &&
      (Array.isArray(option.type) ? option.type : [option.type]).some((type) => TYPES[type]?.(value)),
  );
  return i >= 0 &&
    resolved.filter((option) => option.type && typeof option.type === 'string' && TYPES[option.type]?.(value))
      .length === 1
    ? options[i]
    : null;
}

// "#/$defs/name" in this schema, or "other.schema.json#/$defs/name" in another.
/** @param {string} ref @param {Schema} root @param {Record<string, Schema>} schemas @returns {[Schema | null, Schema]} */
function resolve(ref, root, schemas) {
  const [file, pointer = ''] = ref.split('#');
  const base = file ? schemas[file.replace(/^\.\//, '')] : root;
  if (base === undefined) return [null, root];
  /** @type {unknown} */
  let target = base;
  for (const part of pointer.split('/').filter(Boolean)) {
    const key = decodeURIComponent(part).replace(/~1/g, '/').replace(/~0/g, '~');
    target = record(target) ? target[key] : undefined;
  }
  return [schemaNode(target) ? target : null, base];
}

/** @param {unknown} a @param {unknown} b */
function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** @param {Schema | null | undefined} schema @returns {SchemaObject} */
function objectSchema(schema) {
  return schema && typeof schema === 'object' ? schema : {};
}

// Schemas are owned JSON documents, not wire data; reference traversal accepts only object or boolean nodes.
/** @param {unknown} value @returns {value is Schema} */
function schemaNode(value) {
  return typeof value === 'boolean' || record(value);
}
