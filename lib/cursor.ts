// This file exposes a cursor interface for iterating over an operation.
//
// The cursor interface supports both reading and writing (appending).

import {Key, JSONOp, JSONOpComponent, JSONOpList, Path} from './types.js'

// const log = require('./log')
const log = (...args: any) => {}
function assert(pred: boolean, msg?: string): asserts pred {if (!pred) throw new Error(msg)}

const isObject = (o: any) => (o != null && typeof o === 'object' && !Array.isArray(o))

const isGreaterKey = (a: Key, b: Key) => (
  // All the numbers, then all the letters. Just as the gods of ascii intended.
  (typeof a === typeof b) ?
    a > b : typeof a === 'string' && typeof b === 'number'
)

function copyAll(c: JSONOpComponent, w: WriteCursor) {
  for (let _k in c) {
    const k = _k as keyof JSONOpComponent // bleh typescript.
    w.write(k, c[k])
  }
}

// It might be dangerous to allow __proto__ as a key path because of
// javascript's prototype semantics, especially because most apps won't
// check operations thoroughly enough.
export const isValidPathItem = (k: Key) => (
  typeof k === 'number' || (typeof k === 'string' && k !== '__proto__')
)

class Cursor {
  // Each time we descend we store the parent and the index of the child. The
  // indexes list is appended twice each time we descend - once with the last
  // key index of the parent, and once with the index of the array we're
  // descending down.
  parents: JSONOp[] = []
  indexes: number[] = []

  // The index of the last listy child we visited for write cursors. This is used
  // to ensure we are traversing the op in order.
  lcIdx = -1

  // The way we handle the root of the op is a big hack - its like that because
  // the root of an op is different from the rest; it can contain a component
  // immediately.
  // Except at the root (which could be null), container will always be a list.
  container: JSONOp
  idx = -1

  constructor(op: JSONOp = null) {
    this.container = op
  }

  ascend() {
    assert(this.parents.length === this.indexes.length / 2)

    if (this.idx === 0) {
      if (this.parents.length) {
        this.lcIdx = this.indexes.pop()!
        this.container = this.parents.pop()!
        this.idx = this.indexes.pop()!
      } else {
        this.lcIdx = 0
        this.idx = -1
      }
    } else {
      assert(this.idx > 0)
      this.idx--
      if (isObject(this.container![this.idx])) this.idx--
    }
  }

  getPath() {
    const path: Path = []
    let c = this.container
    let p = this.parents.length - 1
    let i = this.idx
    while (i >= 0) {
      path.unshift(c![i] as Key)
      if (i === 0) {
        i = this.indexes[p*2]
        c = this.parents[p--]
      } else {
        i -= isObject(c![i-1]) ? 2 : 1
      }
    }
    return path
  }
}

export class ReadCursor extends Cursor {
  get() { return this.container ? this.container.slice(this.idx + 1) : null }

  // Its only valid to call this after descending into a child.
  getKey() {
    assert(this.container != null, 'Invalid call to getKey before cursor descended')
    return this.container[this.idx] as Key
  }

  getComponent() {
    let c
    if (this.container && this.container.length > this.idx + 1 && isObject((c = this.container[this.idx + 1]))) {
      return c as JSONOpComponent
    } else {
      return null
    }
  }

  descendFirst() {
    let i = this.idx + 1

    // Only valid to call this if hasChildren() returns true.
    if (!this.container
        || i >= this.container.length
        || (isObject(this.container[i]) && (i + 1) >= this.container.length)) {
      return false
    }

    if (isObject(this.container[i])) i++ // Skip component
    const firstChild = this.container[i]

    if (Array.isArray(firstChild)) {
      this.indexes.push(this.idx)
      this.parents.push(this.container)
      this.indexes.push(i)
      this.idx = 0
      this.container = firstChild
    } else {
      this.idx = i
    }
    return true
  }

  nextSibling() {
    assert(this.parents.length === this.indexes.length / 2)
    // Children are inline or we're at the root
    if (this.idx > 0 || this.parents.length === 0) return false

    const i = this.indexes[this.indexes.length - 1] + 1
    const c = this.parents[this.parents.length - 1]!
    if (i >= c.length) return false // Past the end of the listy children.

    assert(!isNaN(i))
    this.indexes[this.indexes.length - 1] = i
    this.container = c[i] as JSONOpList
    // idx = 0 but it should be zero anyway.
    return true
  }

  private _init(_container: JSONOp, _idx: number, _parents: JSONOp[], _indexes: number[]) { // Internal for clone
    // parents.length = indexes.length = 0
    this.container = _container
    this.idx = _idx

    // Only need these for getPath()
    this.parents = _parents.slice()
    this.indexes = _indexes.slice()
  }

  clone() {
    const c = new ReadCursor()
    c._init(this.container, this.idx, this.parents, this.indexes)
    return c
  }

  *[Symbol.iterator]() {
    // Iterate through the child keys. At each key the cursor will be
    // pointing at the child the key represents.
    if (!this.descendFirst()) return

    do yield this.getKey()
    while (this.nextSibling())

    this.ascend()
  }


  // TODO(cleanup): Consider moving these functions out of cursor, since
  // they're really just helper methods.
  
  // It'd be really nice to do this using generators.
  traverse<W extends null | WriteCursor>(w: W, fn: (c: JSONOpComponent, w: W) => void) {
    const c = this.getComponent()
    if (c) fn(c, w)

    for (const key of this) {
      if (w) w.descend(key)
      this.traverse(w, fn)
      if (w) w.ascend()
    }
  }

  eachPick<W extends null | WriteCursor>(w: W, fn: (slot: number, w: W) => void) {
    this.traverse(w, (c, w) => { if (c.p != null) fn(c.p, w) })
  }
  eachDrop<W extends null | WriteCursor>(w: W, fn: (slot: number, w: W) => void) {
    this.traverse(w, (c, w) => { if (c.d != null) fn(c.d, w) })
  }
}

export class WriteCursor extends Cursor {
  pendingDescent: Path = []

  private _op: JSONOp // The op we're writing to. Returned via .get()

  constructor(op: JSONOp = null) {
    super(op)
    this._op = op
  }

  private flushDescent() {
    // After flushDescent is called, container will always be non-null.
    assert(this.parents.length === this.indexes.length / 2)

    if (this.container === null) this._op = this.container = []

    for (let j = 0; j < this.pendingDescent.length; j++) {
      const k = this.pendingDescent[j]
      // log('fd', k)
      let i = this.idx + 1

      // Skip the component here, if any.
      if (i < this.container.length && isObject(this.container[i])) i++

      assert(i === this.container.length || !isObject(this.container[i]))

      if (i === this.container.length) {
        // Just append a child here.
        this.container.push(k)
        this.idx = i

      } else if (this.container[i] === k) {
        // Traverse right...
        this.idx = i

      } else {
        if (!Array.isArray(this.container[i])) {
          // Its not an array. Its not the same as me. I must have a new child!
          // log('bundle inside', i, lcIdx)
          const oldChild = this.container.splice(i, this.container.length - i)
          this.container.push(oldChild)
          if (this.lcIdx > -1) this.lcIdx = i
        }

        this.indexes.push(this.idx)
        this.parents.push(this.container)

        if (this.lcIdx !== -1) {
          assert(isGreaterKey(k, (this.container[this.lcIdx] as JSONOpList)[0] as Key))
          i = this.lcIdx + 1
          this.lcIdx = -1
        }

        // Skip until k.
        while (i < this.container.length && isGreaterKey(k, (this.container[i] as JSONOpList)[0] as Key)) i++

        this.indexes.push(i)
        this.idx = 0
        if (i < this.container.length && (this.container[i] as JSONOpList)[0] === k) {
          this.container = this.container[i] as JSONOpList
        } else {
          // Insert a new child and descend into it.
          const child = [k]
          this.container.splice(i, 0, child)
          // log('-> container', container)
          this.container = child as JSONOpList
        }
      }
    }
    this.pendingDescent.length = 0
  }

  reset() { this.lcIdx = -1 }

  // Creates and returns a component, creating one if need be. You should
  // probably write to it immediately - ops are not valid with empty
  // components.
  getComponent(): JSONOpComponent {
    this.flushDescent()

    const i = this.idx + 1
    if (i < this.container!.length && isObject(this.container![i])) {
      return this.container![i] as JSONOpComponent
    } else {
      const component = {}
      this.container!.splice(i, 0, component)
      return component
    }
  }

  write<K extends keyof JSONOpComponent>(key: K, value: JSONOpComponent[K]) {
    const component = this.getComponent()
    assert(component[key] == null || component[key] === value,
      'Internal consistency error: Overwritten component. File a bug')
    component[key] = value
  }

  get() { return this._op }

  descend(key: Key) {
    if (!isValidPathItem(key)) throw Error('Invalid JSON key')
    // log('descend', key)
    this.pendingDescent.push(key)
  }

  descendPath(path: Path) {
    this.pendingDescent.push(...path)
    return this
  }

  ascend() {
    if (this.pendingDescent.length) this.pendingDescent.pop()
    else super.ascend()
  }

  mergeTree(data: JSONOp, mergeFn = copyAll) {
    if (data === null) return
    assert(Array.isArray(data))
    if (data === this._op) throw Error('Cannot merge into my own tree')

    // Backup our position...
    const _lcIdx = this.lcIdx
    const oldDepth = this.parents.length

    let depth = 0
    for (let i = 0; i < data.length; i++) {
      const c = data[i]
      if (typeof c === 'string' || typeof c === 'number') {
        depth++
        this.descend(c)
      } else if (Array.isArray(c)) {
        this.mergeTree(c, mergeFn)
      } else if (typeof c === 'object') {
        mergeFn(c, this)
      }
    }

    // And reset.
    while (depth--) this.ascend()

    // We might have had pending descents that we've flushed out. Reset
    // to the start of the descent.
    this.lcIdx = (this.parents.length === oldDepth) ? _lcIdx : -1
  }

  at(path: Path, fn: (w: WriteCursor) => void) {
    this.descendPath(path)
    fn(this)
    for (let i = 0; i < path.length; i++) this.ascend()
    return this
  }

  // This is used by helpers, so the strict ordering guarantees are
  // relaxed.
  writeAtPath<K extends keyof JSONOpComponent>(path: Path, key: K, value: JSONOpComponent[K]) {
    this.at(path, () => this.write(key, value))

    // Allows for multiple writeAtPath calls to relax ordering.
    this.reset()
    return this
  }

  writeMove(path1: Path, path2: Path, slot = 0) {
    return this
      .writeAtPath(path1, 'p', slot)
      .writeAtPath(path2, 'd', slot)
  }

  getPath() {
    const path = super.getPath()
    path.push(...this.pendingDescent)
    return path
  }
}

// ReadCursor / WriteCursor didn't used to be exported. These are old helpers for them.
// TODO: Remove in 1.0
export const writeCursor = () => (new WriteCursor())
export const readCursor = (op: JSONOp) => new ReadCursor(op)

// onSkipped is called for any children of r which are never returned by adv.
export function advancer(r: ReadCursor | null,
    listMap?: (k: number, c: JSONOpComponent | null) => number,
    listAdv?: (k: number, c: JSONOpComponent | null) => void) {
  let didDescend: boolean, valid: boolean
  // Could use r.children() here instead... though this is might be simpler.
  valid = didDescend = r ? r.descendFirst() : false

  // Advance to key k. If k is null, advance all the way to the end.
  // let last = undefined
  function adv(ktarget: Key) {
    // if (last === ktarget) throw Error('duplicate descent')
    // last = ktarget
    let k2_
    while (valid) {
      const k2 = k2_ = r!.getKey()

      if (ktarget != null) {
        let skip = false
        if (listMap && typeof k2 === 'number') {
          k2_ = listMap(k2, r!.getComponent())
          if (k2_ < 0) {
            k2_ = ~k2_
            skip = true
          }
        }

        // 3 cases:
        // - ktarget > k2. onSkip and iterate.
        // - ktarget = k and !skip. return r
        // - ktarget = k and skip or ktarget < k2. stop.
        
        if (isGreaterKey(k2_, ktarget)) return null
        else if (k2_ === ktarget && !skip) return r!
      }

      // Skip this item and continue.
      if (listAdv && typeof k2_ === 'number') listAdv(k2_, r!.getComponent())
      valid = r!.nextSibling()
    }
    return null
  }

  adv.end = () => {
    // Advance to the end of the child items. Technically only needed if onSkipped is defined
    if (didDescend) r!.ascend()
  }
  return adv
}

// Walk two cursors together.
export function eachChildOf(
    r1: ReadCursor | null, r2: ReadCursor | null,
    fn: (k: Key, r1: ReadCursor | null, r2: ReadCursor | null) => void) {
  let hasChild1, descended1, hasChild2, descended2
  hasChild1 = descended1 = r1 && r1.descendFirst()
  hasChild2 = descended2 = r2 && r2.descendFirst()

  while (hasChild1 || hasChild2) {
    let k1 = hasChild1 ? r1!.getKey() : null
    let k2 = hasChild2 ? r2!.getKey() : null

    if (k1 !== null && k2 !== null) {
      // Use the smallest key
      if (isGreaterKey(k2, k1)) k2 = null
      else if (k1 !== k2) k1 = null
    }

    // fn(key, r1 or null, r2 or null)
    fn((k1 == null ? k2! : k1),
      (k1 != null ? r1 : null),
      (k2 != null ? r2 : null)
    )

    if (k1 != null && hasChild1) {
      hasChild1 = r1!.nextSibling()
    }
    if (k2 != null && hasChild2) {
      hasChild2 = r2!.nextSibling()
    }
  }

  if (descended1) r1!.ascend()
  if (descended2) r2!.ascend()
}
