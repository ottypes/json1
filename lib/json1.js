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
// ** This is still a work in progress. The tests don't all pass yet. **
//
// My TODO list:
// - Feature parity with the old version
// - number operations
// - compose()
// - compose preserve invertable data
// - makeInvertable and invert()
// - Fuzzer, fix bugs
// - Port to JS.

// - setNull = ??
// - remove N items in a list
// - a backup move location in the op
// - Conversion between json1 ops and json0, json-patch.

const assert = require('assert')
const log = require('./log')
const {readCursor, writeCursor, eachChildOf} = cursor = require('./cursor')
const deepEqual = require('./deepEqual')
const deepClone = require('./deepClone')


const type = module.exports = {
  name: 'json1',
  readCursor,
  writeCursor,

  // The document must be immutable. Create by default sets a document at
  // `undefined`. You should follow up by initializing the document using a
  // {i:....} operation.
  create(data) { return data }
}


const getComponent = r => r ? r.getComponent() : null

const isObject = o => o && typeof(o) === 'object' && !Array.isArray(o)

// Only valid to call this with objects and arrays.
const shallowClone = (obj) => Array.isArray(obj) ? obj.slice() : Object.assign({}, obj)

const hasPick = op => op && (op.p != null || op.r !== undefined)
const hasDrop = op => op && (op.d != null || op.i !== undefined)

// Remove key from container. Return container with key removed
function removeChild(container, key) {
  assert(container != null)
  if (typeof key === 'number') { // Removing from a list
    assert(Array.isArray(container))
    container = container.slice()
    container.splice(key, 1)
  } else { // Removing from an object
    assert(isObject(container))
    container = Object.assign({}, container)
    delete container[key]
  }
  return container
}

// Insert value at key in container. Return container with new value
function insertChildMut(container, key, value) {
  if (typeof key === 'number') {
    assert(Array.isArray(container), 'Cannot use numerical key for object container')
    //container = container.slice()
    container.splice(key, 0, value)
  } else {
    assert(isObject(container))
    assert(container[key] === undefined, 'Trying to overwrite value at key. Your op needs to remove it first')
    container[key] = value
    //container = Object.assign({[key]:value}, container)
  }

  return value
}

const replaceChild = (obj, k, v) => {
  obj = shallowClone(obj)
  obj[k] = v
  return obj
}


// *******

const subtypes = {}
const register = type.registerSubtype = function(subtype) {
  if (subtype.type) subtype = subtype.type
  if (subtype.name) subtypes[subtype.name] = subtype
  if (subtype.uri) subtypes[subtype.uri] = subtype
}

register(require('ot-text'))


function getEditType(component) {
  if (component == null) {
    return null
  } else if (component.et) {
    return subtypes[component.et]
  } else if (component.es) {
    return subtypes.text
  } else if (component.en) {
    throw Error('Not implemented!')
  } else {
    return null
  }
}

const getEdit = c => c.es || c.en || c.e

const writeEdit = (w, type, edit) => {
  if (type === subtypes.text) {
    w.write('es', edit) // Text edit-string operation.
  } else { // TODO: Also if t1 === subtypes.number then write en...
    w.write('et', type.name) // Generic embedded edit.
    w.write('e', edit)
  }
}

// ***** Check code


const checkNonNegInteger = (n) => {
  assert(typeof n === 'number')
  assert(n >= 0)
  assert(n === (n|0))
}

const checkScalar = (s) => {
  if (typeof s === 'number') {
    checkNonNegInteger(s)
  } else {
    assert(typeof s === 'string')
  }
}

const checkOp = type.checkValidOp = function(op) {
  //console.log 'check', op

  if (op === null) return // Empty operation. undefined is not a valid operation and should crash.

  // Both sets of used IDs.
  const pickedSlots = new Set
  const droppedSlots = new Set

  const checkComponent = e => {
    let empty = true
    let hasEdit = false
    for (let k in e) {
      const v = e[k]
      empty = false

      // Thanks coffeescript compiler!
      assert(k === 'p' || k === 'r' || k === 'd' || k === 'i'
        || k === 'e' || k === 'es' || k === 'en' || k === 'et',
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
      } else if (k === 'e' || k === 'es' || k === 'en') {
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
  const checkDescent = (descent, isRoot) => {
    if (!Array.isArray(descent)) throw Error('Op must be null or a list')
    if (descent.length === 0) throw Error('Empty descent')

    if (!isRoot) checkScalar(descent[0])

    let last = SCALAR
    let numDescents = 0
    let lastKey = 0

    for (let i = 0; i < descent.length; i++) {
      const d = descent[i]
      assert(d != null)

      if (Array.isArray(d)) {
        const key = checkDescent(d, false)
        if (numDescents) {
          const t1 = typeof lastKey
          const t2 = typeof key
          if (t1 === t2) assert(lastKey < key)
          else assert(t1 === 'number' && t2 === 'string')
        }

        lastKey = key
        numDescents++
        last = DESCENT
      } else if (typeof d === 'object') {
        assert(last === SCALAR, `Prev not scalar - instead ${last}`)
        checkComponent(d)
        last = EDIT
      } else {
        assert(last !== DESCENT)
        checkScalar(d)
        last = SCALAR
      }
    }

    assert(numDescents !== 1)
    assert(last === EDIT || last === DESCENT)

    return descent[0]
  }

  checkDescent(op, true)

  assert.equal(pickedSlots.size, droppedSlots.size, 'Mismatched picks and drops in op')

  for (let i = 0; i < pickedSlots.size; i++) {
    assert(pickedSlots.has(i))
    assert(droppedSlots.has(i))
  }

  //console.log numPickSlots, numDropSlots, pickedSlots, droppedSlots

  //console.log '---> ok', op
}

type.normalize = function(op) {
  const result = writeCursor()
  result.mergeTree(op)
  // mergeCursor(result, op)
  return result.get()
}


// ***** Apply

type.apply = function(snapshot, op) {
  // Apply op to snapshot. Return the new snapshot.
  //
  // The snapshot is shallow copied as its edited, so the previous snapshot
  // reference is still valid.
  log.quiet = !type.debug
  //log.quiet = false
  //log('*******************************************')
  log('apply', {snapshot, op})
  checkOp(op)

  // The snapshot can be undefined if the document is being made with this
  // operation. Its up to the application if they want to use OT to support
  // that, or if they want to disallow the document from being undefined.

  if (op === null) return snapshot

  const held = [] // Indexed by the pick #. Autoexpand.

  // The op is made up of lists. Each list item is one of three things:
  // - A descent (a scalar value to descend into either a list or an object at
  //   the current location). Except for at the root there is always at least 1 of these.
  // - An edit - which is a pick, a drop or an edit.
  // - A child descent. These are always at the end of the list. We recurse for these.

  // Phase 1: Pick. Returns updated subdocument.
  function pick(subDoc, descent) {
    //log('pick', subDoc, descent)

    const stack = []

    let i = 0
    for (; i < descent.length; i++) {
      const d = descent[i]
      if (Array.isArray(d)) break
      if (typeof d === 'object') continue
      stack.push(subDoc)
      // Its valid to descend into a null space - just we can't pick there.
      subDoc = subDoc == null ? undefined : subDoc[d]
    }

    // Children. These need to be traversed in reverse order here.
    for (let j = descent.length - 1; j >= i; j--) {
      subDoc = pick(subDoc, descent[j])
    }

    // Then back again.
    for (--i; i >= 0; i--) {
      const d = descent[i]
      if (typeof d !== 'object') {
        const container = stack.pop()
        // Have fuuuuunnnn! (TODO: Clean this mess up)
        subDoc = (subDoc === (container == null ? undefined : container[d])) ? container
          : (subDoc === undefined) ? removeChild(container, d) : replaceChild(container, d, subDoc)
      } else if (hasPick(d)) {
        assert(subDoc !== undefined, 'Cannot pick up or remove undefined')
        if (d.p != null) held[d.p] = subDoc
        subDoc = undefined
      }
    }

    return subDoc
  }

  snapshot = pick(snapshot, op)

  //log('--- after pick phase ---')
  //log('held', held, 'snapshot', snapshot)

  function drop(root, descent) {
    // The document might have already been cloned in-place. If it has we'll
    // still throw it out and make a new one. This should be pretty quick but
    // if its a problem we could optimize it by making a editable Set with
    // everything we've cloned (and thus is safe to edit)
    //
    // I think it should be safe anyway because short lived objects are pretty
    // cheap in a modern generational GC.

    let subDoc = root, i = 0 // For reading
    let rootContainer = {root} // This is an avoidable allocation.
    let m = 0, container = rootContainer, key = 'root' // For writing

    function mut() {
      for (; m < i; m++) {
        let d = descent[m]
        if (typeof d === 'object') continue

        //log('descent', d, container, key)
        container = container[key] = shallowClone(container[key])
        key = d
      }
    }

    for (; i < descent.length; i++) {
      const d = descent[i]

      if (Array.isArray(d)) {
        const child = drop(subDoc, d)
        if (child !== subDoc) {
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
        subDoc = subDoc != null ? subDoc[d] : undefined
      }
    }

    return rootContainer.root
  }

  //log('drop', snapshot, op)
  snapshot = drop(snapshot, op)

  log('-> apply returning', {snapshot})
  return snapshot
}


// ****** Compose

const setOrRemoveChild = (container, key, child) => {
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
    if (typeof key === 'number') container.splice(key, 1)
    else delete container[key]
  } else {
    container[key] = child
  }
}

const compose = type.compose = function(op1, op2) {
  checkOp(op1)
  checkOp(op2)

  const debug = type.debug
  if (debug) {
    log("composing:")
    log('  op1:', op1)
    log('  op2:', op2)
  }

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
  const heldPickWrites = []
  const heldDropWrites = []

  // Held read cursors in the outside pick and drop locations, so we can
  // teleport our cursors while reading.
  const held1Pick = []
  const held2Drop = []

  // Map from op1 slots -> output slots
  const p1SlotMap = []
  const p2SlotMap = []

  // First scan the outside operations to populate held1Pick and held2Drop.
  function scanOp1Pick(p1Pick) {
    const c = p1Pick.getComponent()
    if (c && c.p != null) {
      // Clone the read cursor
      held1Pick[c.p] = p1Pick.clone()
    }

    // And recurse.
    for (const key of p1Pick.children()) {
      scanOp1Pick(p1Pick)
    }
  }
  scanOp1Pick(r1)

  function scanOp2Drop(p2Drop) {
    const c = p2Drop.getComponent()
    if (c && c.d != null) {
      // Clone the read cursor
      held2Drop[c.d] = p2Drop.clone()
    }

    // And recurse.
    for (const key of p2Drop.children()) {
      scanOp2Drop(p2Drop)
    }
  }
  scanOp2Drop(r2)

  // Next we can scan the inside edge following op1 drops then op2 picks,
  // transforming and writing the output to w.
  //
  // At least one of r1Drop or r2Pick must not be null.
  //
  // This function writes r1 drops to w1 and r2 picks to wp.
  function xfBoundary(r1Pick, r1Drop, r2Pick, r2Drop, litIn, rmParent, wd, wp) {
    assert(r1Drop || r2Pick)
    log('xfBoundary', litIn,
      !!r1Pick && '1pick', !!r1Drop && '1drop',
      !!r2Pick && '2pick', !!r2Drop && '2drop',
      'lit:', litIn, 'remove:', rmParent)
    log.prefix++

    let litOut = litIn

    const c1d = getComponent(r1Drop)
    const c2p = getComponent(r2Pick)

    const rmHere = c2p && c2p.r !== undefined
    const insHere = c1d && c1d.i !== undefined
    const drop1Slot = c1d ? c1d.d : null
    const pick2Slot = c2p ? c2p.p : null

    log('pick2Slot', pick2Slot, 'drop1Slot', drop1Slot)

    // rmParent arg for when we recurse.
    const rmChildren = (rmParent || rmHere) && (pick2Slot == null)

    if (pick2Slot != null) {
      log('teleporting via c2 pick2Slot', pick2Slot)
      r2Drop = held2Drop[pick2Slot]

      // Writes here need to be transformed to op2's drop location.
      wd = heldDropWrites[pick2Slot] = writeCursor()
      //literal = undefined
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
      wp = heldPickWrites[drop1Slot] = writeCursor()

      if (!rmParent && !rmHere) {
        const slot = p1SlotMap[drop1Slot] = nextSlot++
        log('assigning slot', slot, 'to op1 slot', drop1Slot)
        wd.write('d', slot)
      } else {
        log('Cancelling op1 move', drop1Slot)
        if (rmParent && !rmHere) wp.write('r', true)
      }
    } else {
      const c1p = getComponent(r1Pick)
      if (c1p && c1p.p != null) r1Pick = null
    }

    if (insHere) {
      // Note that insIn might also be set if the insert is chained.
      litOut = c1d.i
    }

    if (litOut !== undefined) log('litOut', litOut)

    if (pick2Slot != null) {
      // ....
      if (litIn !== undefined || insHere) {
        // Move the literal.
      } else {
        // If we pick here and drop here, join the two moves at the hip.
        const slot = drop1Slot != null ? p1SlotMap[drop1Slot] : nextSlot++

        p2SlotMap[pick2Slot] = slot
        log('assigning slot', slot, 'to op2 slot', drop1Slot)
        wp.write('p', slot)
      }
    } else if (rmHere) {
      if (!insHere && litIn === undefined) {
        // To make this support invert passing, this should save the rm
        // component and copy like we do for insert.
        log('keeping write here r=true')
        wp.write('r', true)
      }
    }

    // Edits!
    //
    // For edits, we basically want to grab the edit at r1Drop and r2Drop and
    // just compose them together into the output.
    const type1 = (!rmParent && !rmHere) ? getEditType(c1d) : null
    const type2 = getEditType(c2d)

    log('components', c1d, c2d)
    if (type1 || type2) log('types', type1 && type1.name, type2 && type2.name)

    if (type1 && type2) {
      assert(type1 === type2)
      // Compose.
      const e1 = getEdit(c1d)
      const e2 = getEdit(c2d)
      const r = type1.compose(e1, e2)
      log('compose ->', r)
      writeEdit(wd, type1, r)
    } else if (type1) {
      log('copying edit type1', c1d)
      writeEdit(wd, type1, getEdit(c1d))
    } else if (type2) {
      log('copying edit type2', c2d)
      writeEdit(wd, type2, getEdit(c2d))
    }

    // Will we insert in the output? If so hold the component, and we'll write
    // the insert at the end of this function.
    const insComponent =
      (insHere && !rmParent && !rmHere && pick2Slot == null)
        || (pick2Slot != null && litOut !== undefined) ? wd.getComponent() : null

    // We follow strict immutability semantics, so we have to clone the insert
    // if it gets modified. We'll only clone the object literal if we have to.
    const hasContainerLiteral = typeof litOut === 'object' && litOut != null

    let isCloned = false
    const mut = hasContainerLiteral ? () => {
      if (!isCloned) {
        litOut = Array.isArray(litOut)
          ? litOut.slice() : Object.assign({}, litOut)
        isCloned = true
      }
    } : null

    let p1PickOff = 0, p1DropOff = 0
    let p2PickOff = 0, p2DropOff = 0

    const p2DropAdv = cursor.advancer(r2Drop,
      (k, c) => hasDrop(c) ? (p2DropOff - k - 1) : k - p2DropOff,
      (k, c) => { if (hasDrop(c)) p2DropOff++ })

    const p1PickAdv = cursor.advancer(r1Pick,
      (k, c) => hasPick(c) ? (p1PickOff - k - 1) : k - p1PickOff,
      (k, c) => { if (hasPick(c)) p1PickOff++ })

    eachChildOf(r1Drop, r2Pick, (k, c) => {
      if (hasDrop(c)) p1DropOff--
    }, (k, c) => {
      if (hasPick(c)) p2PickOff--
    }, (inKey, _p1Drop, _p2Pick) => {
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

        litKey = inKey + p1DropOff // This is really weird.

        log('p1PickOff', p1PickOff, 'p1DropOff', p1DropOff,
          'p2PickOff', p2PickOff, 'p2DropOff', p2DropOff)
        log('inKey', inKey, '-> p1 mid', p1Mid, '-> p1 final', p1PickKey)
        log('inKey', inKey, '-> p2 mid', p2Mid, '-> p2 final', p2DropKey)

        assert(p1PickKey >= 0, 'p1PickKey is negative')
        assert(p2DropKey >= 0, 'p2DropKey is negative')
      } else {
        _p1Pick = p1PickAdv(inKey)
        _p2Drop = p2DropAdv(inKey)
      }

      log('descending', p1PickKey, inKey, p2DropKey)
      wp.descend(p1PickKey)
      wd.descend(p2DropKey)

      const _lit = hasContainerLiteral && !hasDrop(getComponent(_p1Drop))
        ? litOut[litKey] : undefined

      log('_lit', _lit, litOut, litKey)
      const _litResult = xfBoundary(_p1Pick, _p1Drop, _p2Pick, _p2Drop,
        _lit, rmChildren, wd, wp)

      if (hasContainerLiteral) {
        log('_litResult', _litResult)
        if (_lit !== _litResult) {
          mut()
          setOrRemoveChild(litOut, litKey, _litResult)
        }
      } else assert.strictEqual(_litResult, undefined)

      wd.ascend()
      wp.ascend()
    })
    p1PickAdv.end()
    p2DropAdv.end()

    log.prefix--

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
      litOut = litIn
      //log('a', litIn)
    } else if (!rmHere && !rmParent && pick2Slot == null) {
      //log('b', litOut)
      return litOut
    } else {
      //log('c', undefined)
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
  function writeOp1Pick(r1Pick, w) {
    const c = r1Pick.getComponent()
    if (c) {
      const slot1 = c.p
      if (slot1 != null) {
        // TODO: Cancelled moves seems redundant all of a sudden.
        const slot = p1SlotMap[slot1]
        if (slot != null) {
          w.write('p', slot)
        }
        const _w = heldPickWrites[slot1]
        if (_w) w.mergeTree(_w.get())
      } else if (c.r !== undefined) {
        w.write('r', c.r)
      }
    }

    for (const key of r1Pick.children()) {
      w.descend(key)
      writeOp1Pick(r1Pick, w)
      w.ascend()
    }
  }

  writeOp1Pick(r1, w)
  w.reset()
  log('intermediate op with picks', w.get())

  // ... And the same for the op2 drops.
  function writeOp2Drop(r2Drop, w) {
    const c = r2Drop.getComponent()
    if (c) {
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
    }

    for (const key of r2Drop.children()) {
      w.descend(key)
      writeOp2Drop(r2Drop, w)
      w.ascend()
    }
  }

  writeOp2Drop(r2, w)


  const result = w.get()
  log('-> compose returning', result)

  checkOp(result)
  return result
}


// ***** Transform

const LEFT = 0, RIGHT = 1

// This makes a shallow clone of an operation so a reader can read a partially
// written operation. The components aren't copied - which means we don't deep
// copy any inserted objects, and the components can be edited directly, which
// is a bit of a hack that transform takes advantage of.
const shallowCloneOp = (op) => {
  if (op == null) return null
  const result = op.slice()
  for (let i = 0; i < op.length; i++) {
    if (Array.isArray(result[i])) result[i] = shallowCloneOp(result[i])
  }
  return result
}


const transform = type.transform = function(op1, op2, direction, opts) {
  assert(direction === 'left' || direction === 'right', 'Direction must be left or right')
  const side = direction === 'left' ? LEFT : RIGHT
  const debug = type.debug
  log.quiet = !debug

  if (op2 == null) return op1

  // Lost and found bin. TODO: Consider renaming this.
  //let lnf = opts ? opts.lnf : null

  if (debug) {
    log("transforming " + direction + ":")
    log('op1', op1)
    log('op2', op2)
  }

  checkOp(op1)
  checkOp(op2)

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


  // These arrays hold read cursors into the op1 picks & op2 drops because we
  // need to parse them out-of-order. When we see this stuff the first time, we
  // mark & skip it. Then we descend in using the cursor clone when we need to.
  const heldOp1Pick = [] // indexed by op1.
  const heldOp2Drop = [] // indexed by op2. Used in writeOp1Pick

  // Indexed by op1's slots. This is needed during the op1 drop phase.
  const heldOp2Pick = [] // indexed by op1. Used in writeOp1Drop
  const heldOp2DropByOp1 = [] // Indexed by op1. Used in writeOp1Drop

  // Map from op2's slots -> true if the item has been removed by op1.
  const cancelledOp2 = []

  // This is a list of write cursors, indexed by op2 slot numbers. This is used
  // to stage any operations that have been moved by op2. Anything in the
  // designated held write will be written out at the appropriate op2 pick /
  // drop location.
  const heldWrites = []

  const op1PickAtOp2Pick = []

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
  function scanOp2Pick(r2Pick, r1Pick, removed1) { // r1Pick might be null.
    const c1 = r1Pick ? r1Pick.getComponent() : null
    if (c1) {
      if (c1.r !== undefined) removed1 = true
      else if (c1.p != null) {
        removed1 = false
        heldOp2Pick[c1.p] = r2Pick.clone()
      }
    }

    const c2 = r2Pick.getComponent()
    let slot2
    if (c2 && ((slot2 = c2.p) != null)) {
      log(slot2, c1, c2)
      if (removed1) {
        cancelledOp2[slot2] = true
        log('Cancelled op2 slot', slot2)
      }

      // If this happens it means both operations picked up the same element.
      // One operation's move will be cancelled based on symmetry.
      if (c1 && c1.p != null) op1PickAtOp2Pick[slot2] = c1.p
    }

    // ... And recurse.
    const ap1 = cursor.advancer(r1Pick)
    for (const key of r2Pick.children()) {
      scanOp2Pick(r2Pick, ap1(key), removed1)
    }
    ap1.end()
  }

  scanOp2Pick(r2, r1, false)
  log('op1PickAtOp2Pick', op1PickAtOp2Pick)
  log('cancelled', cancelledOp2)
  log('held op2 pick', heldOp2Pick.map(x => !!x))

  // ---------------------------------------------------------------------
  // This traverses op2's drop locations for bookkeeping, marking:
  // - Fetch a (cloned) read cursor at each op2 drop location
  function scanOp2Drop(r2Drop) {
    const c2 = r2Drop.getComponent()
    let slot
    if (c2 && ((slot = c2.d) != null)) {
      // Clone the read cursor so we can come back here later.
      heldOp2Drop[slot] = r2Drop.clone()
    }

    // And recurse...
    for (const key of r2Drop.children()) {
      scanOp2Drop(r2Drop)
    }
  }

  scanOp2Drop(r2)

  log('held op2 drop', heldOp2Drop.map(x => !!x))

  // ---------------------------------------------------------------------

  // We could almost (but not quite) double up on pickComponents and
  // heldOp1Pick --- heldOp1Pick shows us the original component, but
  // pickComponents are actually write components, so its no good.
  const pickComponents = []

  let cancelledRemoves = null // Lazy initialized set

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
  function writeOp1Pick(r1Pick, r2Pick, r2Drop, w, removed2) {
    log('writeOp1Pick')
    log.prefix++
    // p1Pick and w are always defined. Either or both of r2Pick and r2Drop
    // could be null.
    let iAmMoved = false

    const c2 = r2Pick ? r2Pick.getComponent() : null
    if (c2) {
      const slot = c2.p
      if (slot != null) {
        // op2 has moved the item we're descending into. Instead of taking
        // picks from the original (source) location, take them from the
        // destination location.
        log('teleporting via op2 slot', slot)
        r2Drop = heldOp2Drop[slot]
        // TODO: Does w need to be reset here?
        if (!(w = heldWrites[slot])) w = heldWrites[slot] = writeCursor()
        iAmMoved = true
        removed2 = false
      } else if (c2.r !== undefined) {
        // op2 deleted the item we're trying to move.
        removed2 = true
      }
    }

    const c1 = r1Pick.getComponent()
    if (c1) {
      const slot = c1.p
      if (slot != null) {
        if (!removed2 && (side === LEFT || !iAmMoved)) {
          pickComponents[slot] = w.getComponent()
        } else {
          log("cancelling " + slot)
          // A move from a subtree that was removed2 by op2.
          pickComponents[slot] = null // redundant, but we can check this below.
        }

        // This is used by the op2Drop scan, below.
        heldOp1Pick[slot] = r1Pick.clone()

        // And this is used by writeOp1Drop
        // heldOp2DropByOp1[slot] = r2Drop ? r2Drop.clone() : null // Wrong for some reason?
        if (r2Drop) heldOp2DropByOp1[slot] = r2Drop.clone()
      } else if (c1.r !== undefined) {
        // Copy the remove from op1.
        if (!removed2) {
          log('copying remove')
          w.write('r', true)
        }

        if (removed2 || iAmMoved) {
          if (cancelledRemoves == null) cancelledRemoves = new Set
          cancelledRemoves.add(c1)
        }
      }
    }

    // Ok, now to scan the children. We need these offsets to track how array
    // offsets are changed by the transform.
    let p2PickOff = 0, p2DropOff = 0

    // advancer(cursor, listMapFn, listAdvanceFn).
    const ap2Pick = cursor.advancer(r2Pick, null, (k, c) => {
      if (hasPick(c)) {
        p2PickOff++
        log('r2Pick++', p2PickOff, k, c)
      }
    })
    ap2Pick._name = '2pick'

    const ap2Drop = cursor.advancer(r2Drop, (k, c) => (
      // Sneaking a second bit in here via 2s compliment.
      hasDrop(c) ? -(k - p2DropOff) - 1 : k - p2DropOff
    ), (k, c) => {
      if (hasDrop(c)) {
        p2DropOff++
        log('r2Drop++', p2DropOff, k, c)
      }
    })
    ap2Drop._name = '2drop'

    log('children', '2p', !!r2Pick, '2d', !!r2Drop)
    for (const key of r1Pick.children()) {
      if (typeof key === 'string') {
        log('string key', key)
        const p2Pick_ = ap2Pick(key)
        const p2Drop_ = ap2Drop(key)

        w.descend(key)
        writeOp1Pick(r1Pick, p2Pick_, p2Drop_, w, removed2)
        w.ascend()
      } else {
        const p2Pick_ = ap2Pick(key)
        const p2Mid = key - p2PickOff
        const p2Drop_ = ap2Drop(p2Mid)
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
    log.prefix--
  }

  log('---- pick ----')
  writeOp1Pick(r1, r2, r2.clone(), w, false)
  w.reset()

  log('held picks', heldOp1Pick.map(x => x.getComponent() || !!x))
  log('held op2 drops by op1', heldOp2DropByOp1.map(x => x.getComponent() || !!x))
  log('pc', pickComponents)

  // ---------------------------------------------------------------------

  // Set of op2 components with an insert or drop which is being overwritten by
  // op1. Initialized lazily. Only used on LEFT.
  let overwrittenDrops = null

  let slotMapping = []

  // Finally the big one. This handles the semantics of op1's drop phase (move
  // drop and insert). This is complicated because the drop phase inside the op
  // is pre-transformed by op1's pick phase, which we have to account for when
  // we're transforming.
  //
  // Removed tracks op2's pick removals.
  function writeOp1Drop(p1Pick, p1Drop, p2Pick, p2Drop, w, removed2) {
    assert(p1Drop)
    const c1d = p1Drop.getComponent()
    log('drop', !!p1Pick, !!p1Drop, !!p2Pick, !!p2Drop, 'c:', c1d)
    log.prefix++

    let c2d = p2Drop ? p2Drop.getComponent() : null // non-const for teleporting.
    let droppedHere = false

    if (c1d) {
      const slot1 = c1d.d
      const pc = slot1 != null ? pickComponents[slot1] : null

      if (c1d.i !== undefined || ((slot1 != null) && pc)) {
        // Times to write:
        // - There is no c2 drop
        // - The other drop has been cancelled
        // - We are left (and then we also need to move or remove)
        // If we are identical, skip everything. Neither write nor remove.

        // Doing this with logical statements was too hard. This just sets up
        // some state variables which are used in conditionals below.
        let write = true
        let identical = false
        log('looking to write', c1d, c2d, cancelledOp2)
        if (c2d) {
          const slot2 = c2d.d
          if (slot2 != null) {
            if (cancelledOp2[slot2]) {
              write = true
            } else {
              write = side === LEFT
              identical = (slot1 != null) && slot1 === op1PickAtOp2Pick[slot2]
            }
          } else if (c2d.i !== undefined) {
            write = side === LEFT
            identical = deepEqual(c2d.i, c1d.i)
          }
        }

        log('write', write, 'identical', identical)

        if (!identical) {
          if (!removed2 && write) {
            // Copy the drops.
            if (c1d.d != null) {
              log('copying the drop', c1d.d, 'using new slot', nextSlot)
              slotMapping[c1d.d] = nextSlot
              w.write('d', pc.p = nextSlot++)
              droppedHere = true
            } else if (c1d.i !== undefined) {
              w.write('i', deepClone(c1d.i)) // TODO: Only clone based on opts.consume.
              droppedHere = true
            }

            // If the right hand operation dropped something at the same
            // location, we'll overwrite it. So mark it for delete.
            // TODO: Conflict markers here.
            if (hasDrop(c2d)) {
              log('component will be overwritten', c2d)
              if (!overwrittenDrops) overwrittenDrops = new Set
              overwrittenDrops.add(c2d)
            }

          } else {
            log("Halp! We're being overwritten!")
            if (pc) pc.r = true
            removed2 = true
          }
        }
      } else if ((slot1 != null) && !pc) {
        // I'm not 100% sure this is the right implementation of the logic I want here.
        // TODO: This seems straight out wrong.
        removed2 = true
      }

      if (slot1 != null) {
        log('teleporting p1Pick and op2Pick via op1 slot', slot1)
        p1Pick = heldOp1Pick[slot1]
        p2Pick = heldOp2Pick[slot1]
        p2Drop = heldOp2DropByOp1[slot1] // Note: Potentially overwritten again below.
        log('p1P:', !!p1Pick, 'p2P:', !!p2Pick)
      }

    }

    const c2p = p2Pick != null ? p2Pick.getComponent() : null

    if (c2p) {
      const slot2 = c2p.p
      if (slot2 != null) {
        // Teleport.
        log('teleporting p2Drop via c2 slot2', slot2)
        p2Drop = heldOp2Drop[slot2]
        if (side === RIGHT || op1PickAtOp2Pick[slot2] == null) {
          log('teleporting write')
          if (!(w = heldWrites[slot2])) w = heldWrites[slot2] = writeCursor()
          w.reset()
          removed2 = false
        }
      } else if (c2p.r !== undefined) {
        removed2 = true
      }
    }

    // Now we want to read both teleports for the edit component. This is just
    // used for edits at this point, and it takes into account both teleports.
    // I look for your edit in the place *I moved from* and *you moved to*.
    c2d = p2Drop != null ? p2Drop.getComponent() : null

    // Embedded edits of subtrees. This is tricky because the embedded edit
    // needs to be transformed by op2's drop (if any)
    const t1 = getEditType(c1d)
    if (t1) log('edit:', removed2, c1d, c2d)
    if (!removed2 && t1) {
      const t2 = getEditType(c2d)
      const e1 = getEdit(c1d)
      let e
      if (t2) {
        // TODO: Should this be t1.name vs t2.name ?
        if (t1 !== t2) throw Error("Transforming incompatible types")
        const e2 = getEdit(c2d)
        e = t1.transform(e1, e2, direction)
      } else {
        // TODO: ... check opts.consume here.
        e = deepClone(e1)
      }
      log('write edit', e)
      writeEdit(w, t1, e)

      //writeEdit(w, t1, getEdit(c1d))
    }

    // Ok, now for descent crazy town. This is all needed to deal with keeping
    // track of the indexes of list children.
    let p1PickOff = 0, p1DropOff = 0
    let p2PickOff = 0, p2DropOff = 0
    let outPickOff = 0, outDropOff = 0

    let p1pValid = p1Pick != null ? p1Pick.descendFirst() : false
    let p1pDidDescend = p1pValid

    const ap2p = cursor.advancer(p2Pick, null, (k, c) => {
      if (hasPick(c)) {
        p2PickOff++
        log('p2Pick++', p2PickOff, k, c)
      }
    })
    ap2p._name = '2p'

    // I'm only using one advancer here because it was too hard tracing bugs
    // through two advancers. Simply using bare variables & advancing here
    // results in more code, but its slightly more straightforward because all
    // the state variables are local.

    let p2dValid = p2Drop != null ? p2Drop.descendFirst() : false
    let p2dDidDescend = p2dValid

    log('children.', '1p:', !!p1Pick, '1d:', !!p1Drop, '2p:', !!p2Pick)

    for (const key of p1Drop.children()) {
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

        { // Calculate _p1Pick.
          let p1k
          log.prefix++
          while (p1pValid && typeof (p1k = p1Pick.getKey()) === 'number') {
            p1k += p1PickOff
            const c = p1Pick.getComponent()
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
              const slot = c.p
              //log('xxxx', c, slot, pickComponents[slot])
              if ((c.r !== undefined
                    && (!cancelledRemoves || !cancelledRemoves.has(c)))
                  || (slot != null
                    && (pickComponents[slot] && (side === RIGHT || op1PickAtOp2Pick[slot] == null)))) {
                log('outPickOff-- from pickup')
                outPickOff--
              }
            }
            p1pValid = p1Pick.nextSibling()
          }
          _p1Pick = p1pValid && p1k === k1Mid ? p1Pick : null
          log.prefix--
          log('_p1Pick', !!_p1Pick)
        }

        const raw = k1Mid - p1PickOff // Position of the child before op1 has changed it
        log('ap2p', raw)
        let _p2Pick = ap2p(raw) // Advances p2PickOff.
        log('_p2Pick', !!_p2Pick)

        const k2Mid = raw - p2PickOff

        let _p2Drop = null
        { // Calculate _p2Drop.
          let p2dk, op2Mid
          log('Looking for p2Drop at p2mid', k2Mid)
          log.prefix++
          while (p2dValid && typeof (p2dk = p2Drop.getKey()) === 'number') {
            op2Mid = p2dk - p2DropOff
            const c = p2Drop.getComponent()
            const hd2 = hasDrop(c)
            log('p2d looking at child', p2dk, 'at op2mid', op2Mid, 'target', k2Mid,
              '  / raw', raw, p2DropOff, hd2, hd1)

            if (op2Mid > k2Mid) break

            if (op2Mid === k2Mid) {
              if (hd2) {
                if (side === LEFT && hd1) {
                  _p2Drop = p2Drop
                  break
                }

                // I'm not convinced this logic is correct.. :/
                const hp2 = _p2Pick && hasPick(_p2Pick.getComponent())
                if (side === LEFT && hp2) break
              } else {
                _p2Drop = p2Drop
                break
              }
              /*
              if (side === LEFT && (hd1 || !hd2)
                  || (side === RIGHT && !hd2)) {
                _p2Drop = p2Drop
                break
              }*/
            }

            log('p2d continuing')

            if (hd2) {
              p2DropOff++
              // Ugh to reimplementing the logic of figuring out where I've
              // added picks.
              const slot = c.d
              if ((slot != null)
                  && (cancelledOp2[slot]
                    || ((op1PickAtOp2Pick[slot] != null) && side === LEFT))) {
                log('outPickOff-- from drop')
                outPickOff--
              }

              log('p2Drop++', p2DropOff, op2Mid, c)
            }
            p2dValid = p2Drop.nextSibling()
          }
          //_p2Drop = p2dValid && op2Mid === k2Mid ? p2Drop : null
          log.prefix--
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

      } else {
        // String keys - descending from an object.
        let p1k
        while (p1pValid) { // Skip items in p1Pick until key
          p1k = p1Pick.getKey()
          if (typeof p1k === 'string' && (p1k > key || p1k === key)) break
          p1pValid = p1Pick.nextSibling()
        }
        const _p1Pick = (p1pValid && p1k === key) ? p1Pick : null
        const _p2Pick = ap2p(key)

        let p2dk
        while (p2dValid) {
          p2dk = p2Drop.getKey()
          if (typeof p2dk === 'string' && (p2dk > key || p2dk === key)) break
          p2dValid = p2Drop.nextSibling()
        }
        const _p2Drop = p2dValid && p2dk === key ? p2Drop : null
        // aka, _p2Drop = ap2d(key)

        // And recurse.
        w.descend(key)
        writeOp1Drop(_p1Pick, p1Drop, _p2Pick, _p2Drop, w, removed2)
        w.ascend(key)
      }
    }

    ap2p.end()
    if (p1pDidDescend) p1Pick.ascend()
    if (p2dDidDescend) p2Drop.ascend()
    log.prefix--
    return droppedHere
  }

  log('----- drop -----')
  writeOp1Drop(r1, r1.clone(), r2, r2.clone(), w, false, null)

  w.reset()
  log('half written result', w.get())


  // ---------------------------------------------------------------------
  // Finally copy in the moved writes. Here we need to pass the other readers
  // because we sometimes need to adjust array indexes.

  // This function iterates through the p2 drops, which is in the same context
  // as output picks.
  function writeHeldOp2Pick(p2Drop, outPick, w, removedOut) {
    // These get merged in directly because op2's drop context is the same as
    // the resulting operation's pick context, so we don't need to transform
    // the positions into the output at all.
    const c2 = p2Drop.getComponent()
    if (c2) {
      const slot = c2.d

      if (slot != null) {
        const _w = heldWrites[c2.d]
        if (_w) w.mergeTree(_w.get(), (c, w) => {
          // only copy picks here.
          if (c.r != undefined) w.write('r', c.r)
          if (c.p != null) w.write('p', c.p)
        })
      }

      if (!removedOut && (
          (slot != null && cancelledOp2[slot])
            || (overwrittenDrops && overwrittenDrops.has(c2)))) {
        log('writing cancelled op2')
        w.write('r', true)
        removedOut = true
      }
    }

    const co = outPick ? outPick.getComponent() : null
    if (co && co.r !== undefined) {
      removedOut = true
    }

    const oPickAdv = cursor.advancer(outPick)
    for (const key of p2Drop.children()) {
      w.descend(key)
      writeHeldOp2Pick(p2Drop, oPickAdv(key), w, removedOut)
      w.ascend()
    }
    oPickAdv.end()
  }

  // This iterates through p2Drop
  //
  // Writes are transformed to the context of the output drops.
  function writeHeldOp2Drop(p2Drop, outPick, outDrop, w, parentC) {
    log('writeHeldOp2Drop', !!outPick, !!outDrop, parentC)
    const cout = outPick ? outPick.getComponent() : null
    if (cout && cout.p != null) {
      parentC = cout
    }
    if (cout) log('cout', cout)

    // For drops we need to transform the location by the transform *result*.
    const c2 = p2Drop.getComponent()
    let slot
    if (c2) {
      if ((slot = c2.d) != null) {
        log('c2 drop slot', slot)
        const _w = heldWrites[c2.d]
        if (_w) {
          // Before writing the held write, we need to check that none of the
          // drops have parentC's pick as a direct parent.
          const check = (r) => {
            const c = r.getComponent()
            if (c && c.d != null) {
              log('c.d detected', c.d, slotMapping[c.d], parentC)
              if (slotMapping[c.d] === parentC.p) {
                log('Parent detected!')
                return true
              }
            }
            for (const k of r.children()) {
              if (check(r)) return true
            }
            return false
          }
          if (parentC && check(readCursor(_w.get()))) {
            log('Cancelling blackholed', parentC.p)
            delete parentC.p
            parentC.r = true
          } else {
            w.mergeTree(_w.get(), (c, w) => {
              // merge drops and edits
              if (c.i != undefined) w.write('i', c.i)
              if (c.d != null) w.write('d', c.d)

              const t = getEditType(c)
              if (t) log('merge edit', c)
              if (t) writeEdit(w, t, getEdit(c))
            })

            // TODO: Add tests for this.
            //outDrop = readCursor(_w.get())
            outDrop = null // ???
          }
        }
      }
    }

    let outPickOff = 0, outDropOff = 0

    const oPickAdv = cursor.advancer(outPick, null, (k, c) => {
      if (hasPick(c)) {
        outPickOff--
        log('outPickOff++')
      }
    })

    const oDropAdv = cursor.advancer(outDrop, (k, c) => {
      // TODO: Do we need to skip items here when
      return k - outDropOff
    }, (k, c) => {
      if (hasDrop(c)) {
        outDropOff++
        log('outDropOff++')
      }
    })

    log.prefix++
    for (const o2dk of p2Drop.children()) {
      if (typeof o2dk === 'number') {
        const _outPick = oPickAdv(o2dk)
        const rmid = o2dk + outPickOff
        const _outDrop = oDropAdv(rmid)

        log('->', rmid + outDropOff)

        w.descend(rmid + outDropOff)
        writeHeldOp2Drop(p2Drop, _outPick, _outDrop, w, parentC)
        w.ascend()
      } else {
        log('->', o2dk)

        w.descend(o2dk)
        writeHeldOp2Drop(p2Drop, oPickAdv(o2dk), oDropAdv(o2dk), w, parentC)
        w.ascend()
      }
    }
    log.prefix--

    oPickAdv.end()
    oDropAdv.end()
  }

  log('------ write held picks and drops -----')
  log('held writes', heldWrites.map(h => h.get()))

  if (heldWrites.length || cancelledOp2.length || overwrittenDrops) {
    // This is super nasty. The problem is that we need a read cursor over the
    // output so far, but the output is still mutable (we're going to mutate
    // it). I could avoid the clone entirely by doing the full transform work
    // that op1 drop above does.
    //
    // TODO: Change this at the very least so it only clones the operation
    // lists, not any inserts inside. But better still would be a cursor that
    // supported simultaneous reading and writing.
    const rOut2 = readCursor(shallowCloneOp(w.get()))
    writeHeldOp2Pick(r2, rOut2, w, false)
    w.reset()
    log('-- after writeHeldOp2Pick', w.get())

    const rOut = readCursor(shallowCloneOp(w.get()))
    writeHeldOp2Drop(r2, rOut, rOut.clone(), w, null)
  }

  const result = w.get()
  log('-> xf returning', result)
  log()
  checkOp(result)
  return result
}

if (require.main === module) {
  type.debug = true
  const transformX = (left, right) => (
    [transform(left, right, 'left'), transform(right, left, 'right')]
  )

  debugger

  // transform([["x",{"p":0}],["y","a",{"d":0}]], [["x","a",{"d":0}],["y",{"p":0}]], 'left')
  // transform([["x",{"p":0}],["y","a",{"d":0}]], [["x","a",{"d":0}],["y",{"p":0}]], 'right')

  compose([ 0,
      [ 0, [ 'a', { r: true } ], [ 'b', { d: 0 } ] ],
      [ 2, { p: 0 } ]
    ], [ 0, 0, 'c', { i: 'd' } ])
}

type.debug = !!process.env['DEBUG']

