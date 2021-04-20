// This is the JSON OT type implementation. It is a successor to JSON0
// (https://github.com/ottypes/json0), better in a bunch of ways.
//
// This type follows after the text type. Instead of operations being a list of
// small changes, an operation is a tree mirroring the structure of the document
// itself. Operations contain three things:
// - Edits
// - Pick up operations
// - Drop operations
//
// The complete spec is in spec.md alongside this file.
//
//
// A tiny todo list (new issues should go on github):
// - compose should preserve invertible data
// - Conversion between json1 ops and json0, json-patch.
// - Conflict resolving methods to make a backup move location in the operation
// - remove N items in a list - it'd be nice to be able to express this in O(1) instead of O(n).

// import log from './log'
import deepEqual from './deepEqual.js'
import deepClone from './deepClone.js'
import {ReadCursor, WriteCursor, readCursor, writeCursor, advancer, eachChildOf, isValidPathItem} from './cursor.js'
import { Doc, JSONOpComponent, Path, Key, JSONOp, JSONOpList, Conflict, ConflictType } from './types.js'

const RELEASE_MODE = process.env.JSON1_RELEASE_MODE
const log: (...args: any) => void = RELEASE_MODE ? (() => {}) : require('./log').default

// Not using assert to decrease how much stuff we pull in in the browser
// const assert = !RELEASE_MODE ? require('assert') : (pred: boolean, msg?: string) => {if (!pred) throw new Error(msg)}
function assert(pred: any, msg?: string): asserts pred {
  if (!RELEASE_MODE) require('assert')(pred, msg) // For nicer error messages in node.
  else if (!pred) throw new Error(msg)
}

let debugMode = false

export const type = {
  name: 'json1',
  uri: "http://sharejs.org/types/JSONv1",
  readCursor,
  writeCursor,

  // The document must be immutable. Create by default sets a document at
  // `undefined`. You should follow up by initializing the document using a
  // {i:....} operation.
  create(data: Doc) { return data },

  isNoop(op: JSONOp) { return op == null },

  setDebug(val: boolean) { debugMode = val; (log as any).quiet = !val },

  registerSubtype,

  checkValidOp,
  normalize,

  apply,
  transformPosition,
  compose,
  tryTransform,
  transform,

  makeInvertible,
  invert,
  invertWithDoc,

  // TODO: Consider simply exporting ConflictType.
  RM_UNEXPECTED_CONTENT: ConflictType.RM_UNEXPECTED_CONTENT,
  DROP_COLLISION: ConflictType.DROP_COLLISION,
  BLACKHOLE: ConflictType.BLACKHOLE,



  // Mmmm I'm not sure the best way to expose this.
  transformNoConflict: (op1: JSONOp, op2: JSONOp, side: 'left' | 'right') => (
    transformWithConflictsPred(() => true, op1, op2, side)
  ),

  typeAllowingConflictsPred: (allowConflict: AllowConflictPred) => ({
    ...type,
    transform(op1: JSONOp, op2: JSONOp, side: 'left' | 'right') {
      return transformWithConflictsPred(allowConflict, op1, op2, side)
    }
  })
}


const getComponent = (r?: ReadCursor | WriteCursor | null) => r ? r.getComponent() : null

function isObject(o: any): o is {[k: string]: any} {
  return o && typeof(o) === 'object' && !Array.isArray(o)
}

// Can't figure out how to make a generic type 
const shallowClone = (obj: Doc) => (
  Array.isArray(obj)
    ? obj.slice()
    : obj !== null && typeof obj === 'object' ? Object.assign({}, obj)
    : obj
)

const hasPick = (c?: JSONOpComponent | null) => c && (c.p != null || c.r !== undefined)
const hasDrop = (c?: JSONOpComponent | null) => c && (c.d != null || c.i !== undefined)

// **** Helpers to make operations.
//
// TODO(cleanup): Move these out into another file.
export const removeOp = (path: Path, value = true) => (
  writeCursor()
  .writeAtPath(path, 'r', value)
  .get()
)

export const moveOp = (from: Path, to: Path) => (
  writeCursor()
  .writeMove(from, to)
  .get()
)

export const insertOp = (path: Path, value: Doc) => (
  writeCursor()
  .writeAtPath(path, 'i', value)
  .get()
)

export const replaceOp = (path: Path, oldVal: Doc, newVal: Doc) => (
  writeCursor().at(path, (w) => {
    w.write('r', oldVal)
    w.write('i', newVal)
  }).get()
)

export const editOp = (path: Path, type: Subtype | string, subOp: any, preserveNoop: boolean = false) => (
  writeCursor()
  .at(path, w => writeEdit(w, type, subOp, preserveNoop))
  .get()
)

type DocObj = {[k: string]: Doc}
// Remove key from container. Return container with key removed
function removeChild(container: Doc[] | DocObj, key: Key) {
  assert(container != null)
  if (typeof key === 'number') { // Removing from a list
    assert(Array.isArray(container), 'Invalid key - child is not an array')
    container = container.slice()
    container.splice(key, 1)
  } else { // Removing from an object
    assert(isObject(container), 'Invalid key - child is not an object')
    container = Object.assign({}, container)
    delete (container as DocObj)[key]
  }
  return container
}

// Insert value at key in container. Return container with new value
function insertChildMut(container: Doc[] | DocObj, key: Key, value: Doc) {
  if (typeof key === 'number') {
    assert(container != null, 'Container is missing for key')
    assert(Array.isArray(container), 'Cannot use numerical key for object container')
    assert(container.length >= key, 'Cannot insert into out of bounds index')
    //container = container.slice()
    container.splice(key, 0, value)
  } else {
    assert(isObject(container), 'Cannot insert into missing item')
    assert((container as DocObj)[key] === undefined, 'Trying to overwrite value at key. Your op needs to remove it first')
    ;(container as DocObj)[key] = value
    //container = Object.assign({[key]:value}, container)
  }

  return value
}

const replaceChild = (obj: Doc[] | DocObj, k: Key, v: any) => {
  obj = shallowClone(obj) as typeof obj
  ;(obj as any)[k] = v // Could add an assert here...
  return obj
}

const isValidKey = (container: Doc | undefined, key: Key): boolean => (
  container == null
    ? false
    : typeof key === 'number'
      ? Array.isArray(container)
      : typeof container === 'object'
)

const maybeGetChild = (container: Doc | undefined, key: Key): Doc | undefined => (
  isValidKey(container, key) ? (container as any)[key] : undefined
)

// *******

type Subtype = {
  name: string,
  uri?: string,
  apply(doc: any, op: any): any, // want to buy: Rust's associated types.
  compose(op1: any, op2: any): any,
  transform(op1: any, op2: any, by: 'left' | 'right'): any
  isNoop?: (op: any) => boolean
  invert?: (op: any) => any
  makeInvertible?: (op: any, doc: any) => any

  [k: string]: any,
}

const subtypes: {[k: string]: Subtype} = {}
function registerSubtype(subtype: Subtype | {type: Subtype, [k: string]: any}) {
  let _subtype = subtype.type ? subtype.type : subtype
  if (_subtype.name) subtypes[_subtype.name] = _subtype
  if (_subtype.uri) subtypes[_subtype.uri] = _subtype
}

const typeOrThrow = (name: string) => {
  const type = subtypes[name]
  if (!type) throw Error('Missing type: ' + name)
  else return type
}

registerSubtype(require('ot-text-unicode'))

const add = (a: number, b: number) => a + b
registerSubtype({
  name: 'number',
  apply: add,
  compose: add,
  invert: (n: number) => -n,
  transform: a => a,
})

const getEditType = (c?: JSONOpComponent | null) => (
  (c == null) ? null
    : c.et ? typeOrThrow(c.et)
    : c.es ? subtypes['text-unicode']
    : c.ena != null ? subtypes.number
    : null
)

// I'm using terneries here because .ena might be 0.
const getEdit = (c: JSONOpComponent) => c.es ? c.es : c.ena != null ? c.ena : c.e

// Type is an object or a string name.
const writeEdit = (w: WriteCursor, typeOrName: Subtype | string, edit: any, preserveNoop: boolean = false) => {
  // I hope v8 doesn't make a temporary array here.
  const [type, name] = (typeof typeOrName === 'string')
    ? [typeOrThrow(typeOrName), typeOrName]
    : [typeOrName, typeOrName.name]

  // Discard embedded noops.
  if (!preserveNoop && type.isNoop && type.isNoop(edit)) return

  if (name === 'number') {
    w.write('ena', edit)
  } else if (name === 'text-unicode') {
    w.write('es', edit) // Text edit-string operation.
  } else { // TODO: Also if t1 === subtypes.number then write ena...
    w.write('et', name) // Generic embedded edit.
    w.write('e', edit)
  }
}


// ***** Check code


function checkNonNegInteger(n: any): asserts n is number {
  assert(typeof n === 'number')
  assert(n >= 0)
  assert(n === (n|0))
}

function checkScalar(s: any): asserts s is number | string {
  if (typeof s === 'number') {
    checkNonNegInteger(s)
  } else {
    assert(typeof s === 'string')
  }
}

function checkValidOp(op: JSONOp) {
  //console.log 'check', op

  if (op === null) return // Empty operation. undefined is not a valid operation and should crash.

  // Both sets of used IDs.
  const pickedSlots = new Set
  const droppedSlots = new Set

  const checkComponent = (e: JSONOpComponent) => {
    let empty = true
    let hasEdit = false
    for (let k in e) {
      const v = e[k as keyof JSONOpComponent]
      empty = false

      // Thanks coffeescript compiler!
      assert(k === 'p' || k === 'r' || k === 'd' || k === 'i'
        || k === 'e' || k === 'es' || k === 'ena' || k === 'et',
        "Invalid component item '" + k + "'")

      if (k === 'p') {
        checkNonNegInteger(v)
        assert(!pickedSlots.has(v))
        pickedSlots.add(v)
        assert(e.r === undefined)
      } else if (k === 'd') {
        checkNonNegInteger(v)
        assert(!droppedSlots.has(v))
        droppedSlots.add(v)
        assert(e.i === undefined)
      } else if (k === 'e' || k === 'es' || k === 'ena') {
        assert(!hasEdit)
        hasEdit = true
        const t = getEditType(e)
        assert(t, 'Missing type in edit')
        if (t.checkValidOp) t.checkValidOp(getEdit(e))
      }
    }

    assert(!empty)
  }

  const SCALAR=1, EDIT=2, DESCENT=3
  const checkDescent = (descent: JSONOpList, isRoot: boolean, removed: Doc) => {
    if (!Array.isArray(descent)) throw Error('Op must be null or a list')
    if (descent.length === 0) throw Error('Empty descent')

    if (!isRoot) checkScalar(descent[0])

    let last = SCALAR
    // let lastScalarType = 'string' // or 'number' or 'string'.
    let numDescents = 0
    let lastKey: Key = 0

    for (let i = 0; i < descent.length; i++) {
      const d = descent[i]
      assert(d != null)

      if (Array.isArray(d)) {
        // Recursive descent inside children
        const key = checkDescent(d, false, removed)
        if (numDescents) {
          const t1 = typeof lastKey
          const t2 = typeof key
          if (t1 === t2) assert(lastKey < key, 'descent keys are not in order')
          else assert(t1 === 'number' && t2 === 'string')
        }

        lastKey = key
        numDescents++
        last = DESCENT
      } else if (typeof d === 'object') {
        // Component
        assert(last === SCALAR, `Prev not scalar - instead ${last}`)
        checkComponent(d)

        // const hasP = d.r !== undefined || d.p != null
        // const hasD = d.i !== undefined || d.d != null
        // if (removed && hasD) throw Error('Cannot drop in deleted object')

        // if (hasD) removed = false
        // else if (hasP && lastScalarType === 'string') removed = true

        // if (removed && getEditType(d) != null) throw Error('Cannot edit missing object')
        last = EDIT
      } else {
        // Descent key
        assert(last !== DESCENT)
        checkScalar(d)
        assert(isValidPathItem(d), 'Invalid path key') // They're trying to use __proto__ or something.
        last = SCALAR
        // lastScalarType = typeof d
      }
    }

    assert(numDescents !== 1, 'Operation makes multiple descents. Remove some []')
    assert(last === EDIT || last === DESCENT)

    return descent[0] as Key
  }

  checkDescent(op, true, false)

  assert(pickedSlots.size === droppedSlots.size, 'Mismatched picks and drops in op')

  for (let i = 0; i < pickedSlots.size; i++) {
    assert(pickedSlots.has(i))
    assert(droppedSlots.has(i))
  }
}

function normalize(op: JSONOp) {
  let nextSlot = 0
  let slotMap: number[] = []
  const getSlot = (inSlot: number) => {
    if (slotMap[inSlot] == null) slotMap[inSlot] = nextSlot++
    return slotMap[inSlot]
  }

  const w = writeCursor()
  w.mergeTree(op, (c, w) => {
    const t = getEditType(c)
    if (t) {
      const op = getEdit(c)
      writeEdit(w, t, t.normalize ? t.normalize(op) : op)
    }

    // Copy everything else in like normal.
    for (const k of ['r', 'p', 'i', 'd'] as (keyof JSONOpComponent)[]) {
      if (c[k] !== undefined) {
        const r = (k === 'p' || k === 'd') ? getSlot(c[k]!) : c[k]
        w.write(k, r)
      }
    }
  })
  return w.get()
}


// ***** Apply

/**
 * Apply op to snapshot. Return the new snapshot.
 *
 * The snapshot is shallow copied as its edited, so the previous snapshot
 * reference is still valid.
 */
function apply(snapshot: Doc | undefined, op: JSONOp) {
  // Apply doesn't make use of cursors. It might be a little simpler to
  // implement apply using them. The reason they aren't used here is merely
  // historical - the cursor implementation was written after apply() was
  // already working great.

  ;(log as any).quiet = !debugMode
  //log.quiet = false
  //log('*******************************************')
  if (!RELEASE_MODE) {
    log('apply')
    log('snapshot', snapshot)
    log('op', op)
    log(`repro: apply(${JSON.stringify(snapshot)}, ${JSON.stringify(op)})`)
  }

  checkValidOp(op)

  // The snapshot can be undefined if the document is being made with this
  // operation. Its up to the application if they want to use OT to support
  // that, or if they want to disallow the document from being undefined.

  if (op === null) return snapshot

  const held: Doc[] = [] // Indexed by the pick #. Autoexpand.

  // The op is made up of lists. Each list item is one of three things:
  // - A descent (a scalar value to descend into either a list or an object at
  //   the current location). Except for at the root there is always at least 1 of these.
  // - An edit - which is a pick, a drop or an edit.
  // - A child descent. These are always at the end of the list. We recurse for these.

  // Phase 1: Pick. Returns updated subdocument.
  function pick(subDoc: Doc | undefined, descent: JSONOpList) {
    //log('pick', subDoc, descent)

    // const stack: (DocObj | Doc[] | undefined)[] = []
    const stack: (Doc | undefined)[] = []

    let i = 0
    for (; i < descent.length; i++) {
      const d = descent[i]
      if (Array.isArray(d)) break
      if (typeof d === 'object') continue
      stack.push(subDoc)
      // Its valid to descend into a null space - just we can't pick there, so
      // we'll set subdoc to undefined in those cases.
      subDoc = maybeGetChild(subDoc, d)
    }

    // Children. These need to be traversed in reverse order here.
    // Note all children after the local op component are child descents.
    for (let j = descent.length - 1; j >= i; j--) {
      // This returns the new subDoc, or undefined if the child should be removed.
      subDoc = pick(subDoc, descent[j] as JSONOpList)
    }

    // Then back again.
    for (--i; i >= 0; i--) {
      const d = descent[i] as Key | JSONOpComponent
      if (typeof d !== 'object') {
        const container = stack.pop()

        // Mirrored from above, which is a little gross.
        const expectedChild = maybeGetChild(container, d)
        // Have fuuuuunnnn! (TODO: Clean this mess up. And what should / does this do if container is a string / number?)
        subDoc = (subDoc === expectedChild)
          ? container
          : (subDoc === undefined)
            ? removeChild(container as Doc[] | DocObj, d)
            : replaceChild(container as Doc[] | DocObj, d, subDoc)
      } else if (hasPick(d)) {
        assert(subDoc !== undefined, 'Cannot pick up or remove undefined')
        if (d.p != null) held[d.p] = subDoc
        subDoc = undefined
      }
    }

    return subDoc
  }

  snapshot = pick(snapshot, op) as Doc

  log('--- after pick phase ---')
  log('held', held, 'snapshot', snapshot)

  function drop(root: Doc, descent: JSONOpList) {
    // The document might have already been cloned in-place. If it has we'll
    // still throw it out and make a new one. This should be pretty quick but
    // if its a problem we could optimize it by making a editable Set with
    // everything we've cloned (and thus is safe to edit)
    //
    // I think it should be safe anyway because short lived objects are pretty
    // cheap in a modern generational GC.

    let subDoc = root, i = 0 // For reading
    let rootContainer: Doc = {root} // This is an avoidable allocation.
    let m = 0, container: Doc = rootContainer, key: Key = 'root' // For writing

    function mut() {
      for (; m < i; m++) {
        let d = descent[m]
        if (typeof d === 'object') continue

        //log('descent', d, container, key)
        assert(isValidKey(container, key))
        container = (container as any)[key] = shallowClone((container as any)[key])
        key = d
      }
    }

    for (; i < descent.length; i++) {
      const d = descent[i]

      if (Array.isArray(d)) {
        const child = drop(subDoc, d)
        if (child !== subDoc && child !== undefined) {
          mut(); subDoc = container[key] = child
        }
      } else if (typeof d === 'object') {
        if (d.d != null) { // Drop
          mut(); subDoc = insertChildMut(container, key, held[d.d])
        } else if (d.i !== undefined) { // Insert
          mut(); subDoc = insertChildMut(container, key, d.i)
        }

        const t = getEditType(d)
        if (t) { // Edit. Ok because its illegal to drop inside mixed region
          mut(); subDoc = container[key] = t.apply(subDoc, getEdit(d))
        } else if (d.e !== undefined) {
          throw Error("Subtype " + d.et + " undefined")
        }

      } else {
        // Scalar. Descend.
        // Actually we should check that the types match.

        // TODO: Use isValidKey to check this.
        subDoc = maybeGetChild(subDoc, d) as Doc
        // subDoc = subDoc != null ? (subDoc as any)[d] : undefined
      }
    }

    return rootContainer.root
  }

  //log('drop', snapshot, op)
  snapshot = drop(snapshot, op)

  log('-> apply returning snapshot', snapshot)
  return snapshot
}

const incPrefix = () => { if (!RELEASE_MODE) (log as any).prefix++ }
const decPrefix = () => { if (!RELEASE_MODE) (log as any).prefix-- }

/**
 * Transforms a path by an operation. Eg:
 *
 * ```javascript
 * newPath = transformPosition([3, 'address'], [2, {r: true}])
 * // newPath is [2, 'address']
 * ```
 *
 * This is useful for cursors, for tracking annotations and various other
 * markers which should stick to a single element of the JSON document.
 *
 * transformPosition returns null if the item stored at the path no longer
 * exists in the document after the operation has been applied. Eg:
 * 
 * ```javascript
 * assert(transformPosition([2, 'address', 'street'], [2, {r: true}]) === null)
 * ```
 */
function transformPosition(path: Path, op: JSONOp): Path | null {
  log('transformPosition', path, op)
  incPrefix()
  path = path.slice()
  checkValidOp(op)

  const r = readCursor(op)

  // First picks. There's 3 results here:
  // 1. The object at the path (or a parent) was removed
  // 2. Some parent was picked up
  // 3. The op doesn't modify this path, although it might insert before / after.

  let removed = false
  let pickedAtSlot: number
  let pickIndex: number // index in path where pick happened

  const advStack = []

  for (let i = 0;; i++) {
    const k = path[i]
    const c = r.getComponent()
    log('pick phase', i, ':', k, c)
    if (c) {
      // Object / object parent removed
      if (c.r !== undefined) removed = true
      else if (c.p != null) {
        removed = false
        pickedAtSlot = c.p
        pickIndex = i
      }
    }

    if (i >= path.length) break

    let pickOffset = 0
    const pickAdv = advancer(r, undefined, (k, c) => {
      if (hasPick(c)) {
        pickOffset++
        // log('p2Pick++', p2PickOff, k, c)
      }
    })
    advStack.unshift(pickAdv)

    const hasNext = pickAdv(k)
    if (typeof k === 'number') (path[i] as number) -= pickOffset
    if (!hasNext) break
  }

  // Instead of this bookkeeping, consider just making a new read cursor for handleDrop.
  advStack.forEach(pickAdv => pickAdv.end())

  decPrefix()
  log('after pick phase. Remove', removed,
    'pi', pickIndex!,
    'pas', pickedAtSlot!,
    'po', path)

  // If we've been removed there's nothing else to do.
  if (removed) {
    log('item removed. Bailing!')
    return null
  }

  // If we've been moved into a slot, we 100% don't care about anything above
  // the slot we've been dropped in.

  const handleDrop = () => {
    incPrefix()
    let i = 0
    if (pickedAtSlot != null) {
      // We've been dropped at some path. We teleport to the drop
      // location and scan from there.
      const rPath = r.getPath()
      i = rPath.length
      if (!RELEASE_MODE) log('path', path, 'pi', pickIndex, 'r', rPath)
      path = rPath.concat(path.slice(pickIndex))
    }

    if (!RELEASE_MODE) log('handleDrop at path', path, 'read cursor', r.getPath())

    // We need to walk down to the end of the path and adjust indicies on the
    // way based on earlier list drops and edits.
    for (; i < path.length; i++) {
      const k = path[i]
      // We don't actually care about drops here... they shouldn't happen in
      // general; but if they do then we'll silently ignore them.

      const c = getComponent(r)
      const et = getEditType(c)
      if (et) {
        const e = getEdit(c!)
        log('Embedded edit', e, et)
        if (et.transformPosition) path[i] = et.transformPosition(path[i], e)
        // Its invalid for the operation to have drops inside the embedded edit here.
        break
      }

      let dropOffset = 0

      const dropAdv = advancer(r, (k, c) => (
        hasDrop(c) ? ~(k - dropOffset) : k - dropOffset
      ), (k, c) => {
        if (hasDrop(c)) dropOffset++
      })

      const hasNext = dropAdv(k)

      // I'm not keeping the advancer here because it doesn't matter if we
      // ascend back up after this.
      if (typeof k === 'number') (path[i] as number) += dropOffset
      if (!hasNext) break
    }
    decPrefix()
  }

  if (pickedAtSlot! != null) {
    r.eachDrop(null, (slot) => {
      if (slot === pickedAtSlot) handleDrop()
    })
  } else handleDrop()

  log('-> transformPosition returning', path)
  return path
}


// ****** Compose

const setOrRemoveChild = (container: Doc[] | DocObj, key: Key, child?: Doc) => {
  // Mutate child, setting container[key] = child. Its a shame apply works
  // slightly differently from this and we can't reuse the code at the top of
  // the file.
  //
  // TODO: Refactor helper functions so they share the work.
  //
  // This function will never *insert* - it will only either remove an item
  // (child === undefined) or replace it.

  if (typeof key === 'number') {
    assert(Array.isArray(container))
    assert(key < container.length)
  } else {
    assert(!Array.isArray(container))
    assert(container[key] !== undefined)
  }

  if (child === undefined) {
    if (typeof key === 'number') (container as Doc[]).splice(key, 1)
    else delete (container as DocObj)[key]
  } else {
    (container as any)[key] = child
  }
}

function compose(op1: JSONOp, op2: JSONOp) {
  if (debugMode && !RELEASE_MODE) {
    log("composing:")
    log('  op1:', op1)
    log('  op2:', op2)
  }

  checkValidOp(op1)
  checkValidOp(op2)

  if (op1 == null) return op2
  if (op2 == null) return op1

  let nextSlot = 0

  const r1 = readCursor(op1), r2 = readCursor(op2)
  const w = writeCursor()

  // Compose has fundamentally three contexts we need to consider:
  //
  // - The context of the original document (op1 picks)
  // - The context of the document after op1 but before op2 (op1 drops & edits, op2 picks)
  // - The context of the final document (op2 drops & edits)
  //
  // We need to transform everything in that middle context out:
  // - op2 picks need to be transformed back by op1
  // - op1 drops and edits need to be transformed by op2
  //
  // Everything else (op1 picks and op2 drops) gets copied directly into the output.

  // This is a set of write cursors for locations in the output indexed by op1
  // and op2's moves, respectively. The content of these cursors is copied into
  // the output.
  const heldPickWrites: WriteCursor[] = []
  const heldDropWrites: WriteCursor[] = []

  // Held read cursors in the outside pick and drop locations, so we can
  // teleport our cursors while reading.
  const held1Pick: ReadCursor[] = []
  const held2Drop: ReadCursor[] = []

  // Map from op1 slots -> output slots
  const p1SlotMap: number[] = []
  const p2SlotMap: number[] = []

  const visitedOp2EditCs = new Set<JSONOpComponent>()

  // This is just for debugging.
  const uniqPaths: {[k: string]: Set<string>} = {}
  const uniqDesc = (key: string, reader: ReadCursor | null | undefined) => {
    if (reader == null) return
    if (uniqPaths[key] == null) uniqPaths[key] = new Set()

    // log('uniqDesc', key, reader.getPath())
    const path = reader.getPath().map((k,i) => `${i}:${k}`).join('.')
    if (uniqPaths[key].has(path)) throw Error(`non-unique descent: ${key} ${path}`)
    uniqPaths[key].add(path)
  }

  // First scan the outside operations to populate held1Pick and held2Drop.
  r1.traverse(null, c => {
    if (c.p != null) held1Pick[c.p] = r1.clone()
  })

  r2.traverse(null, c => {
    // Clone the read cursor
    if (c.d != null) held2Drop[c.d] = r2.clone()
  })


  // Next we can scan the inside edge following op1 drops then op2 picks,
  // transforming and writing the output to w.
  //
  // At least one of r1Drop or r2Pick must not be null.
  //
  // This function writes r1 drops to w1 and r2 picks to wp.
  function xfBoundary(
      r1Pick: ReadCursor | null, r1Drop: ReadCursor | null,
      r2Pick: ReadCursor | null, r2Drop: ReadCursor | null,
      litIn: Doc | undefined, rmParent: boolean,
      wd: WriteCursor, wp: WriteCursor) {
    assert(r1Drop || r2Pick)
    if (!RELEASE_MODE) log('xfBoundary', litIn,
      !!r1Pick && r1Pick.getPath(), !!r1Drop && r1Drop.getPath(),
      !!r2Pick && r2Pick.getPath(), !!r2Drop && r2Drop.getPath(),
      'lit:', litIn, 'rmParent:', rmParent)
    incPrefix()

    const c1d = getComponent(r1Drop)
    const c2p = getComponent(r2Pick)

    const rmHere = c2p ? c2p.r !== undefined : false
    const insHere = c1d ? c1d.i !== undefined : false
    const drop1Slot = c1d ? c1d.d : null
    const pick2Slot = c2p ? c2p.p : null

    log('pick2Slot', pick2Slot, 'drop1Slot', drop1Slot)

    // rmParent arg for when we recurse.
    const rmChildren = (rmParent || rmHere) && (pick2Slot == null)

    if (pick2Slot != null) {
      log('teleporting via c2 pick2Slot', pick2Slot)
      r2Drop = held2Drop[pick2Slot]
      if (!RELEASE_MODE) log('r2Drop', r2Drop && r2Drop.getPath())

      // Writes here need to be transformed to op2's drop location.
      wd = heldDropWrites[pick2Slot] = new WriteCursor()
      // rmParent = null
    } else if (c2p && c2p.r !== undefined) {
      r2Drop = null
    } else {
      // We're processing the drop when we see the corresponding pickup.
      const c2d = getComponent(r2Drop)
      if (c2d && c2d.d != null) r2Drop = null
    }

    const c2d = getComponent(r2Drop)

    if (drop1Slot != null) { // Drop here.
      log('teleporting via c1 drop1Slot', drop1Slot)
      r1Pick = held1Pick[drop1Slot]

      // Writes here need to be transformed to op2's drop location.
      wp = heldPickWrites[drop1Slot] = new WriteCursor()

      if (!rmChildren) {
        const slot = p1SlotMap[drop1Slot] = nextSlot++
        log('assigning slot', slot, 'to op1 slot', drop1Slot)
        wd.write('d', slot)
      } else {
        log('Cancelling op1 move', drop1Slot, 'rmParent', rmParent, 'rmHere', rmHere)
        // TODO: merge removed subdocuments here. This logic should mirror compose on insert.
        if (rmParent && !rmHere) wp.write('r', true)
      }
    } else if (c1d && c1d.i !== undefined) {
      r1Pick = null
    } else {
      // TODO: ??? Why is this also necessary?
      const c1p = getComponent(r1Pick)
      if (c1p && c1p.p != null) r1Pick = null
    }

    if (!RELEASE_MODE) {
      uniqDesc('r1Pick', r1Pick)
      uniqDesc('r1Drop', r1Drop)
      uniqDesc('r2Pick', r2Pick)
      uniqDesc('r2Drop', r2Drop)
    }

    // Note that insIn might also be set if the insert is chained.
    let litOut: Doc | undefined
    if (insHere) {
      assert(litIn === undefined)
      litOut = c1d!.i
    } else litOut = litIn

    if (litOut !== undefined) log('litOut', litOut)

    // Will we insert in the output? If so hold the component, and we'll write
    // the insert at the end of this function.
    const insComponent = (pick2Slot == null
      ? (insHere && !rmParent && !rmHere)
      : litOut !== undefined
    ) ? wd.getComponent() : null

    if (insComponent) log('insComponent',
        (insHere && !rmParent && !rmHere && pick2Slot == null),
        (pick2Slot != null && litOut !== undefined))
    else log('no insComponent - this insert will be discarded',
      (insHere && !rmParent && !rmHere && pick2Slot == null),
      (pick2Slot != null && litOut !== undefined)
    )


    if (pick2Slot != null) {
      // ....
      if (litIn !== undefined || insHere) {
        // Move the literal.
      } else {
        // If we pick here and drop here, join the two moves at the hip.
        // TODO(cleanup): ... Can't we insert this immediately in the block
        // above where we write the drop?
        const slot = drop1Slot != null ? p1SlotMap[drop1Slot] : nextSlot++

        p2SlotMap[pick2Slot] = slot
        log('assigning slot', slot, 'to op2 slot', drop1Slot)
        wp.write('p', slot)
      }
    } else if (rmHere) {
      if (!insHere && litIn === undefined) {
        log('keeping write here r=', c2p!.r)
        wp.write('r', c2p!.r)
      }
    }

    // Edits!
    //
    // For edits, we basically want to grab the edit at r1Drop and r2Drop and
    // just compose them together into the output.
    const type1 = !rmChildren ? getEditType(c1d) : null
    const type2 = getEditType(c2d)

    log('components', c1d, c2d)
    if (type1 || type2) log('types', type1 && type1.name, type2 && type2.name)

    if (type1 && type2) {
      assert(type1 === type2)
      // Compose.
      const e1 = getEdit(c1d!)
      const e2 = getEdit(c2d!)
      const r = type1.compose(e1, e2)
      log('compose ->', r)
      // Only write if its not a no-op.
      writeEdit(wd, type1, r)
      visitedOp2EditCs.add(c2d!)
    } else if (type1) {
      log('copying edit type1', c1d)
      writeEdit(wd, type1, getEdit(c1d!))
    } else if (type2) {
      log('copying edit type2', c2d)
      writeEdit(wd, type2, getEdit(c2d!))
      visitedOp2EditCs.add(c2d!)
    }

    // We follow strict immutability semantics, so we have to clone the insert
    // if it gets modified. We'll only clone the object literal if we have to.
    const hasContainerLiteral = typeof litOut === 'object' && litOut != null

    let isCloned = false

    let p1PickOff = 0, p1DropOff = 0
    let p2PickOff = 0, p2DropOff = 0
    let litOff = 0

    const p2DropAdv = advancer(r2Drop,
      (k, c) => hasDrop(c) ? (p2DropOff - k - 1) : k - p2DropOff,
      (k, c) => { if (hasDrop(c)) p2DropOff++ })

    const p1PickAdv = advancer(r1Pick,
      (k, c) => hasPick(c) ? (p1PickOff - k - 1) : k - p1PickOff,
      (k, c) => { if (hasPick(c)) p1PickOff++ })

    eachChildOf(r1Drop, r2Pick, (inKey, _p1Drop, _p2Pick) => {
      // The key we've been passed is the context between the two operations.
      // We need to transform it to each of the starting (p1 pick) context and
      // final (p2 drop) contexts.
      let p1PickKey = inKey, p2DropKey = inKey, litKey = inKey
      let _p1Pick, _p2Drop

      if (typeof inKey === 'number') {
        let p2Mid = inKey + p2PickOff
        _p2Drop = p2DropAdv(p2Mid)
        p2DropKey = p2Mid + p2DropOff

        let p1Mid = inKey + p1DropOff
        _p1Pick = p1PickAdv(p1Mid)
        if (hasDrop(getComponent(_p2Drop))) _p1Pick = null // But still advance!
        p1PickKey = p1Mid + p1PickOff

        // If the literal is an array, we're modifying that array as we go.
        litKey = inKey + litOff

        log('p1PickOff', p1PickOff, 'p1DropOff', p1DropOff,
          'p2PickOff', p2PickOff, 'p2DropOff', p2DropOff,
          'litOff', litOff)
        log('inKey', inKey, '-> p1 mid', p1Mid, '-> p1 final', p1PickKey)
        log('inKey', inKey, '-> p2 mid', p2Mid, '-> p2 final', p2DropKey)

        assert(p1PickKey >= 0, 'p1PickKey is negative')
        assert(p2DropKey >= 0, 'p2DropKey is negative')

        // Update these keys as we move past. This will be used for subsequent
        // descents, but not this one.
        const hd1 = hasDrop(getComponent(_p1Drop))
        const hp2 = hasPick(getComponent(_p2Pick))
        if (hd1 || (hp2 && !rmChildren)) litOff--
        if (hd1) p1DropOff--
        if (hp2) p2PickOff--
      } else {
        _p1Pick = p1PickAdv(inKey)
        _p2Drop = p2DropAdv(inKey)
      }

      log('->', 'p1pick', p1PickKey, 'inkey', inKey, 'p2drop', p2DropKey, 'litKey', litKey)
      wp.descend(p1PickKey)
      wd.descend(p2DropKey)

      // TODO: Check litOut matches expected shape here using isValidKey
      const _lit = hasContainerLiteral && !hasDrop(getComponent(_p1Drop))
        ? (litOut as any)[litKey] : undefined

      log('_lit', _lit, litOut, litKey)
      const _litResult = xfBoundary(_p1Pick, _p1Drop, _p2Pick, _p2Drop,
        _lit, rmChildren, wd, wp)

      if (hasContainerLiteral && !rmChildren) {
        log('_litResult', _litResult)
        if (_lit !== _litResult) {
          if (!isCloned) {
            litOut = Array.isArray(litOut)
              ? litOut.slice() : Object.assign({}, litOut)
            isCloned = true
          }

          setOrRemoveChild(litOut as Doc[] | DocObj, litKey, _litResult)
          log('litOut ->', litOut)
        }
      } else assert(_litResult === undefined)

      wd.ascend()
      wp.ascend()
    })
    p1PickAdv.end()
    p2DropAdv.end()

    decPrefix()

    // Ok, the cases:
    // - If there's a literal here, write the literal and return nothing.
    // - If there's a lit in and a literal, write literal, return lit in.
    // - If there's a literal here and a pick, the literal got taken by the
    //   pick. Return litIn.
    // - If there's a litIn and a pick, the litIn got taken by the pick. Return
    //   undefined.
    // - If there's a literal, a lit in and a pick (all 3), the pick takes the
    //   literal and we return the lit in.
    if (insComponent != null) {
      insComponent.i = litOut
      // litOut = litIn
      //log('a', litIn)
    } else if (!rmParent && !rmHere && pick2Slot == null) {
      //log('b', litOut)
      return litOut
    }
  }


  const w2 = writeCursor()
  xfBoundary(r1, r1.clone(), r2, r2.clone(), undefined, false, w, w2)

  w.reset()
  w.mergeTree(w2.get())
  w.reset()

  log('intermediate op', w.get())
  log('heldPickWrites', heldPickWrites.map(w => w.get()))
  log('heldDropWrites', heldDropWrites.map(w => w.get()))

  // Ok, now we need to walk along the picks and copy them in.
  
  // Write op1 picks
  r1.traverse(w, (c, w) => {
    const slot1 = c.p
    if (slot1 != null) {
      // TODO: Cancelled moves seems redundant all of a sudden.
      const slot = p1SlotMap[slot1]
      if (slot != null) {
        log('writing pick slot', slot)
        w.write('p', slot)
      }
      const _w = heldPickWrites[slot1]
      if (_w) log('merge pick write', _w.get())
      if (_w) w.mergeTree(_w.get())
    } else if (c.r !== undefined) {
      w.write('r', c.r)
    }
  })
  
  w.reset()
  log('intermediate op with picks', w.get())

  // Write op2 drops
  r2.traverse(w, (c, w) => {
    const slot2 = c.d
    if (slot2 != null) {
      const slot = p2SlotMap[slot2]
      if (slot != null) {
        w.write('d', slot)
      }
      const _w = heldDropWrites[slot2]
      if (_w) w.mergeTree(_w.get())
    } else if (c.i !== undefined) {
      w.write('i', c.i)
    }

    // xfBoundary above will copy any composed edits in. But we also need to
    // copy any edits in op2 which aren't at the boundary.
    const t = getEditType(c)
    if (t && !visitedOp2EditCs.has(c)) {
      writeEdit(w, t, getEdit(c))
    }
  })


  const result = w.get()
  log('-> compose returning', result)

  if (!RELEASE_MODE) checkValidOp(result)
  return result
}

// ***** Invert



/**
 * Invert the given operation. Operation must be invertible - which is to say,
 * all removes in the operation must contain all removed content. Note any
 * operation returned from transform() and compose() will have this content
 * stripped.
 *
 * Unless you know what you're doing, I highly recommend calling invertWithDoc()
 * instead.
 */
function invert(op: JSONOp): JSONOp {
  // This is pretty simple:
  // - All r -> i, i -> r
  // - d -> p, p -> d. (Although note this may make the slot order
  //   non-canonical.)
  // - And edits (unfortunately) need to be reverse-transformed by the
  //   operation.
  //
  // WIP: This implementation is not correct yet. Inserts also need to be
  // modified by the operation's embedded edits. This does not currently work
  // correctly.

  if (op == null) return null

  const r = new ReadCursor(op)
  const w = new WriteCursor()

  // let hasEdit = false // We'll only do the second edit pass if this is true.
  
  // I could just duplicate the logic for deciding which edits need to be
  // inspected in the second pass, but its much simpler to just mark the
  // components in the read.
  let editsToTransform: undefined | Set<JSONOpComponent>

  const heldPick: ReadCursor[] = []
  const heldWrites: WriteCursor[] = []

  log('inverting', op)

  // There's a few goals for this first traversal:
  // - For any edits inside an insert, bake the edit
  // - Decide if there are embedded edits we need to reverse-transform to the pick site
  // - For picks and drops, simply rewrite them.
  //
  // Note subDoc is always in drop context (in the original document).
  function invertSimple(r: ReadCursor, w: WriteCursor, subDoc: Doc | undefined) {
    if (!RELEASE_MODE) log('invertSimple', r.getPath(), subDoc)
    incPrefix()
    const c = r.getComponent()
    let insertHere, subdocModified = false

    if (c) {
      // TODO: Consider using a slot map so invert returns the same operations as
      // normalize().
      if (c.p != null) {
        w.write('d', c.p) // p -> d
        heldPick[c.p] = r.clone()
      }
      if (c.r !== undefined) w.write('i', c.r) // r -> i
  
      if (c.d != null) {
        w.write('p', c.d) // d -> p
        subDoc = undefined
      }
      if (c.i !== undefined) {
        // If subdoc is set (not undefined), we're either an insert or a direct
        // child of an insert. In this case this method will return either
        // undefined (no change to the insert) or it will return the updated
        // insert child. We ripple up in this case making shallow copies and
        // replace the remove with that.
        subDoc = insertHere = c.i // i -> r, written out below.
      }

      const t = getEditType(c)
      if (t) {
        log('found edit', c, subDoc)
        if (subDoc === undefined) {
          if (!editsToTransform) editsToTransform = new Set()
          editsToTransform.add(c)
        } else {
          // Mark that we want to modify the subdoc with the edit. There's a
          // potential corner case where the operation has an edit, and then
          // inside the edited content we do a drop / insert. But this is
          // invalid, so I'm not going to worry too much about it here. Ideally
          // checkOp should pick that sort of thing up.
          log('baking edit into subDoc', subDoc, getEdit(c))
          subDoc = t.apply(subDoc, getEdit(c))
          subdocModified = true
        }
      }
    }

    // This is to handle drops / inserts while we're inside an insert, to access
    // indexes correctly in subDoc.
    let dropOff = 0

    for (const key of r) {
      w.descend(key)

      const raw = typeof key === 'number' ? key - dropOff : key
      const childIn = maybeGetChild(subDoc, raw)
      // childOut is undefined if either we aren't in an insert or the subdoc wasn't mutated.
      if (hasDrop(r.getComponent())) dropOff++

      const childOut = invertSimple(r, w, childIn)
      log('key', key, 'raw', raw, childIn, childOut, 'subdoc', subDoc)
      // TODO: subDoc !== undefined check here might be redundant.
      if (subDoc !== undefined && childOut !== undefined) {
        if (!subdocModified) {
          subdocModified = true
          // And shallow clone
          subDoc = shallowClone(subDoc)
        }
        if (!isValidKey(subDoc, raw)) throw Error('Cannot modify child - invalid operation')
        ;(subDoc as any)[raw] = childOut
      }

      w.ascend()
    }

    decPrefix()
    if (insertHere !== undefined) {
      w.write('r', subDoc)
    } else {
      return subdocModified ? subDoc : undefined
    }
  }

  invertSimple(r, w, undefined)
  if (!RELEASE_MODE) log('invert after pass 1', w.get())

  if (editsToTransform) {
    // Ok, we need to reverse-transform the edit here by the operation. We're
    // traversing in the drop context (so rDrop is never null) but we also need
    // to know the pick context to be able to fix indexes.
    //
    // w is in the pick context.
    function transformEdits(rPick: ReadCursor | null, rDrop: ReadCursor, w: WriteCursor) {
      if (!RELEASE_MODE) log('invXE', rPick?.getPath(), rDrop.getPath(), w.getPath())
      incPrefix()

      const cd = rDrop.getComponent()
      if (cd) {
        const dropSlot = cd.d
        if (dropSlot != null) {
          log('teleporting to drop slot', dropSlot)
          rPick = heldPick[dropSlot]
          w = heldWrites[dropSlot] = writeCursor()
        }

        if (editsToTransform!.has(cd)) {
          const t = getEditType(cd)!
          // TODO: Add support for types which only have invertWithDoc.
          if (!t.invert) throw Error(`Cannot invert subtype ${t.name}`)
          if (!RELEASE_MODE) log('inverting subtype', t.name, getEdit(cd))
          writeEdit(w, t, t.invert(getEdit(cd)))
        }
      }

      // And recurse.
      let pickOff = 0, dropOff = 0
      const ap = advancer(rPick,
        (k, c) => hasPick(c) ? (pickOff - k - 1) : k - pickOff,
        (k, c) => { if (hasPick(c)) pickOff++ })
  
      for (const key of rDrop) {
        if (typeof key === 'number') {
          const mid = key - dropOff
          const _rPick = ap(mid)
          const raw = mid + pickOff
          log('descend', key, mid, raw, 'dropOff', dropOff, 'pickOff', pickOff)
          w.descend(raw)
          transformEdits(_rPick, rDrop, w)
          if (hasDrop(rDrop.getComponent())) dropOff++
          w.ascend()
        } else {
          w.descend(key)
          const _rPick = ap(key)
          transformEdits(_rPick, rDrop, w)
          w.ascend()
        }
        
      }

      ap.end()
      decPrefix()
    }

    w.reset()
    transformEdits(r.clone(), r, w)
    
    if (heldWrites.length) {
      if (!RELEASE_MODE) log('Merging held writes', heldWrites.map(w => w.get()))
      w.reset()
      
      // Merge held writes
      r.traverse(w, (c, w) => {
        log('traverse', c)
        const slot = c.p
        if (slot != null) {
          log('merging slot', slot)
          const _w = heldWrites[slot]
          if (_w) log('merge', _w.get())
          if (_w) w.mergeTree(_w.get())
        }
      })
    }
  }

  const result = w.get()
  log('-> invert returning:', result)
  if (!RELEASE_MODE) checkValidOp(result)
  return result
}

// Does an operation contain a remove?
const anyComponent = (op: JSONOpList, fn: (c: JSONOpComponent) => boolean): boolean => (
  op.some(c => (
    typeof c === 'object'
      ? (Array.isArray(c) ? anyComponent(c, fn) : fn(c))
      : false
  ))
)

/**
 * Make an operation invertible. (So, you can call invert(op) after this).
 *
 * This is needed because r:XX contents are optional in an operation, and may be
 * optional in subtypes as well. (Eg text-unicode).
 *
 * This method does two main things:
 *
 * - Fills in r:{} bodies in components by copying data in from the document
 * - Recursively calls makeInvertible on any types embedded in the operation.
 *
 * Note transform (and compose?) discards remove information, so if you call
 * transform on an invertible operation you will need to call makeInvertible
 * again before inverting.
 */
function makeInvertible(op: JSONOp, doc: Doc) {
  // Sooo, this method is a bit funny. Its become in many ways a
  // reimplementation of apply(), because it needs to deeply understand how the
  // operation will be overlaid on top of the document. Both functions could
  // easily be merged - although because apply was written much earlier, it
  // doesn't use the cursor utility code. Its also probably a little bit faster
  // as a result.

  log('makeInvertible', op, doc)
  if (op == null || !anyComponent(op, c => (
    c.r !== undefined || getEditType(c)?.makeInvertible != null
  ))) return op

  const r = new ReadCursor(op)
  const w = new WriteCursor()

  // Basically we're going to copy r to w and traverse doc along the way. When
  // we run into r: components we'll clone from doc.

  // TODO: Currently this only shallow clones the removed sections in, which is
  // probably not safe given how people will use this library.

  // Unfortunately this needs to be a lot more complicated for edits. For edits
  // we need to effectively partially unapply / reverse transform the operation
  // to be able to figure out where in the original document the edited content
  // comes from. We'll only run that extra pass if we determine its needed.
  let hasEdits = false
  const heldPick: ReadCursor[] = []
  const heldDoc: Doc[] = []

  const traversePick = (r: ReadCursor, w: WriteCursor, subDoc: Doc | undefined) => {
    if (!RELEASE_MODE) log('traversePick', r.getPath(), subDoc)
    incPrefix()
    const c = r.getComponent()
    let modified = false

    if (c) {
      // These two can just be copied directly. Its arguably cleaner to copy
      // them in the second pass, but this is fine.
      if (c.d != null) w.write('d', c.d)
      if (c.i !== undefined) w.write('i', c.i)

      const pickSlot = c.p
      if (pickSlot != null) {
        heldPick[pickSlot] = r.clone() // for second pass.
        assert(subDoc !== undefined, 'Operation picks up at an invalid key')
        heldDoc[pickSlot] = subDoc
        w.write('p', c.p)
      }

      // Copy remove - but deep clone from document
      if (c.r !== undefined) {
        if (subDoc === undefined) throw Error('Invalid doc / op in makeInvertible: removed item missing from doc')
        // Actual remove logic handled after the traversal.
        // w.getComponent()
      }

      // We'll need to run the second pass to find out where in the resulting
      // document this edit will apply.
      const t = getEditType(c)
      if (t) {
        // This feels a little dangerous. If the subtype doesn't need
        // makeInvertible called, we don't need to do the second pass to copy it
        // in... right?
        if (t.makeInvertible) hasEdits = true
        else writeEdit(w, t, getEdit(c), true)
      }
    }

    // There's a tricky problem here. If we're traversing a list and some of the child
    // keys need to be removed from subdoc, we'll mess up the list's order.
    let listOff = 0

    // Recurse to children
    for (const key of r) {
      w.descend(key)

      const keyRaw = typeof key === 'number'
        ? key - listOff
        : key
      const childIn = maybeGetChild(subDoc, keyRaw)
      const childOut = traversePick(r, w, childIn)

      if (childIn !== childOut) {
        log('childOut != childIn', childIn, childOut, key, keyRaw)
        if (!modified) {
          modified = true
          subDoc = shallowClone(subDoc as Doc)
        }

        // removeChild also does a shallow clone, which isn't strictly needed here.
        if (childOut === undefined) {
          subDoc = removeChild(subDoc as any, keyRaw)
          if (typeof key === 'number') listOff++
        } else (subDoc as any)[keyRaw] = childOut
        log('subDoc ->', subDoc)
      }
      w.ascend()
    }

    if (c) {
      if (c.r !== undefined) {
        log('write r', subDoc)

        // Sooo I'm not sure whether we should clone here. The function is
        // correct without the call to clone - but making deep references to
        // parts of the document from the returned operation is risky and error
        // prone. There's probably some neat tricks we could do in this method
        // to avoid the clone here - but I think this a fine solution (since
        // usually removed sections will be small anyway)
        w.write('r', deepClone(subDoc as Doc))
        subDoc = undefined
      } else if (c.p != null) {
        // Its gone somewhere else. Note that anything that was picked up cannot
        // have also been removed, so this is safe.
        subDoc = undefined
      }
    }

    log('tp returning', subDoc)
    decPrefix()
    return subDoc
  }

  traversePick(r, w, doc)
  log('after traversePick', w.get())

  if (hasEdits) {
    w.reset()

    function traverseDrop(rPick: ReadCursor | null, rDrop: ReadCursor,
      w: WriteCursor, subDoc: Doc | undefined, isLiteral: boolean) {

      if (!RELEASE_MODE) log('traverseDrop', rPick?.getPath(), rDrop.getPath(), w.getPath(), subDoc)
      incPrefix()

      const c = rDrop.getComponent()

      if (c) {
        if (c.i !== undefined) {
          subDoc = c.i
          isLiteral = true
          log('using inserted subdoc', subDoc)
        } else if (c.d != null) {
          subDoc = heldDoc[c.d]
          rPick = heldPick[c.d]
          isLiteral = false
          log('teleporting to pick', c.d, subDoc)
        }

        let t = getEditType(c)
        if (t && t.makeInvertible) {
          const edit = getEdit(c)
          log('makeInvertible on child', edit, subDoc)
          writeEdit(w, t, t.makeInvertible(edit, subDoc), true)
        }
      }

      // Recurse.
      let pickOff = 0, dropOff = 0
      const ap = advancer(rPick,
        (k, c) => hasPick(c) ? (pickOff - k - 1) : k - pickOff,
        (k, c) => { if (hasPick(c)) pickOff++ })
  
      for (const key of rDrop) {
        if (typeof key === 'number') {
          const mid = key - dropOff
          const _rPick = ap(mid)
          const raw = mid + pickOff
          log('key', key, 'mid', mid, 'raw', raw, 'isLiteral', isLiteral)

          const child = maybeGetChild(subDoc, isLiteral ? mid : raw)
          w.descend(key)
          traverseDrop(_rPick, rDrop, w, child, isLiteral)
          if (hasDrop(rDrop.getComponent())) dropOff++
          w.ascend()
        } else {
          const child = maybeGetChild(subDoc, key)
          w.descend(key)
          traverseDrop(ap(key), rDrop, w, child, isLiteral)
          w.ascend()
        }
      }

      ap.end()
      decPrefix()
    }

    traverseDrop(r.clone(), r, w, doc, false)
  }

  const result = w.get()
  log('-> makeInvertible returning', result)
  if (!RELEASE_MODE) checkValidOp(result)
  return result
}

/**
 * Invert the given operation in the context of the passed document. The
 * specified document must be the document *before* the operation has been
 * applied.
 */
function invertWithDoc(op: JSONOp, doc: Doc) {
  return invert(makeInvertible(op, doc))
}

// ***** Transform

const LEFT = 0, RIGHT = 1

// This makes a shallow clone of an operation so a reader can read a partially
// written operation. The components aren't copied - which means we don't deep
// copy any inserted objects, and the components can be edited directly, which
// is a bit of a hack that transform takes advantage of.
const shallowCloneOp = (op: JSONOp) => {
  if (op == null) return null
  const result = op.slice()
  for (let i = 0; i < op.length; i++) {
    const c = result[i]
    if (Array.isArray(c)) result[i] = shallowCloneOp(c) as JSONOpList
  }
  return result
}



// Returns {ok: bool, result or conflicts}. Conflicts should be symmetric -
// transform(a, b, left) should generate the same list of conflicts as
// transform(b, a, right). But obviously with path1 and path2 swapped.
//
// To keep this function as simple as possible, we bail once we find
// conflicts. Thus running this method a single time does *not* find all
// conflicts in the two operations. I could write a version of this method
// which had that behaviour, but I don't see the point. Most operations are
// simple and conflicts are rare.
//
// Conflicts have {type, op1: (slice), op2: (slice)}.
function tryTransform(op1: JSONOp, op2: JSONOp, direction: 'left' | 'right'): {
  ok: true, result: JSONOp
} | {
  ok: false, conflict: Conflict
} {
  assert(direction === 'left' || direction === 'right', 'Direction must be left or right')
  const side = direction === 'left' ? LEFT : RIGHT
  ;(log as any).quiet = !debugMode
  ;(log as any).prefix = 0

  if (op2 == null) return {ok:true, result:op1}

  if (!RELEASE_MODE && debugMode) {
    log("transforming " + direction + ":")
    log('op1', op1)
    log('op2', op2)

    log(`repro: transform(${[op1, op2, direction].map(x => JSON.stringify(x)).join(', ')})`) 
  }

  checkValidOp(op1)
  checkValidOp(op2)

  // This is for debugging, to verify that we only descend once.
  const uniqPaths: {[k: string]: Set<string>} = {} // key -> set<string>
  const uniqDesc = (key: string, reader?: ReadCursor | null) => {
    if (reader == null) return
    if (uniqPaths[key] == null) uniqPaths[key] = new Set()

    // log('uniqDesc', key, reader.getPath())
    const path = reader.getPath().map((k,i) => `${i}:${k}`).join('.')
    if (uniqPaths[key].has(path)) throw Error(`non-unique descent: ${key} ${path}`)
    uniqPaths[key].add(path)
  }

  // Transform is a super fun function to write.
  //
  // Semantically, we have 4 mini operations between the two ops:
  // - op1 picks
  // - op1 drops
  //
  // - op2 picks
  // - op2 drops
  //
  // And we generate two more mini operations:
  // - result picks
  // - result drops
  //
  // You can consider each of the mini operations to live in one of these contexts:
  //
  // - The context of the original document (which op1 picks and op2 picks live in)
  // - The context of after op1 has been applied (op1 drops)
  // - The context of after op2 has been applied (op2 drops, resulting op picks)
  // - And the resulting document context (resulting op drops)
  //
  // There's effectively 2 transformations that have to take place:
  // 1. op1's picks. Effectively, this needs to be transformed by [op2 pick,
  // op2 drop].
  // 2. op1's drops. This is where it gets fun. Because the positions in op1's
  // drops track positions already modified by op1's picks, we need to figure
  // out where they *would* be without op1's drops. Then transform through
  // op2's picks and drops, and finally transform by the resulting picks to get
  // the final drop locations.
  //
  // We do this work in several steps:
  // - Scan op2 picks
  // - Scan op2 drops
  // - Scan op1 picks. Transform by op2 and write into result
  // - Scan op1 drops. Transform back by op1 picks, by op2, then by op1 picks
  // again. Write into result.
  // - Scan op2 drops again in their native context, writing removes when op2
  // is dropped.
  // - Scan op2 drops a final time, transforming into the resulting document.
  // Write any contents of op1 that was transformed by an op2 move.

  let conflict: null | Conflict = null

  // These arrays hold read cursors into the op1 picks & op2 drops so we can
  // read the right value through teleporting, and so we can reconstruct paths
  // for conflicts.

  // TODO: Actually some of these aren't sparse, but filled to the brim by the
  // time we read them.
  type SparseRCList = (ReadCursor | null)[]
  const heldOp1PickByOp1: ReadCursor[] = []
  const heldOp1DropByOp1: SparseRCList = []
  
  const heldOp2PickByOp2: SparseRCList = [] // Used in scanOp2Drop
  const heldOp2DropByOp2: SparseRCList = [] // Used in writeOp1Pick

  const heldOp1PickByOp2: SparseRCList = []

  const heldOp2PickByOp1: SparseRCList = [] // Used in writeOp1Drop
  const heldOp2DropByOp1: ReadCursor[] = [] // Used in writeOp1Drop

  const heldOp2RmForOp1: SparseRCList = [] // held op1 read cursor to a remove of a slot2.

  // TODO(cleanup): Consider just storing the path instead of the read cursor
  const heldOp1RmForOp2: SparseRCList = [] // Set to the remove op if cancelledOp2 is set

  // Map from op2's slots -> true if op2 is moving an object out of a location
  // that op1 removes. In this case we need to add a remove at op2's
  // destination.
  // TODO(cleanup): Can I remove cancelledOp2 and just use heldOp1RmForOp2?
  const cancelledOp2: (true | undefined)[] = []

  // Map from op2 slot -> true if op2's drop destination is removed by op1.
  // This is used to discard some removes in the output
  const discardedOp2Drop: (true | undefined)[] = []

  // These hold write cursors, indexed by op2 slot numbers. This is used to
  // stage any op1 operations that have been moved by op2. Anything in the
  // designated held write will be written out at the end
  const heldPickWrites: WriteCursor[] = []
  const heldDropWrites: WriteCursor[] = []

  // slot2 number -> slot1 number when both ops pick up the same value.
  const op1PickAtOp2Pick: number[] = []

  // For blackhole detection. Each entry here is a list of op2 drops that the
  // indexing slot1 contains. Consider inverting this.
  const op1PicksOp2DropSlots: number[][] = []

  // const op2MoveContainingOutDrop = [] // indexed by op1 slot. Slot of op2 that moves us

  let nextSlot = 0 // Move slot numbers for the output.

  const r1 = readCursor(op1)
  const r2 = readCursor(op2)
  const w = writeCursor() // Output.

  // ---------------------------------------------------------------------
  // Before anything else we need to do a preliminary scan of op2's pick for
  // bookkeeping, marking:
  // - op2 moves of items which op1 has removed
  // - shared pickup locations between the two ops.
  //
  // This scan is in the context of the original doc.
  function scanOp2Pick(r2Pick: ReadCursor, r1Pick: ReadCursor | null = null, removed1: ReadCursor | null) { // r1Pick might be null.
    if (!RELEASE_MODE) log('scanOp2Pick', 'r1Pick', r1Pick && r1Pick.getPath(), 'r2Pick', r2Pick.getPath(), 'removed1:', removed1 && removed1.getPath())
    incPrefix()

    const c1 = getComponent(r1Pick)
    if (c1) {
      if (c1.r !== undefined) removed1 = r1Pick!.clone()
      else if (c1.p != null) {
        removed1 = null
        heldOp2PickByOp1[c1.p] = r2Pick.clone()
      }
    }

    const c2 = r2Pick.getComponent()
    let slot2
    if (c2 && ((slot2 = c2.p) != null)) {
      log('c2', c2, 'rm', !!removed1)
      // log(slot2, c1, c2)
      heldOp1PickByOp2[slot2] = r1Pick ? r1Pick.clone() : null
      heldOp2PickByOp2[slot2] = r2Pick.clone()
      if (removed1) {
        // op1 removes something op2 picks up in slot2.
        cancelledOp2[slot2] = true
        heldOp1RmForOp2[slot2] = removed1
        log('Cancelled op2 slot', slot2)
      }

      // If this happens it means both operations picked up the same element.
      // One operation's move will be cancelled based on symmetry.
      if (c1 && c1.p != null) op1PickAtOp2Pick[slot2] = c1.p
    }

    // ... And recurse.
    const ap1 = advancer(r1Pick)
    for (const key of r2Pick) {
      log('->', key)
      scanOp2Pick(r2Pick, ap1(key), removed1)
    }
    ap1.end()

    decPrefix()
  }

  scanOp2Pick(r2, r1, null)

  if (!RELEASE_MODE) {
    log('op1PickAtOp2Pick', op1PickAtOp2Pick)
    log('cancelledOp2', cancelledOp2)
    log('held op2 pick', heldOp2PickByOp1.map(x => !!x))
  }

  // ---------------------------------------------------------------------
  // This traverses op2's drop locations for bookkeeping, marking:
  // - Fetch a (cloned) read cursor at each op2 drop location
  // - Any drops which have been moved into something that was deleted by op1
  function scanOp2Drop(
      r1Pick: ReadCursor | null, r2Pick: ReadCursor | null,
      r2Drop: ReadCursor, pickSlot1: number | null, removed1: ReadCursor | null) { // r1Pick, r2Pick could be null.
    if (!RELEASE_MODE) log('scanOp2Drop',
      'r1Pick', r1Pick && r1Pick.getPath(), r2Pick && r2Pick.getPath(), 'r2Drop', r2Drop.getPath(),
      'pickSlot1', pickSlot1, 'removed:', removed1 && removed1.getPath())
    incPrefix()

    const c2d = r2Drop.getComponent()
    let droppedHere = false

    let slot2
    if (c2d) {
      if (((slot2 = c2d.d) != null)) {
        // Clone the read cursor so we can come back here later.
        heldOp2DropByOp2[slot2] = r2Drop.clone()

        if (pickSlot1 != null) {
          if (op1PicksOp2DropSlots[pickSlot1] == null) op1PicksOp2DropSlots[pickSlot1] = []
          // op1PicksOp2DropSlots[slot2] = pickSlot1 //pickSlot1.length ? pickSlot1.slice() : null
          op1PicksOp2DropSlots[pickSlot1].push(slot2)
        }

        // Teleport r2Pick
        log('tele r2Pick to op2 slot2', slot2, !!cancelledOp2[slot2])
        r1Pick = heldOp1PickByOp2[slot2] || null
        r2Pick = heldOp2PickByOp2[slot2] || null // TODO: Or are these always set here?

        if (cancelledOp2[slot2]) {
          if (removed1) discardedOp2Drop[slot2] = true
          removed1 = heldOp1RmForOp2[slot2] || null
        } else if (removed1 && (side === RIGHT || op1PickAtOp2Pick[slot2] == null)) {
          // We have a write conflict.
          log('conflicting op2 move because drop destination removed', slot2)
          if (!RELEASE_MODE) log('path', r2Drop.getPath(), r2Pick!.getPath())
          if (conflict == null) conflict = {
            type: ConflictType.RM_UNEXPECTED_CONTENT,
            op1: removeOp(removed1.getPath()),
            op2: moveOp(r2Pick!.getPath(), r2Drop.getPath())
          }
        }

        droppedHere = true
      } else if (c2d.i !== undefined) {
        // if (r1Pick != null || r2Pick != null) debugger
        // assert(r1Pick == null && r2Pick == null)
        r1Pick = r2Pick = null
        droppedHere = true

        if (removed1) {
          // TODO: It'd be nice to merge this with the conflict raise above
          log('Conflicting op2 drop because op1 remove')
          if (conflict == null) conflict = {
            type: ConflictType.RM_UNEXPECTED_CONTENT,
            op1: removeOp(removed1.getPath()),
            op2: insertOp(r2Drop.getPath(), c2d.i)
          }
        }
      }
    }

    const c1p = getComponent(r1Pick)
    if (c1p) {
      if (c1p.r !== undefined) removed1 = r1Pick!.clone()
      else if (c1p.p != null) {
        log('Marking pickSlot1', c1p.p)
        // pickSlot1.push(c1p.p)
        pickSlot1 = c1p.p
        removed1 = null
      }
    }

    const t2 = getEditType(c2d)
    if (t2 && removed1) {
      // TODO(cleanup): Merge this with the big block above if I can. Might be
      // able to move the code rewriting removed1 to the top of the function.
      log('rm / edit conflict')
      if (conflict == null) conflict = {
        type: ConflictType.RM_UNEXPECTED_CONTENT,
        op1: removeOp(removed1.getPath()),
        op2: editOp(r2Drop.getPath(), t2, getEdit(c2d!), true),
      }
    }

    // And recurse...
    let p2PickOff = 0, p2DropOff = 0
    const ap2 = advancer(r2Pick,
      (k, c) => hasPick(c) ? (p2PickOff - k - 1) : k - p2PickOff,
      (k, c) => { if (hasPick(c)) p2PickOff++ })

    // This is trivial since it matches the pick2 context.
    const ap1 = advancer(r1Pick)

    for (const key of r2Drop) {
      log('key ->', key)
      if (typeof key === 'number') {

        const p2Mid = key - p2DropOff
        log('p2Mid', p2Mid)
        const _p2Pick = ap2(p2Mid)
        const raw = p2Mid + p2PickOff
        log('raw', raw)
        const _p1Pick = ap1(raw)

        log('key', key, 'p2DropOff', p2DropOff, 'p2PickOff', p2PickOff)
        log('-> p2drop', key, 'p2Mid', p2Mid, !!_p2Pick, 'raw', raw, !!_p1Pick)
        
        p2DropOff += +scanOp2Drop(_p1Pick, _p2Pick, r2Drop, pickSlot1, removed1)
      } else {
        log('-> k', key)

        const _p2Pick = ap2(key)
        const _p1Pick = ap1(key)
        scanOp2Drop(_p1Pick, _p2Pick, r2Drop, pickSlot1, removed1)
      }
    }

    ap2.end()
    ap1.end()
    decPrefix()

    // if (c1p && c1p.p != null) pickSlot1.pop()

    return droppedHere
  }

  scanOp2Drop(r1, r2, r2.clone(), null, null)
  log('held op2 drop', heldOp2DropByOp2.map(x => x && x.get()))
  if (conflict) {
    log('returning conflict 4', conflict)
    return {ok:false, conflict}
  }
  log('discarded op2 drop', discardedOp2Drop.map(x => !!x))

  log('op1PicksOp2DropSlots', op1PicksOp2DropSlots)

  // ---------------------------------------------------------------------

  // We could almost (but not quite) double up on pickComponents and
  // heldOp1PickByOp1 --- heldOp1PickByOp1 shows us the original component, but
  // pickComponents are actually write components, so its no good.
  const pickComponents: (null | JSONOpComponent)[] = []

  let cancelledRemoves: null | Set<JSONOpComponent> = null // Lazy initialized set of components.

  // ==== A brief note on blackholes:
  //
  // We need to look out for instances where the two operations try to mutually
  // move data into the other.
  //
  // This always looks the same:
  // op1 pickup contains an op2 drop as a child
  // op2 pickup contains an op1 drop as a child
  // ... With matching slot numbers.

  // This handles the pick phase of op (r1). Picks and removes in r1Pick are
  // transformed via op2 (r2Pick and r2Drop) and written into writer w.
  //
  // removed tracks op2's removals.
  function writeOp1Pick(
      r1Pick: ReadCursor, r2Pick: ReadCursor | null,
      r2Drop: ReadCursor | null, w: WriteCursor, removed2: ReadCursor | null) {
    if (!RELEASE_MODE) log('writeOp1Pick', 'r1Pick', r1Pick.getPath(), 'r2Pick', r2Pick && r2Pick.getPath(), 
      'r2Drop', r2Drop && r2Drop.getPath(),
      'w', w.getPath(),
      'removed2', removed2 && removed2.getPath()
    )
    incPrefix()
    // p1Pick and w are always defined. Either or both of r2Pick and r2Drop
    // could be null.
    let iAmMoved = false

    const c2p = getComponent(r2Pick)
    if (hasPick(c2p)) {
      const slot2 = c2p!.p
      if (slot2 != null) {
        // op2 has moved the item we're descending into. Instead of taking
        // picks from the original (source) location, take them from the
        // destination location.
        if (!RELEASE_MODE) log('teleporting via op2 slot2', slot2, 'to', heldOp2DropByOp2[slot2]!.getPath())

        // This breaks the holding logic. Might still need it though - might
        // need an au naturale version of r2Drop or something?? I'm not sure
        // what this logic should be.
        r2Drop = heldOp2DropByOp2[slot2]!

        w = heldPickWrites[slot2] = writeCursor()
        // TODO: Does w need to be reset here?
        // if (!(w = heldPickWrites[slot2])) w = heldPickWrites[slot2] = writeCursor()
        iAmMoved = true
        removed2 = null
      } else { // op2 is a remove (c2p.r !== undefined)
        // op2 deleted the item we're trying to move.
        r2Drop = null
        removed2 = r2Pick!.clone()
      }
    } else if (hasDrop(getComponent(r2Drop))) {
      r2Drop = null
    }

    // TODO: Could check w as well, but we'd need the destination path
    // including tele somehow.
    if (!RELEASE_MODE) {
      uniqDesc('op1pick r1Pick', r1Pick)
      uniqDesc('op1pick r2Pick', r2Pick)
      uniqDesc('op1pick r2Drop', r2Drop)
    }

    const c1 = r1Pick.getComponent()
    if (c1) {
      const slot1 = c1.p
      if (slot1 != null) {
        if (removed2) heldOp2RmForOp1[slot1] = removed2

        log('considering slot', slot1, 'removed2', !!removed2, 'iAmMoved', iAmMoved)
        if (removed2 || (side === RIGHT && iAmMoved)) {
          log("cancelling p1 move", slot1)
          // A move from a subtree that was removed2 by op2.
          pickComponents[slot1] = null // redundant, but we can check this below.
        } else {
          log('holding pick component')
          // TODO: Consider swapping this back to pickComponents
          pickComponents[slot1] = w.getComponent()//w.clone()
        }

        // This is used by the op2Drop scan, below.
        heldOp1PickByOp1[slot1] = r1Pick.clone()

        // And this is used by writeOp1Drop
        // heldOp2DropByOp1[slot1] = r2Drop ? r2Drop.clone() : null // Wrong for some reason?
        if (r2Drop) heldOp2DropByOp1[slot1] = r2Drop.clone()
      } else if (c1.r !== undefined) {
        // Copy the remove from op1.
        if (!removed2) {
          log('copying remove')
          w.write('r', true) //c1.r
        }

        if (removed2 || iAmMoved) {
          log('Cancelling remove', c1, !!removed2, iAmMoved)
          if (cancelledRemoves == null) cancelledRemoves = new Set
          cancelledRemoves.add(c1)
        }
      }
    }

    // Ok, now to scan the children. We need these offsets to track how array
    // offsets are changed by the transform.
    let p2PickOff = 0, p2DropOff = 0

    // advancer(cursor, listMapFn, listAdvanceFn).
    const ap2Pick = advancer(r2Pick, undefined, (k, c) => {
      if (hasPick(c)) {
        p2PickOff++
        log('r2Pick++', p2PickOff, k, c)
      }
    })
    // ap2Pick._name = '2pick'

    const ap2Drop = advancer(r2Drop, (k, c) => (
      // Sneaking a second bit in here via 2s compliment.
      hasDrop(c) ? ~(k - p2DropOff) : k - p2DropOff
    ), (k, c) => {
      if (hasDrop(c)) {
        p2DropOff++
        log('r2Drop++', p2DropOff, k, c)
      }
    })
    // ap2Drop._name = '2drop'

    log('children', '2p', !!r2Pick, '2d', !!r2Drop)
    if (r1Pick) for (const key of r1Pick) {
      log('-> k', key)
      if (typeof key === 'string') {
        const p2Pick_ = ap2Pick(key)
        const p2Drop_ = ap2Drop(key)

        w.descend(key)
        writeOp1Pick(r1Pick, p2Pick_, p2Drop_, w, removed2)
        w.ascend()
      } else {
        const p2Pick_ = ap2Pick(key)
        const p2Mid = key - p2PickOff
        const p2Drop_ = hasPick(getComponent(p2Pick_)) ? null : ap2Drop(p2Mid)
        const finalKey = p2Mid + p2DropOff

        log("k" + key + " -> m" + p2Mid + " -> f" + finalKey)
        assert(finalKey >= 0)

        w.descend(finalKey)
        writeOp1Pick(r1Pick, p2Pick_, p2Drop_, w, removed2)
        w.ascend()
      }
    }
    ap2Pick.end()
    ap2Drop.end()
    decPrefix()
  }

  log('---- pick ----')
  writeOp1Pick(r1, r2, r2.clone(), w, null)
  w.reset()

  if (!RELEASE_MODE) {
    log('intermediate result', w.get())
    log('held picks', heldOp1PickByOp1.map(x => x.getComponent() || !!x))
    log('held op2 drops by op1', heldOp2DropByOp1.map(x => x.getComponent() || !!x))
    log('held pick writes', heldPickWrites.map(w => w.get()))
    log('pc', pickComponents)
  }

  // ---------------------------------------------------------------------

  // Set of op2 components with an insert or drop which is being overwritten by
  // op1. Initialized lazily. Only used on LEFT.
  // let overwrittenDrops = null

  // Mapping from output move slot -> op1 move slot
  let outputSlotMap: number[] = []

  // Finally the big one. This handles the semantics of op1's drop phase (move
  // drop and insert). This is complicated because the drop phase inside the op
  // is pre-transformed by op1's pick phase, which we have to account for when
  // we're transforming.
  //
  // Removed tracks op2's pick removals.
  function writeOp1Drop(
      p1Pick: ReadCursor | null, p1Drop: ReadCursor,
      p2Pick: ReadCursor | null, p2Drop: ReadCursor | null,
      w: WriteCursor, removed2: ReadCursor | null /*, insidePick2*/) {
    assert(p1Drop)
    const c1d = p1Drop.getComponent()
    if (!RELEASE_MODE) log('drop',
        p1Pick && p1Pick.getPath(), p1Drop.getPath(),
        p2Pick && p2Pick.getPath(), p2Drop && p2Drop.getPath(),
        'c:', c1d, 'r:', !!removed2 /*, 'ip2', insidePick2*/)
    incPrefix()

    let c2d = getComponent(p2Drop) // non-const for teleporting.
    let droppedHere = false

    const insOrMv = (r1: ReadCursor | null, r2: ReadCursor, c: JSONOpComponent) => (
      r1 ? moveOp(r1.getPath(), r2.getPath()) : insertOp(r2.getPath(), c.i)
    )

    // TODO: Reconsider the entire logic of this code block. It seems like
    // there's a bunch of different cases based on what kind of edit we have,
    // whether we conflict and whether the output is identical. There's
    // probably nicer ways to write this.
    if (hasDrop(c1d)) {
      const slot1 = c1d!.d

      // Used to fill blackhole conflict objects
      if (slot1 != null) heldOp1DropByOp1[slot1] = p1Drop.clone()

      // pc is null if the item we're moving was removed by op2 or moved &
      // we're 'right'.
      const pc = slot1 != null ? pickComponents[slot1] : null

      let identical = false

      if (c1d!.i !== undefined || ((slot1 != null) && pc)) {
        // Times to write:
        // - There is no c2 drop
        // - The other drop has been cancelled
        // - We are left (and then we also need to move or remove)
        // If we are identical, skip everything. Neither write nor remove.

        // Doing this with logical statements was too hard. This just sets up
        // some state variables which are used in conditionals below.
        // let write = true
        log('looking to write', c1d, c2d, cancelledOp2)
        let slot2
        if (c2d && (c2d.i !== undefined || ((slot2 = c2d.d) != null && !cancelledOp2[slot2]))) {
          identical = slot2 != null
            ? (slot1 != null) && slot1 === op1PickAtOp2Pick[slot2]
            : deepEqual(c2d.i, c1d!.i)

          // If we're the left op, we can avoid a collision if we're trying to
          // move op2's drop somewhere else.
          if (!identical && (slot2 == null || side === RIGHT || op1PickAtOp2Pick[slot2] == null)) {
            log("Overlapping drop conflict!")

            if (conflict == null) conflict = {
              type: ConflictType.DROP_COLLISION,
              op1: insOrMv(slot1 != null ? heldOp1PickByOp1[slot1] : null, p1Drop, c1d!),
              op2: insOrMv(slot2 != null ? heldOp2PickByOp2[slot2]! : null, p2Drop!, c2d),
            }
          }
        }

        // log('write', write, 'identical', identical, 'removed2', removed2)
        log('write', 'identical', identical, 'removed2', !!removed2)

        if (!identical) {
          if (removed2) {
            log("Drop into remove conflict!")
            // if (pc) pc['r'] = true
            // log(slot1, heldOp1PickByOp1[slot1].getPath())
            if (conflict == null) conflict = {
              type: ConflictType.RM_UNEXPECTED_CONTENT,
              op1: insOrMv(slot1 != null ? heldOp1PickByOp1[slot1] : null, p1Drop, c1d!),
              op2: removeOp(removed2.getPath()),
            }
          } else {
            // Copy the drops.
            if (slot1 != null) {
              log('copying the drop', slot1, 'using new slot', nextSlot)//, 'inside', insidePick2)
              outputSlotMap[nextSlot] = slot1
              // op2MoveContainingOutDrop[nextSlot] = insidePick2
              w.write('d', pc!.p = nextSlot++)
            } else {
              log('copying insert')
              w.write('i', deepClone(c1d!.i)) // TODO: Only clone based on opts.consume.
            }
            droppedHere = true
          }
        }

      } else if ((slot1 != null) && !pc) {
        // pc is null if either slot1 was removed at the source, or if our
        // move has been cancelled because op2 picked it up as well and we're
        // right.

        // I'm not 100% sure this is the right implementation of the logic I want here.
        // TODO: This seems straight out wrong.
        // log('xxxx r2', slot1, !!heldOp2RmForOp1[slot1])
        // removed2 = p2Pick.clone()
        const h = heldOp2RmForOp1[slot1]
        if (h) removed2 = h.clone()
        // else if (!removed2) log('BEHAVIOUR CHANGE')
      }

      if (slot1 != null) {
        log('teleporting p1Pick and op2Pick via op1 slot', slot1)
        p1Pick = heldOp1PickByOp1[slot1]
        p2Pick = heldOp2PickByOp1[slot1]
        p2Drop = heldOp2DropByOp1[slot1] // Note: Potentially overwritten again below.

        if (!RELEASE_MODE) log('p1Pick', p1Pick && p1Pick.getPath(),
          'p2Pick', p2Pick && p2Pick.getPath(),
          'p2Drop', p2Drop && p2Drop.getPath())

      } else if (c1d!.i !== undefined) {
        // We're descending into an edit of an insert. Nobody else speaks to us.
        // 
        // Consider moving this into the identical{} block above.
        p1Pick = p2Pick = null
        if (!identical) p2Drop = null // If identical, we'll merge the p2 child drops.
      // } else if (hasPick(getComponent(p1Pick)) && identical) {
      //   p1Pick = p2Pick = null
      }

    } else if (hasPick(getComponent(p1Pick))) {
      p1Pick = p2Pick = p2Drop = null
    }

    // We can't check this for writes because we teleport & hold the write cursor sometimes.
    // uniqDesc('op1drop write', w)
    if (!RELEASE_MODE) {
      uniqDesc('op1drop op2Pick', p2Pick)
      uniqDesc('op1drop op1Pick', p1Pick)
      uniqDesc('op1drop op1Drop', p1Drop)
    }

    const c1p = getComponent(p1Pick)
    const c2p = getComponent(p2Pick)

    if (hasPick(c2p)) {
      const slot2 = c2p!.p

      if ((c2p!.r !== undefined && (!c1p || c1p.r === undefined)) || cancelledOp2[slot2!]) {
        // In this case the op2 move moves the children *into* something that
        // we've removed in op1. If we both remove the object, then allow my
        // inserts into the resulting output as if the other op didn't remove
        // at all.
        log('flagging remove')
        p2Drop = null
        removed2 = p2Pick!.clone()
      } else if (slot2 != null) {
        // Teleport.
        log('teleporting p2Drop via c2 slot2', slot2)
        p2Drop = heldOp2DropByOp2[slot2]
        // insidePick2 = slot2
        // if (op1PicksOp2DropSlots[slot2] != null) log('inside pick 1', op1PicksOp2DropSlots[slot2])
        if (!RELEASE_MODE) log('p2Drop', p2Drop && p2Drop.getPath())
        if (side === RIGHT || op1PickAtOp2Pick[slot2] == null) {
          log('teleporting write')
          if (!(w = heldDropWrites[slot2])) w = heldDropWrites[slot2] = writeCursor()
          w.reset()
          removed2 = null
        }
      }
    } else if (!hasDrop(c1d) && hasDrop(c2d)) p2Drop = null

    if (!RELEASE_MODE) uniqDesc('op1drop op2Drop', p2Drop)

    // Now we want to read both teleports for the edit component. This is just
    // used for edits at this point, and it takes into account both teleports.
    // I look for your edit in the place *I moved from* and *you moved to*.
    c2d = p2Drop != null ? p2Drop.getComponent() : null

    // Embedded edits of subtrees. This is tricky because the embedded edit
    // needs to be transformed by op2's drop (if any)
    const t1 = getEditType(c1d)
    if (t1) {
      log('edit:', !!removed2, c1d, c2d)
      const e1 = getEdit(c1d!)
      if (!removed2) {
        const t2 = getEditType(c2d)
        let e
        if (t2) {
          // TODO: Should this be t1.name vs t2.name ?
          if (t1 !== t2) throw Error("Transforming incompatible types")
          const e2 = getEdit(c2d!)
          e = t1.transform(e1, e2, direction)
        } else {
          // TODO: ... check opts.consume here.
          e = deepClone(e1)
        }
        log('write edit', e)
        writeEdit(w, t1, e)

        //writeEdit(w, t1, getEdit(c1d))
      } else {
        // The embedded edit is trying to edit something that has been removed
        // by op2.
        //
        // This branch also triggers if the embedded edit is a no-op. I'm not
        // sure what the expected behaviour should be in this case, because both
        // options are bad:
        // - We can return `null` as op1, even though this wouldn't trigger the
        //   conflict if we re-ran transform on the returned result
        // - We preserve the no-op in the conflict, returning a non-normalized
        //   result (current behaviour)
        if (conflict == null) conflict = {
          type: ConflictType.RM_UNEXPECTED_CONTENT,
          op1: editOp(p1Drop.getPath(), t1, e1, true),
          op2: removeOp(removed2.getPath()),
        }
      }
    }

    // Ok, now for descent crazy town. This is all needed to deal with keeping
    // track of the indexes of list children.
    let p1PickOff = 0, p1DropOff = 0
    let p2PickOff = 0, p2DropOff = 0
    let outPickOff = 0, outDropOff = 0

    let p1pValid = p1Pick != null ? p1Pick.descendFirst() : false
    let p1pDidDescend = p1pValid

    const ap2p = advancer(p2Pick, undefined, (k, c) => {
      // Spoilers: There's going to be more logic here before this is correct.
      // Probably also need to take into account op1PickAtOp2Pick.
      // if (c && (c.r !== undefined || (c.p != null && !cancelledOp2[c.p]))) {
      if (hasPick(c)) {
        p2PickOff++
        log('p2Pick++', p2PickOff, k, c)
      }
    })
    // ap2p._name = '2p'

    // I'm only using one advancer here because it was too hard tracing bugs
    // through two advancers. Simply using bare variables & advancing here
    // results in more code, but its slightly more straightforward because all
    // the state variables are local.

    let p2dValid = p2Drop != null ? p2Drop.descendFirst() : false
    let p2dDidDescend = p2dValid

    log('children.', '1p:', !!p1Pick, '1d:', !!p1Drop, '2p:', !!p2Pick)

    for (const key of p1Drop) {
      log('-> p1Drop looking at child', key)
      // Ok... time for crazy.
      if (typeof key === 'number') {
        // *********** Array children.

        let _p1Pick
        log('p1DropEachChild k:', key,
          'p1d:', p1DropOff, 'p1p:', p1PickOff, 'raw: -',
          'p2p:', p2PickOff, 'p2d:', p2DropOff,
          'op:', outPickOff, 'od:', outDropOff)

        const hd1 = hasDrop(p1Drop.getComponent())

        const k1Mid = key - p1DropOff // Position between pick and drop phase

        { // Calculate _p1Pick and outPickOff
          let p1k
          log('Looking for p2 Pick at k1Mid', k1Mid)
          incPrefix()
          while (p1pValid && typeof (p1k = p1Pick!.getKey()) === 'number') {
            p1k += p1PickOff
            const c = p1Pick!.getComponent()!
            const hp = hasPick(c)
            log('p1k', p1k, 'k1mid', k1Mid, 'hp', hp)

            if (p1k > k1Mid || (p1k === k1Mid && (!hp || (side === LEFT && hd1)))) break
            // break if p1k === k1Mid and hd1
            // increment if p2k < k1Mid

            if (hp) {
              log('p1PickOff--')
              p1PickOff--

              // We want to increment outPickOff if a pick is going to appear
              // here in the output. That means sort of reimplementing the
              // logic above :(
              const slot1 = c.p
              log('considering outPickOff--', c, cancelledRemoves, pickComponents[slot1!], op1PickAtOp2Pick.includes(slot1!))
              log(c.d != null, getComponent(heldDropWrites[c.d!]), hasPick(getComponent(heldDropWrites[c.d!])))

              // TODO: This looks wrong - we aren't taking into account identical pick/drop.
              if ((c.r !== undefined && (!cancelledRemoves || !cancelledRemoves.has(c)))
                  || (slot1 != null && pickComponents[slot1] && (side === RIGHT || !op1PickAtOp2Pick.includes(slot1)))) {
                log('outPickOff-- from pickup')
                outPickOff--
              }
            }
            p1pValid = p1Pick!.nextSibling()
          }
          _p1Pick = p1pValid && p1k === k1Mid ? p1Pick : null
          decPrefix()
          log('_p1Pick', !!_p1Pick)
        }

        const raw = k1Mid - p1PickOff // Position of the child before op1 has changed it
        log('ap2p', raw)
        let _p2Pick = ap2p(raw) // Advances p2PickOff.
        log('_p2Pick', !!_p2Pick, 'p2PickOff', p2PickOff)

        const k2Mid = raw - p2PickOff

        let _p2Drop: ReadCursor | null = null
        { // Calculate _p2Drop.
          let p2dk, op2Mid
          log('Looking for p2 Drop at p2mid', k2Mid)
          incPrefix()
          while (p2dValid && typeof (p2dk = p2Drop!.getKey()) === 'number') {
            op2Mid = p2dk - p2DropOff
            const c = p2Drop!.getComponent()!
            const hd2 = hasDrop(c)
            log('p2d looking at child', p2dk, c, 'at op2mid', op2Mid, 'target', k2Mid,
              '  / raw', raw, p2DropOff, hd2, hd1)

            if (op2Mid > k2Mid) break

            if (op2Mid === k2Mid) {
              if (hd2) {
                if (side === LEFT && hd1) {
                  _p2Drop = p2Drop!
                  break
                }

                // I'm not convinced this logic is correct.. :/
                // log('hp2 break', _p2Pick && hasPick(_p2Pick.getComponent())
                const hp2 = _p2Pick && hasPick(_p2Pick.getComponent())
                if (side === LEFT && hp2) break
              } else {
                _p2Drop = p2Drop!
                break
              }
            }

            // log('p2d continuing')

            if (hd2) {
              // Ugh to reimplementing the logic of figuring out where we'll keep picks
              const slot2 = c.d!
              log('considering p2Drop', c, slot2, cancelledOp2[slot2], op1PickAtOp2Pick[slot2])
              if (c.i !== undefined
                  || (!cancelledOp2[slot2] && ((op1PickAtOp2Pick[slot2] == null) || side === RIGHT))) {
                log('p2DropOff++ from drop')
                p2DropOff++
              } else if (cancelledOp2[slot2] || (op1PickAtOp2Pick[slot2] != null && side === LEFT)) {
                // Skip it, but this drop won't appear in the output either so ignore it.
                log('skipped because the drop was cancelled')
                p2DropOff++
                outDropOff--
              }

              // log('p2Drop++', p2DropOff, op2Mid, c)
            }
            p2dValid = p2Drop!.nextSibling()
          }
          //_p2Drop = p2dValid && op2Mid === k2Mid ? p2Drop : null
          decPrefix()
          log('_p2Drop', !!_p2Drop)
        }

        const k2Final = k2Mid + p2DropOff

        log('->DropEachChild k:', key,
          'p1d:', p1DropOff, 'p1p:', p1PickOff, 'raw:', raw,
          'p2p:', p2PickOff, 'p2d:', p2DropOff,
          'op:', outPickOff, 'od:', outDropOff)

        const descend = k2Final + outPickOff + outDropOff

        log("k: " + key + " -> mid " + k1Mid
          + " -> raw " + raw
          + " -> k2Mid " + k2Mid + " -> k2Final " + k2Final
          + " -> descend " + descend)

        assert(descend >= 0, 'trying to descend to a negative index')
        w.descend(descend)

        if (hd1) {
          // If op1 is dropping here, we'll insert a new item in the list.
          // Because op2 doesn't know about the new item yet, there's nothing
          // we need to transform the drop against.
          _p1Pick = _p2Pick = _p2Drop = null
          log('omg p1dropoff', p1DropOff)
          p1DropOff++
        }

        if (writeOp1Drop(_p1Pick, p1Drop, _p2Pick, _p2Drop, w, removed2)) outDropOff++
        w.ascend()

      } else { // String keys - descending from an object.
        let p1k
        while (p1pValid) { // Skip items in p1Pick until key
          p1k = p1Pick!.getKey()
          if (typeof p1k === 'string' && (p1k > key || p1k === key)) break
          p1pValid = p1Pick!.nextSibling()
        }
        const _p1Pick = (p1pValid && p1k === key) ? p1Pick : null
        const _p2Pick = ap2p(key)

        let p2dk
        while (p2dValid) {
          p2dk = p2Drop!.getKey()
          if (typeof p2dk === 'string' && (p2dk > key || p2dk === key)) break
          p2dValid = p2Drop!.nextSibling()
        }
        const _p2Drop = p2dValid && p2dk === key ? p2Drop : null
        // aka, _p2Drop = ap2d(key)

        // And recurse.
        w.descend(key)
        writeOp1Drop(_p1Pick, p1Drop, _p2Pick, _p2Drop, w, removed2)
        w.ascend()
      }
    }

    ap2p.end()
    if (p1pDidDescend) p1Pick!.ascend()
    if (p2dDidDescend) p2Drop!.ascend()
    decPrefix()
    return droppedHere
  }

  log('----- drop -----')
  writeOp1Drop(r1, r1.clone(), r2, r2.clone(), w, null)
  if (conflict) {
    log('returning conflict 3', conflict)
    return {ok:false, conflict}
  }
  w.reset()

  if (!RELEASE_MODE) {
    log('output slot map', outputSlotMap)
    log('merging picks into partial output', w.get())
    log('held pick writes', heldPickWrites.map(w => w.get()))
  }

  const eachDrop = <W extends null | WriteCursor>(r: ReadCursor, w: W,
      fn: (slot: number, r: ReadCursor, w: W) => void) => r.traverse(w, (c, w) => {
    if (c.d != null) fn(c.d, r, w)
  })

  if (cancelledOp2.length || heldPickWrites.length) {
    log('merging')
    eachDrop(r2, w, (slot2, r, w) => {
      if (cancelledOp2[slot2] && !discardedOp2Drop[slot2]) {
        log('removing at held drop2', slot2)
        w.write('r', true)
      }

      if (heldPickWrites[slot2]) {
        w.mergeTree(heldPickWrites[slot2].get())
      }
    })
    w.reset()
    if (!RELEASE_MODE) log('after merge', w.get())
  }

  // ---------------------------------------------------------------------
  // Finally copy in the moved writes. Here we need to pass the other readers
  // because we sometimes need to adjust array indexes.


  // const outDropPath = []
  const heldOutDropRead: ReadCursor[] = []

  // Its like a wave slowly breaking on the beach...
  const heldOutDropWrites: WriteCursor[] = []


  // This iterates through p2Drop
  //
  // Writes are transformed to the context of the output drops.
  function writeHeldOp2Drop(
      p2Drop: ReadCursor, outPick: ReadCursor | null, outDrop: ReadCursor | null,
      w: WriteCursor, parentC: JSONOpComponent | null, removedOut: Doc) {
    // TODO(cleanup): parentC is unused. Remove it.
    if (!RELEASE_MODE) log('writeHeldOp2Drop', 'p2Drop', p2Drop.getPath(),
      'outPick', outPick && outPick.getPath(), 'outDrop', outDrop && outDrop.getPath(),
      'pc', parentC, 'rm out', removedOut)
    ;(log as any).prefix++

    const coutp = getComponent(outPick)
    if (coutp && hasPick(coutp)) {
      if (coutp.p != null) {
        parentC = coutp

        const slot = coutp.p
        log('teleporting writes to output slot', slot, heldOutDropRead[slot].getPath())
        outDrop = heldOutDropRead[slot]
        w = heldOutDropWrites[slot] = writeCursor()
        // picksOut.push(coutp.p)
      } else if (coutp.r !== undefined) {
        outDrop = null
        removedOut = true
      }
      log('coutp', coutp)
    } else if (hasDrop(getComponent(outDrop))) {
      outDrop = null
    }


    // For drops we need to transform the location by the transform *result*.
    const c2 = p2Drop.getComponent()
    if (c2) {
      let slot2
      if ((slot2 = c2.d) != null) {
        log('c2 drop slot', slot2)
        const _w = heldDropWrites[slot2]
        if (_w) {
          log('merge tree', _w.get())
          w.mergeTree(_w.get())
          outDrop = readCursor(_w.get())
        }
      }
    }

    if (!RELEASE_MODE) {
      uniqDesc('outDrop p2Drop', p2Drop)
      uniqDesc('outDrop outPick', outPick)

      // When outDrop is inside merged reads it won't be guaranteed to have
      // unique paths.
      //uniqDesc('outDrop outDrop', outDrop)
    }

    let outPickOff = 0, outDropOff = 0

    const oPickAdv = advancer(outPick, undefined, (k, c) => {
      if (hasPick(c)) {
        outPickOff--
        log('outPickOff++')
      }
    })

    const oDropAdv = advancer(outDrop, (k, c) => (
      hasDrop(c) ? -(k - outDropOff) - 1 : k - outDropOff
    ), (k, c) => {
      if (hasDrop(c)) {
        outDropOff++
        log('outDropOff++')
      }
    })

    for (const o2dk of p2Drop) {
      if (typeof o2dk === 'number') {
        const _outPick = oPickAdv(o2dk)
        const rmid = o2dk + outPickOff
        const _outDrop = oDropAdv(rmid)
        const rfinal = rmid + outDropOff

        log('->', o2dk, 'outPickOff', outPickOff, '-> rmid', rmid, 'dropOff', outDropOff, 'final', rfinal)

        w.descend(rfinal)
        writeHeldOp2Drop(p2Drop, _outPick, _outDrop, w, parentC, removedOut)
        w.ascend()
      } else {
        log('->', o2dk)

        w.descend(o2dk)
        writeHeldOp2Drop(p2Drop, oPickAdv(o2dk), oDropAdv(o2dk), w, parentC, removedOut)
        w.ascend()
      }
    }
    decPrefix()

    // if (coutp && coutp.p != null) picksOut.pop()

    oPickAdv.end()
    oDropAdv.end()
  }

  if ((heldDropWrites.length || cancelledOp2.length) && !conflict) {
    log('------ write held picks and drops -----')
    if (!RELEASE_MODE) log('held drop writes', heldDropWrites.map(h => h.get()))

    // This is super nasty. The problem is that we need a read cursor over the
    // output so far, but the output is still mutable (we're going to mutate
    // it). I could avoid the clone entirely by doing the full transform work
    // that op1 drop above does.

    // TODO: I have a feeling I might need to loop this stuff until we don't
    // have any held operations.
    const rOut = readCursor(shallowCloneOp(w.get()))
    eachDrop(rOut, null, (slotOut, r) => {
      heldOutDropRead[slotOut] = r.clone()
    })
    heldDropWrites.forEach(hdw => {
      if (hdw) eachDrop(readCursor(hdw.get()), null, (slotOut, r) => {
        heldOutDropRead[slotOut] = r.clone()
      })
    })

    if (!RELEASE_MODE) {
      log('merging writes into', rOut.get())
      log('heldOutDropRead', heldOutDropRead.map(r => r && r.getPath()))
    }
    writeHeldOp2Drop(r2, rOut, rOut.clone(), w, null, false)
    w.reset()

    if (conflict) {
      log('-> xf returning conflict 2', conflict)
      return {ok:false, conflict}
    }

    log('-- after writeHeldOp2Drop', w.get())
    if (!RELEASE_MODE) log('held output writes', heldOutDropWrites.map(h => h.get()))
    if (heldOutDropWrites.length) {
      const heldOutDropContent = heldOutDropWrites.map(w => w ? w.get() : null)

      const rOut2 = readCursor(shallowCloneOp(w.get()))
      eachDrop(rOut2, w, (slotOut, r, w) => {
        const data = heldOutDropContent[slotOut]
        if (data) {
          w.mergeTree(data)
          heldOutDropContent[slotOut] = null
        }
      })

      if (heldOutDropContent.find(x => x)) {
        log('BLACKHOLE')
        // If there's nowhere we can naturally place a drop, it must be
        // blackholed. Blackholes can have multiple picks & drops, and we need
        // all the places in op1 and op2 where the drops happened to
        // reconstruct it.

        const w1 = writeCursor(), w2 = writeCursor()
        let nextSlot1 = 0, nextSlot2 = 0

        // log('hdo', heldOutDropContent, 'mcod', op2MoveContainingOutDrop)
        heldOutDropContent.forEach((data, slotOut) => {
          if (data != null) {
            eachDrop(readCursor(data), null, c => {
              const slot1 = outputSlotMap[c]
              w1.writeMove(heldOp1PickByOp1[slot1].getPath(), heldOp1DropByOp1[slot1]!.getPath(), nextSlot1++)

              log('blackhole slot1', slot1)
              const slot2s = op1PicksOp2DropSlots[slot1]
              if (slot2s) slot2s.forEach(slot2 => {
                if (!cancelledOp2[slot2] && (side === RIGHT || op1PickAtOp2Pick[slot2] == null)) {
                  w2.writeMove(heldOp2PickByOp2[slot2]!.getPath(), heldOp2DropByOp2[slot2]!.getPath(), nextSlot2++)
                }
              })
            })

            // const slot2 = op2MoveContainingOutDrop[slotOut]
            // assert(slot2 != null)

            // log(slot2, heldOp2PickByOp2[slot2] && heldOp2PickByOp2[slot2].getPath(), heldOp2DropByOp2[slot2] && heldOp2PickByOp2[slot2].getPath())
            // w2.writeMove(heldOp2PickByOp2[slot2].getPath(), heldOp2DropByOp2[slot2].getPath(), nextSlot2++)
          }
        })

        conflict = {
          type: ConflictType.BLACKHOLE,
          op1: w1.get(),
          op2: w2.get(),
        }
      }
    }
  }


  if (conflict) {
    log('-> xf returning conflict 5', conflict)
    log()
    return {ok:false, conflict}

  } else {
    const result = w.get()
    log('-> xf returning', result)
    log()
    if (!RELEASE_MODE) checkValidOp(result)
    return {ok:true, result}
  }
}

const throwConflictErr = (conflict: Conflict) => {
  const err = new Error('Transform detected write conflict')
  ;(err as any).conflict = conflict
  ;(err as any).type = err.name = 'writeConflict'
  throw err
}

// Transform variant which throws on conflict.
function transform(op1: JSONOp, op2: JSONOp, side: 'left' | 'right') {
  const res = tryTransform(op1, op2, side)
  if (res.ok) return res.result
  else throwConflictErr(res.conflict)
}

/** Make an op that removes the content at the drop and edit destinations of the passed op */
const opThatRemovesDE = (op: JSONOp) => {
  const w = writeCursor()
  readCursor(op).traverse(w, (c, w) => {
    if (hasDrop(c) || getEditType(c)) w.write('r', true)
  })
  return w.get()
}

const resolveConflict = (conflict: Conflict, side: 'left' | 'right') => {
  const {type, op1, op2} = conflict
  log('resolving conflict of type', type)

  switch (type) {
    case ConflictType.DROP_COLLISION:
      // log(c2, removeOp(c2.drop))

      return side === 'left'
        ? [null, opThatRemovesDE(op2)]
        : [opThatRemovesDE(op1), null]

    case ConflictType.RM_UNEXPECTED_CONTENT:
      let op1HasRemove = false
      readCursor(op1).traverse(null, c => {if (c.r !== undefined) op1HasRemove = true})
      return op1HasRemove ? [null, opThatRemovesDE(op2)] : [opThatRemovesDE(op1), null]
    
    case ConflictType.BLACKHOLE:
      // The conflict will have moves from each operation
      //
      // There's no good automatic resolution for blackholed content. Both
      // objects are expected to be removed from the source and there's
      // nowhere we can really put them. We'll just delete everything.
      //
      // Note that c2 has *already* moved the blackholed content inside c1. We
      // only need to remove c1.
      return [opThatRemovesDE(op1), opThatRemovesDE(op2)]

    default: throw Error('Unrecognised conflict: ' + type)
  }
}


const invConflict = ({type, op1, op2}: Conflict) => ({type, op1:op2, op2:op1})
const normalizeConflict = ({type, op1, op2}: Conflict) => ({type, op1:normalize(op1), op2: normalize(op2)})

type AllowConflictPred = (c: Conflict) => boolean
function transformWithConflictsPred(allowConflict: AllowConflictPred, op1: JSONOp, op2: JSONOp, side: 'left' | 'right') {
  // debugMode = t.debug

  let r2Aggregate = null

  while (true) {
    const res = tryTransform(op1, op2, side)
    if (res.ok) return compose(r2Aggregate, res.result)
    else {
      const {conflict} = res
      log('detected conflict', conflict)
      if (!allowConflict(conflict)) throwConflictErr(conflict)

      if (!RELEASE_MODE && conflict.type === ConflictType.BLACKHOLE) {
        const res2 = tryTransform(op2, op1, side === 'left' ? 'right' : 'left')
        // const {ok: ok2, result: result2, conflict: conflict2} = res2
        assert(!res2.ok)
        try {
          assert(deepEqual(normalizeConflict(res2.conflict) as any, normalizeConflict(invConflict(conflict)) as any))
        } catch (e) {
          ;(log as any).debug = true
          log('Inverted transform conflict', op1, op2, conflict, res2.conflict)
          throw e
        }
      }

      // Recover from the conflict
      const [r1, r2] = resolveConflict(conflict, side)
      log('Resolve ops', r1, r2)
      // I'm normalizing here to work around a bug where a non-normalized op (eg
      // `[{"es":[]}]`) generates a conflict but cannot ever be resolved because
      // the conflict object returned by transform loses information about the
      // conflicting part of the operation.
      //
      // This shouldn't come up with well formed operations in general, but
      // without this the code here ends up in an infinite loop in these cases.
      op1 = compose(normalize(op1), r1)
      op2 = compose(normalize(op2), r2)
      r2Aggregate = compose(r2Aggregate, r2)
      log('recover from conflict', conflict)
      log('op1 ->', op1)
      log('op2 ->', op2)
    }
  }
}
