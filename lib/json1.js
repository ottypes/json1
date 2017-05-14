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
  create(data) {
    // We're assuming the data isn't modified in any way except through
    // operations. Clone if you need to.
    return data === undefined ? null : data
  }
}


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
  if (subtype.uri) subtypes[subtype.uri] = subtype;
}

register(require('ot-text'))


function getType(component) {
  if (component == null) {
    return null;
  } else if (component.et) {
    return subtypes[component.et];
  } else if (component.es) {
    return subtypes.text;
  } else if (component.en) {
    throw Error('Not implemented!');
  } else {
    return null;
  }
}

const getEdit = (component) => component.es || component.en || component.e


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
        || k === 'e' || k === 'es' || k === 'en' || k === 'et')

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
        const t = getType(e)
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


// ***** Apply

type.apply = function(snapshot, op) {
  // Apply op to snapshot. Return the new snapshot.
  //
  // The snapshot is shallow copied as its edited, so the previous snapshot
  // reference is still valid.
  log.quiet = !type.debug;
  //log.quiet = false
  //log('*******************************************');
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
    //log('pick', subDoc, descent);

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
      subDoc = pick(subDoc, descent[j]);
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
        assert(subDoc !== undefined, 'Cannot pick up undefined');
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

        const t = getType(d)
        if (t) { // Edit. Ok because its illegal to drop inside mixed region
          mut(); subDoc = container[key] = t.apply(subDoc, getEdit(d));
        } else if (d.e !== undefined) {
          throw Error("Subtype " + d.et + " undefined");
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

// TODO: compose. This is not yet implemented.
type._compose = function(op1, op2) {
  checkOp(op1);
  checkOp(op2);

  const debug = type.debug;
  if (debug) {
    console.log("composing:");
    console.log('  op1:', JSON.stringify(op1));
    console.log('  op2:', JSON.stringify(op2));
  }

  // Read cursors
  const op1DropBy1 = []; // entry is null if removed by p2.
  const op2PickBy1 = [];

  const op1DropBy2 = [];
  const op2PickBy2 = [];

  const op1DeleteMove = []; // entry is true if drop removed by op2.

  // Because there's no other way (and js maps aren't ready yet at
  // time of writing), the insert data is stored in a list indexed
  // by the strict order of the operation itself.
  // This stores clones of the inserted data, which have then been
  // modified by op2's picks & removes.
  //
  // TODO: JS maps are ready. Refactor this code.
  const op1Inserts = [];
  const op1LiteralAtP2 = [];
  const op2LiteralIdx = [];

  // Scan a literal dropped by op1.
  // This returns the modified literal.
  function scanD1Literal(obj, p2) {
    log('scanBoundaryLiteral', obj);
    const expectKeyType = isObject(obj) ? 'string' : Array.isArray(obj) ? 'number' : null;

    let offset = 0;
    p2.eachChild(key => {
      assert.strictEqual(typeof key, expectKeyType);
      if (expectKeyType === 'number') key -= offset

      const _obj = scanBoundaryLiteral(obj[key], p2);
      if (_obj === undefined) {
        obj = removeChild(obj, key);
        if (typeof key === 'number') offset++
      }
    })

    const c = p2.getComponent()
    if (c) {
      let slot
      if (c.r !== undefined) {
        log('->removed');
        return undefined
      } else if ((slot = c.p) != null) {
        op1LiteralAtP2[slot] = obj;
        log("->picked " + slot);
        return undefined;
      }
    }

    log('->anBoundaryLiteral', obj);
    return obj;
  };

  // There's fundamentally 3 actions we need to take:
  // - Scan the boundary
  // - Write picks
  // - Write drops

  function scanBoundary(d1, p2, removedP2) {
    const cd1 = d1 && d1.getComponent()
    const cp2 = p2 && p2.getComponent()

    if (cp2) {
      let slot2
      if (cp2.r !== undefined) {
        removedP2 = true;
      } else if ((slot2 = cp2.p) != null) {
        removedP2 = false;
        op1DropBy2[slot2] = d1 != null ? d1.clone() : undefined;
        op2PickBy2[slot2] = p2 != null ? p2.clone() : undefined;
        //op2LiteralIdx = op1Inserts.length; TODO: ?????
      }
    }

    if (cd1) {
      let slot1 = cd1.d
      if (slot1 != null) {
        if (!removedP2) {
          op1DropBy1[slot1] = d1 != null ? d1.clone() : undefined;
          op2PickBy1[slot1] = p2 != null ? p2.clone() : undefined;
        }
      } else if (cd1.i !== undefined) {
        if (removedP2) {
          op1Inserts.push(undefined);
        } else {
          const insert = scanD1Literal(deepClone(cd1.i), p2);
          op1Inserts.push(insert);
        }
      }
    }
    eachChildOf(d1, p2, null, null, (key, _d1, _p2) => {
      scanP2(_d1, p2, removedP2)
    })
  };

  function writePick(p1, d1, p2, w, removedP2) {
    var d1c, finalSlot, p1c, p2c, slot1, slot2;
    p1c = p1 != null ? p1.getComponent() : undefined;
    if (p1c) {
      if ((slot1 = p1c.p) != null) {
        p2 = op2PickBy1[slot1];
        d1 = op1DropBy1[slot1];
      }
    }
    d1c = d1 != null ? d1.getComponent() : undefined;
    p2c = p2 != null ? p2.getComponent() : undefined;
    if (!hasDrop(d1c)) {
      assert(!(hasPick(p1c) && hasPick(p2c)));
    }
    if (hasDrop(d1c)) {
      assert(hasPick(p1c));
    }
    if (p2c) {
      if (p2c.r !== undefined) {
        removedP2 = true;
      } else if ((slot2 = p2c.p) != null) {
        removedP2 = false;
        if (!d1) {
          if (!removedP2) {
            w.write('r', true);
          }
        } else if ((slot2 = p2.p) != null) {
          finalSlot = numUsedSlots++;
          slotMap2[slot2] = finalSlot;
          w.write('p', finalSlot);
          removedP2 = false;
        }
      }
    }
    eachChildOf(p1, p2, null, null, (key, _p1, _p2) => {
    })
  };

  const readOp1 = readCursor(op1);
  const readOp2 = readCursor(op2);
  scanBoundary(readOp1, readOp2, false);


  let numUsedSlots = 0;
  const slotMap2 = [];

  log('slotMap1:', slotMap1, 'slotMap2:', slotMap2);
  log('read for p1:');

  /*
  var _r, len, len1, m, p, slot;
  for (slot = m = 0, len = readForP1.length; m < len; slot = ++m) {
    _r = readForP1[slot];
    if (!(_r)) {
      continue;
    }
    log(slot);
    _r.print();
  }
  log('read for d2:');
  for (slot = p = 0, len1 = readForD2.length; p < len1; slot = ++p) {
    _r = readForD2[slot];
    if (!(_r)) {
      continue;
    }
    log(slot);
    _r.print();
  }
  */

  log('---------');
  const w = writeCursor();
  writePick(readOp1, readOp2, w, false);
  w.reset();

  const result = w.get();
  log('-> compose returning', result);
  return result;
};


// ***** Transform

const LEFT = 0, RIGHT = 1

const transform = type.transform = function(op1, op2, direction, opts) {
  assert(direction === 'left' || direction === 'right');
  const side = direction === 'left' ? LEFT : RIGHT;
  const debug = type.debug;
  log.quiet = !debug;

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
  // Basically, we have 4 mini operations between the two ops:
  // - op1 picks
  // - op1 drops
  // - op2 picks
  // - op2 drops
  //
  // There's effectively 2 transformations that have to take place:
  // 1. op1's picks. Effectively, this needs to be transformed by [op2 pick,
  // op2 drop].
  // 2. op1's drops. This is where it gets fun. Because the positions in op1's
  // drops track positions already modified by op1's picks, we need to figure
  // out where they *would* be without op1's drops. Then transform through
  // op2's picks and drops, and finally re-transform by op1's picks.
  //
  // We do this work in 5 steps:
  // - Scan op2 picks
  // - Scan op2 drops, op1 moves into deleted regions as removes.
  // - Scan op1 picks. Transform by op2
  // - Scan op1 drops. Transform back by op1 picks, by op2, then by op1 picks again.
  // - Finally collate all writes together.
  

  // Indexed by op2's slots.
  //
  // These arrays hold read cursors into the op1 picks & op2 drops because we
  // need to parse them out-of-order. When we see this stuff the first time, we
  // mark & skip it. Then we descend in using the cursor clone when we need to.
  const heldOp1Pick = [] // Cloned *read* cursors for teleporting.
  const heldOp2Drop = []

  // Map from op2's slots -> true if the item has been removed by op1.
  const cancelledOp2 = []

  // This is a list of write cursors, indexed by op2 slot numbers. This is used
  // to stage any operations that have been moved by op2. Anything in the
  // designated held write will be written out at the appropriate op2 pick /
  // drop location.
  const heldWrites = []

  const op1PickAtOp2Pick = [];
  
  let nextSlot = 0;
  // const slotMap = []
  
  const r1 = readCursor(op1)
  const r2 = readCursor(op2)
  const w = writeCursor() // Output.

  // ---------------------------------------------------------------------
  // Before anything else we need to do a preliminary scan of op2's pick for
  // bookkeeping, marking:
  // - op2 moves of items which op1 has removed
  // - shared pickup locations between the two ops. Note no transform needed for this here.
  function scanOp2Pick(r2, r1, removed1) { // r1 might be null.
    const c1 = r1 ? r1.getComponent() : null
    if (c1) {
      if (c1.r !== undefined) removed1 = true
      else if (c1.p != null) removed1 = false
    }

    const c2 = r2.getComponent()
    let slot2
    if (c2 && ((slot2 = c2.p) != null)) {
      log(slot2, c1, c2)
      if (removed1) {
        cancelledOp2[slot2] = true

        //const w = heldWrites[slot2] = writeCursor()
        //w.write('r', true)

        log('Cancelled op2 slot', slot2)
      }

      // If this happens it means both operations picked up the same element.
      // One operation's move will be cancelled based on symmetry.
      if (c1 && c1.p != null) op1PickAtOp2Pick[slot2] = c1.p
    }

    // ... And recurse.
    const ap1 = cursor.advancer(r1)
    r2.eachChild(key => {
      log('in', key)
      scanOp2Pick(r2, ap1(key), removed1)
      log('out', key)
    })
    ap1.end()
  }

  scanOp2Pick(r2, r1, false)
  log('op1PickAtOp2Pick', op1PickAtOp2Pick)
  log('cancelled', cancelledOp2)
  
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
    r2Drop.eachChild(key => {
      scanOp2Drop(r2Drop)
    })
  }

  scanOp2Drop(r2);

  log('held op2 drop', heldOp2Drop.map(x => !!x))

  // ---------------------------------------------------------------------

  // We could almost (but not quite) double up on pickComponents and
  // heldOp1Pick --- heldOp1Pick shows us the original component, but
  // pickComponents are actually write components, so its no good.
  const pickComponents = []

  let cancelledRemoves = null // Lazy initialized set

  // This handles the pick phase of op (r1). Picks and removes in r1Pick are
  // transformed via op2 (r2Pick and r2Drop) and written into writer w.
  //
  // removed tracks op2's removals.
  function op1Pick(r1Pick, r2Pick, r2Drop, w, removed2) {
    log('op1Pick')
    log.prefix++
    // p1Pick and w are always defined. Either or both of r2Pick and r2Drop
    // could be null.
    let iAmMoved = false;

    const c2 = r2Pick ? r2Pick.getComponent() : null
    if (c2) {
      const slot = c2.p
      if (slot != null) {
        // op2 has moved the item we're descending into. Instead of taking
        // picks from the original (source) location, take them from the
        // destination location.
        log('teleporting via slot', slot)
        r2Drop = heldOp2Drop[slot]
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
        heldOp1Pick[slot] = r1Pick.clone();
      } else if (c1.r !== undefined) {
        // Copy the remove from op1.
        if (!removed2) {
          log('writing remove')
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
    let p2PickOff = 0, p2DropOff = 0;

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

    log('children', '2p', !!r2Pick, '2d', !!r2Drop);
    r1Pick.eachChild(key => {
      if (typeof key === 'string') {
        log('string key', key);
        const p2Pick_ = ap2Pick(key);
        const p2Drop_ = ap2Drop(key);

        w.descend(key);
        op1Pick(r1Pick, p2Pick_, p2Drop_, w, removed2);
        w.ascend();
      } else {
        const p2Pick_ = ap2Pick(key);
        const p2Mid = key - p2PickOff;
        const p2Drop_ = ap2Drop(p2Mid);
        const finalKey = p2Mid + p2DropOff;

        log("k" + key + " -> m" + p2Mid + " -> f" + finalKey);
        assert(finalKey >= 0);

        w.descend(finalKey);
        op1Pick(r1Pick, p2Pick_, p2Drop_, w, removed2);
        w.ascend();
      }
    })
    ap2Pick.end()
    ap2Drop.end()
    log.prefix--
  }

  log('---- pick ----')
  op1Pick(r1, r2, r2.clone(), w, false)
  w.reset()

  log('held picks', heldOp1Pick.map(x => x.getComponent()))
  log('pc', pickComponents)

  // ---------------------------------------------------------------------

  // op2 inserts and drops which are being overwritten by op1. Only used on LEFT.
  let overwrittenDrops = null

  // Finally the big one. This handles the semantics of op1's drop phase (move
  // drop and insert). This is complicated because the drop phase inside the op
  // is pre-transformed by op1's pick phase, which we have to account for when
  // we're transforming.
  //
  // Removed tracks op2's pick removals.
  function writeOp1Drop(p1Pick, p1Drop, p2Pick, p2Drop, w, removed) {
    assert(p1Drop)
    const c1d = p1Drop.getComponent()
    log('drop', !!p1Pick, !!p1Drop, !!p2Pick, !!p2Drop, 'c:', c1d)
    log.prefix++

    let c2d = p2Drop ? p2Drop.getComponent() : null // non-const for teleporting.
    let droppedHere = false

    if (c1d) {
      const slot1 = c1d.d
      if (slot1 != null) p1Pick = heldOp1Pick[slot1]

      const pc = slot1 != null ? pickComponents[slot1] : null
      if (c1d.i !== undefined || ((slot1 != null) && pc)) {
        // Times to write:
        // - There is no c2 drop
        // - The other drop has been cancelled
        // - We are left (and then we also need to remove)
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
            identical = deepEqual(c2d.i, c1d.i)
            write = side === LEFT
          }
        }

        if (!identical) {
          if (!removed && write) {
            // Copy the drops.
            if (c1d.d != null) {
              log('copying the drop', c1d.d, 'using new slot', nextSlot)
              w.write('d', pc.p = nextSlot++)
              droppedHere = true
            } else if (c1d.i !== undefined) {
              w.write('i', deepClone(c1d.i)) // TODO: Only clone based on opts.consume.
              droppedHere = true
            }

            if (hasDrop(c2d) && ((c1d.d != null) && cancelledOp2[c1d.d])) {
              assert(w.getComponent().r != undefined)
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
            removed = true
          }
        }
      } else if ((slot1 != null) && !pc) {
        // I'm not 100% sure this is the right implementation of the logic I want here.
        removed = true
      }
    }

    const c2p = p2Pick != null ? p2Pick.getComponent() : null
    if (c2p) {
      const slot = c2p.p
      if (slot != null) {
        // Teleport.
        log('teleport via c2 slot', slot)
        p2Drop = heldOp2Drop[slot]
        c2d = p2Drop != null ? p2Drop.getComponent() : null
        if (!(w = heldWrites[slot])) w = heldWrites[slot] = writeCursor()
        w.reset()
        removed = false
      } else if (c2p.r !== undefined) {
        removed = true
      }
    }

    // Embedded edits of subtrees.
    log('edit:', removed, c1d, c2d)
    const t1 = getType(c1d)
    if (!removed && t1) {
      const t2 = getType(c2d)
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
      if (t1 === subtypes.text) {
        w.write('es', e) // Text edit-string operation.
      } else { // TODO: Also if t1 === subtypes.number then write en...
        w.write('et', c1d.et) // Generic embedded edit.
        w.write('e', e)
      }
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

    p1Drop.eachChild(key => {
      log('**** p1Drop looking at child', key)
      // Ok... time for crazy.
      if (typeof key === 'number') {
        // *********** Array children.

        var _p1Pick
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

        if (writeOp1Drop(_p1Pick, p1Drop, _p2Pick, _p2Drop, w, removed)) outDropOff++
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
        writeOp1Drop(_p1Pick, p1Drop, _p2Pick, _p2Drop, w, removed)
        w.ascend(key)
      }
    })

    ap2p.end()
    if (p1pDidDescend) p1Pick.ascend()
    if (p2dDidDescend) p2Drop.ascend()
    log.prefix--
    return droppedHere
  }

  log('----- drop -----')
  writeOp1Drop(r1, r1.clone(), r2, r2.clone(), w, false)

  w.reset()


  // ---------------------------------------------------------------------
  // Finally copy in the moved writes. Here we need to pass the other readers
  // because we sometimes need to adjust array indexes.
  
  // This function iterates through the p2 drops, which is in the same context
  // as output picks.
  function writeHeldPicks(p2Drop, outPick, w, removedOut) {
    // These get merged in directly because op2's drop context is the same as
    // the resulting operation's pick context, so we don't need to transform
    // the positions into the output at all.
    const c2 = p2Drop.getComponent()
    if (c2) {
      const slot = c2.d

      if (slot != null) {
        const _w = heldWrites[c2.d]
        if (_w) w.mergeTree(_w.get(), true, false) // only copy picks
      }

      if (!removedOut && (
          (slot != null && cancelledOp2[c2.d])
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
    p2Drop.eachChild(key => {
      w.descend(key)
      writeHeldPicks(p2Drop, oPickAdv(key), w, removedOut)
      w.ascend()
    })
    oPickAdv.end()
  }

  // This iterates through p2Drop in the context of the output drops.
  function writeHeldDrops(p2Drop, outPick, outDrop, w) {
    // For drops we need to transform the location by the transform *result*.
    const c2 = p2Drop.getComponent()
    if (c2 && (c2.d != null)) {
      const _w = heldWrites[c2.d]
      if (_w) {
        w.mergeTree(_w.get(), false, true) // only merge writes

        // TODO: Add tests for this.
        //outDrop = readCursor(_w.get())
        outDrop = null // ???
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
      return k - outDropOff
    }, (k, c) => {
      if (hasDrop(c)) {
        outDropOff++
        log('outDropOff++')
      }
    })

    p2Drop.eachChild(o2dk => {
      if (typeof o2dk === 'number') {
        const _outPick = oPickAdv(o2dk)
        const rmid = o2dk + outPickOff
        const _outDrop = oDropAdv(rmid)

        w.descend(o2dk + outPickOff + outDropOff)
        writeHeldDrops(p2Drop, _outPick, _outDrop, w)
        w.ascend()

      } else {
        w.descend(o2dk)
        writeHeldDrops(p2Drop, outPick, outDrop, w)
        w.ascend()
      }
    })

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
    const rOut2 = readCursor(deepClone(w.get()))
    writeHeldPicks(r2, rOut2, w, false)
    w.reset()

    const rOut = readCursor(deepClone(w.get()))
    writeHeldDrops(r2, rOut, rOut.clone(), w)
  }

  const result = w.get()
  log('-> xf returning', result)
  log()
  checkOp(result)
  return result
}

if (require.main === module) {
  type.debug = true;
  const transformX = (left, right) => (
    [transform(left, right, 'left'), transform(right, left, 'right')]
  )

  //transformX([['x',{p:0}], ['y','a',{d:0}]], [['x','a',{d:0}], ['y',{p:0}]])

  //transformX([[3, {p:0, i:'hi'}], [10, {d:0}]], [3, {r:true}])
  //transformX([[1, {p:0, i:'whw'}], [3, {i:'hi'}], [5, {d:0}]], [1, {r:true}])
  //transform([0, {r:1}, 1, {i:'hi'}], [1, {p:0, d:0}, 0, {i:'yo'}], 'left')
  //transform([[0, {p:0}],[1, {d:0}]], [1, {p:0,d:0}], 'left')

  type.apply([ [ [ 'He', '' ] ] ], [ 0, { d: 0 }, 0, 0, { p: 0 } ])
}

type.debug = !!process.env['DEBUG'];

