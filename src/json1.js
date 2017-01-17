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
const {readCursor, writeCursor} = cursor = require('./cursor')
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
    assert(Array.isArray(container))
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
  log.quiet = true;
  log('*******************************************');
  log('apply', snapshot, op)
  checkOp(op)

  // Technically the snapshot should *never* be undefined, but I'll quietly
  // convert it to null if it is.
  if (snapshot === undefined) snapshot = null

  if (op === null) return snapshot

  const held = [] // Indexed by the pick #. Autoexpand.

  // The op is made up of lists. Each list item is one of three things:
  // - A descent (a scalar value to descend into either a list or an object at
  //   the current location). Except for at the root there is always at least 1 of these.
  // - An edit - which is a pick, a drop or an edit.
  // - A child descent. These are always at the end of the list. We recurse for these.

  // Phase 1: Pick. Returns updated subdocument.
  function pick(subDoc, descent) {
    log('pick', subDoc, descent);

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

  log('--- after pick phase ---')
  log('held', held, 'snapshot', snapshot)

  function drop(root, descent) {
    // The document might have already been cloned in-place. If it has we'll
    // still throw it out and make a new one. This should be pretty quick but
    // if its a problem we could optimize it by making a editable Set with
    // everything we've cloned (and thus is safe to edit)
    //
    // I think it should be safe anyway because short lived objects are pretty
    // cheap in a modern generational GC.
 
    let subDoc = root, i = 0 // For reading
    let rootContainer = [root]
    let m = 0, container = rootContainer, key = 0 // For writing

    function mut() {
      for (; m < i; m++) {
        let d = descent[m]
        if (typeof d === 'object') continue

        log('descent', d, container, key)
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

        if ((t = getType(d))) { // Edit. Ok because its illegal to drop inside mixed region
          mut(); subDoc = container[key] = t.apply(subDoc, getEdit(d));
        } else if (d.e !== undefined) {
          throw Error("Subtype " + d.et + " undefined");
        }

      } else {
        // Scalar. Descend.
        subDoc = subDoc != null ? subDoc[d] : undefined
      }
    }
    
    return rootContainer[0]
  }

  snapshot = drop(snapshot, op)
  return snapshot
}


// XXXXXXX
// ****** Compose


type._compose = function(op1, op2) {
  var _r, debug, len, len1, m, numUsedSlots, op1DeleteMove, op1DropBy1, op1DropBy2, op1Inserts, op1LiteralAtP2, op2LiteralIdx, op2PickBy1, op2PickBy2, p, readOp1, readOp2, result, scanBoundary, scanD1Literal, slot, slotMap2, w, writePick;
  checkOp(op1);
  checkOp(op2);
  debug = type.debug;
  if (debug) {
    console.log("composing:");
    console.log('  op1:', JSON.stringify(op1));
    console.log('  op2:', JSON.stringify(op2));
  }
  op1DropBy1 = [];
  op2PickBy1 = [];
  op1DropBy2 = [];
  op2PickBy2 = [];
  op1DeleteMove = [];
  op1Inserts = [];
  op1LiteralAtP2 = [];
  op2LiteralIdx = [];
  scanD1Literal = function(obj, p2) {
    var c, expectKeyType, offset, slot;
    log('scanBoundaryLiteral', obj);
    expectKeyType = isObject(obj) ? 'string' : Array.isArray(obj) ? 'number' : null;
    offset = 0;
    p2.eachChild(function(key) {
      var _obj;
      assert.strictEqual(typeof key, expectKeyType);
      if (expectKeyType === 'number') {
        key -= offset;
      }
      _obj = scanBoundaryLiteral(obj[key], p2);
      if (_obj === void 0) {
        obj = removeChild(obj, key);
        if (typeof key === 'number') {
          return offset++;
        }
      }
    });
    if ((c = p2.getComponent())) {
      if (c.r !== void 0) {
        log('->removed');
        return void 0;
      } else if ((slot = c.p) != null) {
        op1LiteralAtP2[slot] = obj;
        log("->picked " + slot);
        return void 0;
      }
    }
    log('->anBoundaryLiteral', obj);
    return obj;
  };
  scanBoundary = function(d1, p2, removedP2) {
    var cd1, cp2, insert, slot1, slot2;
    cd1 = d1 != null ? d1.getComponent() : void 0;
    cp2 = p2 != null ? p2.getComponent() : void 0;
    if (cp2) {
      if (cp2.r !== void 0) {
        removedP2 = true;
      } else if ((slot2 = cp2.p) != null) {
        removedP2 = false;
        op1DropBy2[slot2] = d1 != null ? d1.clone() : void 0;
        op2PickBy2[slot2] = p2 != null ? p2.clone() : void 0;
        op2LiteralIdx = op1Inserts.length;
      }
    }
    if (cd1) {
      if ((slot1 = cd1.d) != null) {
        if (!removedP2) {
          op1DropBy1[slot1] = d1 != null ? d1.clone() : void 0;
          op2PickBy1[slot1] = p2 != null ? p2.clone() : void 0;
        }
      } else if (cd1.i !== void 0) {
        if (removedP2) {
          op1Inserts.push(void 0);
        } else {
          insert = scanD1Literal(deepClone(cd1.i), p2);
          op1Inserts.push(insert);
        }
      }
    }
    return cursor.eachChildOf(d1, p2, null, null, function(key, _d1, _p2) {
      return scanP2(_d1, p2, removedP2);
    });
  };
  readOp1 = readCursor(op1);
  readOp2 = readCursor(op2);
  scanP2(readOp1, readOp2, false);
  numUsedSlots = 0;
  slotMap2 = [];
  writePick = function(p1, d1, p2, w, removedP2) {
    var d1c, finalSlot, p1c, p2c, slot1, slot2;
    p1c = p1 != null ? p1.getComponent() : void 0;
    if (p1c) {
      if ((slot1 = p1c.p) != null) {
        p2 = op2PickBy1[slot1];
        d1 = op1DropBy1[slot1];
      }
    }
    d1c = d1 != null ? d1.getComponent() : void 0;
    p2c = p2 != null ? p2.getComponent() : void 0;
    if (!hasDrop(d1c)) {
      assert(!(hasPick(p1c) && hasPick(p2c)));
    }
    if (hasDrop(d1c)) {
      assert(hasPick(p1c));
    }
    if (p2c) {
      if (p2c.r !== void 0) {
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
    return cursor.eachChildOf(p1, p2, null, null, function(key, _p1, _p2) {});
  };
  readOp1 = readCursor(op1);
  readOp2 = readCursor(op2);
  scanBoundary(readOp1, readOp2, false);
  log('slotMap1:', slotMap1, 'slotMap2:', slotMap2);
  log('read for p1:');
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
  log('---------');
  w = writeCursor();
  writePick(readOp1, readOp2, w, false);
  w.reset();
  result = w.get();
  log('->', result);
  return result;
};


// ***** Transform

const LEFT = 0, RIGHT = 1

const transform = type.transform = function(oldOp, otherOp, direction) {
  var cancelledOp2, debug, emplaceWrites, heldOp1Pick, heldOp2Drop, heldWrites, nextSlot, op1PickAtOp2Pick, opDrop, opPick, p1, p2, pickComponents, result, scanOp2DropAndCancel, scanOp2Pick, side, w, x;
  assert(direction === 'left' || direction === 'right');
  side = direction === 'left' ? LEFT : RIGHT;
  debug = type.debug;
  log.quiet = !debug;
  if (debug) {
    console.log("transforming " + direction + ":");
    console.log('op1', JSON.stringify(oldOp));
    console.log('op2', JSON.stringify(otherOp));
  }
  checkOp(oldOp);
  checkOp(otherOp);
  heldOp1Pick = [];
  heldOp2Drop = [];
  cancelledOp2 = [];
  op1PickAtOp2Pick = [];
  nextSlot = 0;
  p1 = readCursor(oldOp);
  p2 = readCursor(otherOp);
  w = writeCursor();
  scanOp2Pick = function(p1, p2, removed) {
    var ap1, c1, c2, slot1, slot2;
    if ((c1 = p1 != null ? p1.getComponent() : void 0)) {
      if (c1.r !== void 0) {
        removed = true;
      } else if (c1.p != null) {
        removed = false;
      }
    }
    if ((c2 = p2.getComponent()) && ((slot2 = c2.p) != null)) {
      log(slot2, c1, c2);
      if (removed) {
        cancelledOp2[slot2] = true;
      }
      if ((slot1 = c1 != null ? c1.p : void 0) != null) {
        op1PickAtOp2Pick[slot2] = slot1;
      }
    }
    ap1 = cursor.advancer(p1);
    p2.eachChild(function(key) {
      log('in', key);
      scanOp2Pick(ap1(key), p2, removed);
      return log('out', key);
    });
    return ap1.end();
  };
  scanOp2Pick(p1, p2, false);
  scanOp2DropAndCancel = function(p2, p1, w, removed) {
    var ap1, c1, c2, slot;
    if ((c1 = p1 != null ? p1.getComponent() : void 0)) {
      if (c1.r !== void 0) {
        removed = true;
      }
      if (c1.p != null) {
        removed = false;
      }
    }
    if ((c2 = p2.getComponent()) && ((slot = c2.d) != null)) {
      heldOp2Drop[slot] = p2.clone();
      if (!removed && cancelledOp2[slot]) {
        w.write('r', true);
        removed = true;
      }
    }
    ap1 = cursor.advancer(p1);
    p2.eachChild(function(key) {
      w.descend(key);
      scanOp2DropAndCancel(p2, ap1(key), w, removed);
      return w.ascend(key);
    });
    return ap1.end();
  };
  scanOp2DropAndCancel(p2, p1, w, false);
  w.reset();
  log('hd', (function() {
    var len, m, results;
    results = [];
    for (m = 0, len = heldOp2Drop.length; m < len; m++) {
      x = heldOp2Drop[m];
      results.push(!!x);
    }
    return results;
  })());
  heldWrites = [];
  pickComponents = [];
  opPick = function(p1Pick, p2Pick, p2Drop, w, removed) {
    var ap2Drop, ap2Pick, c1, c2, iAmMoved, p2DropOff, p2PickOff, slot;
    iAmMoved = false;
    if ((c2 = p2Pick != null ? p2Pick.getComponent() : void 0)) {
      if ((slot = c2.p) != null) {
        p2Drop = heldOp2Drop[slot];
        w = heldWrites[slot] = writeCursor();
        iAmMoved = true;
        removed = false;
      } else if (c2.r !== void 0) {
        removed = true;
      }
    }
    if ((c1 = p1Pick.getComponent())) {
      if ((slot = c1.p) != null) {
        log('rrr', removed, side, iAmMoved);
        pickComponents[slot] = removed || (side === RIGHT && iAmMoved) ? (log("cancelling " + slot), null) : w.getComponent();
        heldOp1Pick[slot] = p1Pick.clone();
      } else if (c1.r !== void 0 && !removed) {
        w.write('r', true);
      }
    }
    p2PickOff = p2DropOff = 0;
    ap2Pick = cursor.advancer(p2Pick, null, function(k, c) {
      if (hasPick(c)) {
        p2PickOff++;
        return log('p2Pick++', p2PickOff, k, c);
      }
    });
    ap2Pick._name = '2pick';
    ap2Drop = cursor.advancer(p2Drop, function(k, c) {
      if (hasDrop(c)) {
        return -(k - p2DropOff) - 1;
      } else {
        return k - p2DropOff;
      }
    }, function(k, c) {
      if (hasDrop(c)) {
        p2DropOff++;
        return log('p2Drop++', p2DropOff, k, c);
      }
    });
    ap2Drop._name = '2drop';
    log('children', '2p', !!p2Pick, '2d', !!p2Drop);
    p1Pick.eachChild(function(key) {
      var finalKey, p2Drop_, p2Mid, p2Pick_;
      if (typeof key === 'string') {
        log('string key', key);
        p2Pick_ = ap2Pick(key);
        p2Drop_ = ap2Drop(key);
        w.descend(key);
        opPick(p1Pick, p2Pick_, p2Drop_, w, removed);
        return w.ascend();
      } else {
        p2Pick_ = ap2Pick(key);
        p2Mid = key - p2PickOff;
        p2Drop_ = ap2Drop(p2Mid);
        finalKey = p2Mid + p2DropOff;
        log("k" + key + " -> m" + p2Mid + " -> f" + finalKey);
        assert(finalKey >= 0);
        w.descend(finalKey);
        opPick(p1Pick, p2Pick_, p2Drop_, w, removed);
        return w.ascend();
      }
    });
    ap2Pick.end();
    return ap2Drop.end();
  };
  log('---- pick ----');
  opPick(p1, p2, p2.clone(), w, false);
  w.reset();
  log('hp', (function() {
    var len, m, results;
    results = [];
    for (m = 0, len = heldOp1Pick.length; m < len; m++) {
      x = heldOp1Pick[m];
      results.push(x.getComponent());
    }
    return results;
  })());
  log('pc', pickComponents);
  log('cancelled', cancelledOp2);
  opDrop = function(p1Pick, p1Drop, p2Pick, p2Drop, w, removed) {
    var ap2p, c1d, c2d, c2p, droppedHere, e, e1, e2, identical, inserted, outDropOff, outPickOff, p1DropOff, p1PickOff, p1pDidDescend, p1pValid, p2DropOff, p2PickOff, p2dDidDescend, p2dValid, pc, slot, slot1, slot2, t1, t2, write;
    log('drop', !!p1Pick, !!p1Drop, !!p2Pick, !!p2Drop);
    c1d = p1Drop.getComponent();
    c2d = p2Drop != null ? p2Drop.getComponent() : void 0;
    droppedHere = false;
    if (c1d) {
      slot1 = c1d.d;
      if (slot1 != null) {
        p1Pick = heldOp1Pick[slot1];
      }
      if (c1d.i !== void 0 || ((slot1 != null) && (pc = pickComponents[slot1]))) {
        write = true;
        identical = false;
        log('looking to write', c1d, c2d, cancelledOp2);
        if (c2d) {
          if ((slot2 = c2d.d) != null) {
            if (cancelledOp2[slot2]) {
              write = true;
            } else {
              write = side === LEFT;
              identical = (slot1 != null) && slot1 === op1PickAtOp2Pick[slot2];
            }
          } else if ((inserted = c2d.i) !== void 0) {
            identical = deepEqual(inserted, c1d.i);
            write = side === LEFT;
          }
        }
        if (!identical) {
          if (!removed && write) {
            if (c1d.d != null) {
              w.write('d', pc.p = nextSlot++);
              droppedHere = true;
            } else if (c1d.i !== void 0) {
              w.write('i', deepClone(c1d.i));
              droppedHere = true;
            }
            if (hasDrop(c2d) && ((c1d.d != null) && cancelledOp2[c1d.d])) {
              assert(w.getComponent().r);
            }
            if (hasDrop(c2d)) {
              w.write('r', true);
            }
          } else {
            log("Halp! We're being overwritten!");
            if (pc) {
              pc.r = true;
            }
            removed = true;
          }
        }
      } else if ((c1d.d != null) && !pickComponents[c1d.d]) {
        removed = true;
      }
    }
    if ((c2p = p2Pick != null ? p2Pick.getComponent() : void 0)) {
      if ((slot = c2p.p) != null) {
        p2Drop = heldOp2Drop[slot];
        c2d = p2Drop != null ? p2Drop.getComponent() : void 0;
        if (!(w = heldWrites[slot])) {
          w = heldWrites[slot] = writeCursor();
        }
        w.reset();
        removed = false;
      } else if (c2p.r !== void 0) {
        removed = true;
      }
    }
    log('edit:', removed, c1d, c2d);
    if (!removed && (t1 = getType(c1d))) {
      e1 = getEdit(c1d);
      if ((t2 = getType(c2d))) {
        if (t1 !== t2) {
          throw Error("Transforming incompatible types");
        }
        e2 = getEdit(c2d);
        e = t1.transform(e1, e2, direction);
      } else {
        e = deepClone(e1);
      }
      if (t1 === subtypes.text) {
        w.write('es', e);
      } else {
        w.write('et', c1d.et);
        w.write('e', e);
      }
    }
    p1PickOff = p1DropOff = 0;
    p2PickOff = p2DropOff = 0;
    outPickOff = outDropOff = 0;
    p1pValid = p1pDidDescend = p1Pick != null ? p1Pick.descendFirst() : void 0;
    ap2p = cursor.advancer(p2Pick, null, function(k, c) {
      if (hasPick(c)) {
        p2PickOff++;
        return log('p2Pick++', p2PickOff, k, c);
      }
    });
    ap2p._name = '2p';
    p2dValid = p2dDidDescend = p2Drop != null ? p2Drop.descendFirst() : void 0;
    log('children.', '1p:', !!p1Pick, '1d:', !!p1Drop, '2p:', !!p2Pick);
    p1Drop.eachChild(function(key) {
      var _p1Pick, _p2Drop, _p2Pick, iHaveDrop, k1Mid, k2Final, k2Mid, p1k, p2dk, raw;
      if (typeof key === 'string') {
        while (p1pValid) {
          p1k = p1Pick.getKey();
          if (typeof p1k === 'string' && (p1k > key || p1k === key)) {
            break;
          }
          p1pValid = p1Pick.nextSibling();
        }
        _p1Pick = p1pValid && p1k === key ? p1Pick : null;
        _p2Pick = ap2p(key);
        while (p2dValid) {
          p2dk = p2Drop.getKey();
          if (typeof p2dk === 'string' && (p2dk > key || p2dk === key)) {
            break;
          }
          p2dValid = p2Drop.nextSibling();
        }
        _p2Drop = p2dValid && p2dk === key ? p2Drop : null;
        w.descend(key);
        opDrop(_p1Pick, p1Drop, _p2Pick, _p2Drop, w, removed);
        return w.ascend(key);
      } else {
        log('p1DropEachChild k:', key, 'p1d:', p1DropOff, 'p1p:', p1PickOff, 'p2p:', p2PickOff, 'p2d:', p2DropOff, 'op:', outPickOff, 'od:', outDropOff);
        iHaveDrop = hasDrop(p1Drop.getComponent());
        k1Mid = key - p1DropOff;
        (function() {
          var c, hp;
          while (p1pValid && typeof (p1k = p1Pick.getKey()) === 'number') {
            p1k -= p1PickOff;
            hp = hasPick((c = p1Pick.getComponent()));
            log('p1k', p1k, 'k1mid', k1Mid, 'hp', hp);
            if (p1k > k1Mid || (p1k === k1Mid && (!hp || (side === LEFT && iHaveDrop)))) {
              break;
            }
            if (hp) {
              log('plus plus');
              p1PickOff++;
              outPickOff++;
            }
            p1pValid = p1Pick.nextSibling();
          }
          return _p1Pick = p1pValid && p1k === k1Mid ? p1Pick : null;
        })();
        raw = k1Mid + p1PickOff;
        _p2Pick = ap2p(raw);
        k2Mid = raw - p2PickOff;
        (function() {
          var c, hd;
          while (p2dValid && typeof (p2dk = p2Drop.getKey()) === 'number') {
            p2dk -= p2DropOff;
            hd = hasDrop((c = p2Drop.getComponent()));
            log('p2d scan', p2dk, p2DropOff, k2Mid, hd, iHaveDrop);
            if (p2dk > k2Mid) {
              break;
            }
            if (p2dk === k2Mid) {
              if (side === LEFT && iHaveDrop || !hd) {
                break;
              }
              if (side === RIGHT && !hd) {
                break;
              }
            }
            log('p2d continuing');
            if (hd) {
              p2DropOff++;
              if (((slot = c.d) != null) && (cancelledOp2[slot] || ((op1PickAtOp2Pick[slot] != null) && side === LEFT))) {
                outPickOff++;
              }
              log('p2Drop++', p2DropOff, p2dk, c);
            }
            p2dValid = p2Drop.nextSibling();
          }
          return _p2Drop = p2dValid && p2dk === k2Mid ? p2Drop : null;
        })();
        k2Final = k2Mid + p2DropOff;
        log('->DropEachChild k:', key, 'p1d:', p1DropOff, 'p1p:', p1PickOff, 'raw:', raw, 'p2p:', p2PickOff, 'p2d:', p2DropOff, 'op:', outPickOff, 'od:', outDropOff);
        log("k: " + key + " -> mid " + k1Mid + " -> raw " + raw + " -> k2Mid " + k2Mid + " -> k2Final " + k2Final + " -> descend " + (k2Final - outPickOff + outDropOff));
        w.descend(k2Final - outPickOff + outDropOff);
        if (iHaveDrop) {
          _p1Pick = _p2Pick = _p2Drop = null;
          log('omg p1dropoff', p1DropOff);
          p1DropOff++;
        }
        if (opDrop(_p1Pick, p1Drop, _p2Pick, _p2Drop, w, removed)) {
          outDropOff++;
        }
        return w.ascend();
      }
    });
    ap2p.end();
    if (p1pDidDescend) {
      p1Pick.ascend();
    }
    if (p2dDidDescend) {
      p2Drop.ascend();
    }
    return droppedHere;
  };
  log('----- drop -----');
  opDrop(p1, p1.clone(), p2, p2.clone(), w, false);
  w.reset();
  emplaceWrites = function(p2Drop, w) {
    var _w, c2, slot;
    if ((c2 = p2Drop.getComponent()) && ((slot = c2.d) != null)) {
      _w = heldWrites[slot];
      if (_w) {
        w.mergeTree(_w.get());
      }
    }
    return p2Drop.eachChild(function(key) {
      w.descend(key);
      emplaceWrites(p2Drop, w);
      return w.ascend();
    });
  };
  emplaceWrites(p2, w);
  result = w.get();
  log('->', result);
  checkOp(result);
  return result;
};

if (require.main === module) {
  type.debug = true;
  transformX = function(left, right) {
    return [transform(left, right, 'left'), transform(right, left, 'right')];
  };
  transformX([['x',{p:0}], ['y','a',{d:0}]], [['x','a',{d:0}], ['y',{p:0}]]);
}

type.debug = !!process.env['DEBUG'];
