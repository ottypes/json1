import {TextOp} from 'ot-text-unicode'

/** The text op component from text-unicode */
export {TextOp, TextOpComponent} from 'ot-text-unicode'

export type JSONOpComponent = {
  /** insert */
  i?: any,
  /** remove */
  r?: any,
  /** pick */
  p?: number,
  /** drop */
  d?: number,

  /** Edit string (directly uses text-unicode) */
  es?: TextOp,
  /** Edit number */
  ena?: number,

  /** Arbitrary edit. If the element has e: it must also have et: with a registered type name */
  e?: any
  /** Edit type name. */
  et?: string
}

export type JSONOpList = (number | string | JSONOpComponent | JSONOpList)[]

/**
 * A JSON operation.
 *
 * There's some aspects of valid operations which aren't captured by the type:
 *
 * - The last element of any list must be an object (the op component)
 * - Except at the root, every inner list must have a length at least 2, and the
 *   first element must be a number or string.
 * - Operation components cannot be empty
 * - No two adjacent list elements can be operation components.
 * - If a component has listy children (it descends), those descenders are
 *   sorted and come after any local op component. So, [<my descent>, <local op
 *   component>, <descent 1>, <descent 2>, ...]
 * - Picks and drops must be matched, and use low numbers (0, 1, 2, ....)
 *
 * noop is represented by 'null'.
 *
 * Valid operations: null, [{i:5}], ['a', {i:5}], [['a', {p:0}], ['b', {d:0}]],
 * [10, {i:5}, 'b', {r:true}]
 *
 * Not valid: [], ['a', [{i:5}]], [[{i:5}]], [{}], ['a', {}], ['a', ['b', {i:5}], {r:true}]
 *
 * Many 'invalid' operations can be cleaned up into their canonical form by the
 * normalize() function.
 *
 * If you want some examples, take a look at the test suite.
 */
export type JSONOp = null | JSONOpList

export type Key = number | string
export type Path = Key[]

/**
 * JSON documents must be able to round-trip through JSON.stringify /
 * JSON.parse. So this means they can't contain:
 * 
 * - undefined
 * - Circular references
 * - Objects of classes
 * - Functions
 * - Sets, Maps, Dates, DOM nodes, etc
 */
export type Doc = null | boolean | number | string | Doc[] | {[k: string]: Doc}

export enum ConflictType {
  RM_UNEXPECTED_CONTENT = 1,
  DROP_COLLISION = 2,
  BLACKHOLE = 3,
}

export interface Conflict { type: ConflictType, op1: JSONOp, op2: JSONOp }
