# This is the JSON OT type implementation. It is a successor to JSON0
# (https://github.com/ottypes/json0), better in a bunch of ways.
#
# This type follows after the text type. Instead of operations being a list of
# small changes, an operation is a tree mirroring the structure of the document
# itself. Operations contain three things:
# - Edits
# - Pick up operations
# - Drop operations
#
# The complete spec is in spec.md alongside this file.
#
#
# ** This is still a work in progress. The tests don't all pass yet. **
#
# My TODO list:
# - Feature parity with the old version
# - Embedded subtypes
# - Explicit embedding of string, number operations
# - Compose function
# - Fuzzer, fix bugs
# - Transform - fix list reverse transform code to look like list6.coffee
# - Specify a backup move location in the op
# - Transitive deletes in transform ('delete follows an escapee' test)
# - Conversion between json1 ops and json0, json-patch.
# - Port to JS.

assert = require 'assert'
log = require './log'

isObject = (o) -> o && typeof(o) is 'object' && !Array.isArray(o)

clone = (old) ->
  return null if old is null

  if Array.isArray old
    l = new Array old.length
    l[i] = v for v, i in old
    return l
  else if typeof old == 'object'
    o = {}
    o[k] = v for k, v of old
    return o
  else
    # Everything else in JS is immutable.
    return old

hasPick = (op) -> op && (op.p? || op.r != undefined)
hasDrop = (op) -> op && (op.d? || op.i != undefined)

removeChild = (container, key) ->
  assert container?
  removed = container[key]
  if typeof key is 'number' # Removing from a list
    assert Array.isArray container
    container.splice key, 1
  else # Removing from an object
    assert isObject container
    delete container[key]
  return removed

insertChild = (container, key, value) ->
  if typeof key is 'number'
    assert Array.isArray container
    container.splice key, 0, value
  else
    assert isObject container
    container[key] = value

  return value


setO = (obj, key, value) ->
  if value is undefined
    delete obj[key]
  else
    obj[key] = value

setA = (arr, idx, value) ->
  if value is undefined
    arr.splice idx, 1
  else
    arr[idx] = value

setC = (container, key, value) ->
  if typeof key is 'number'
    setA container, key, value
  else
    setO container, key, value

{readCursor, writeCursor} = cursor = require './cursor'

# *********

module.exports = type =
  name: 'json1'
  readCursor: readCursor
  writeCursor: writeCursor

subtypes = {}
register = type.registerSubtype = (type) ->
  type = type.type if type.type
  subtypes[type.name] = type if type.name
  subtypes[type.uri] = type if type.uri

register require 'ot-text'


getType = (component) ->
  if !component?
    return null
  else if component.et
    return subtypes[component.et]
  else if component.es
    return subtypes.text
  else if component.en
    throw Error 'Not implemented!'
  else
    return null

getEdit = (component) -> return component.es || component.en || component.e

checkOp = type.checkValidOp = (op) ->
  #console.log 'check', op
  return if op is null

  # I really want to use ES6 Set for these :p
  numPickSlots = numDropSlots = 0
  pickedSlots = {}
  droppedSlots = {}

  checkNonNegInteger = (n) ->
    assert typeof n is 'number'
    assert n >= 0
    assert n == (n|0)

  checkScalar = (s) ->
    if typeof s is 'number'
      checkNonNegInteger s
    else
      assert typeof s is 'string'

  checkComponent = (e) ->
    empty = true
    hasEdit = false
    for k, v of e
      empty = false
      assert k in ['p', 'r', 'd', 'i', 'e', 'es', 'en', 'et']
      if k is 'p'
        checkNonNegInteger v
        assert !pickedSlots[v]
        pickedSlots[v] = true
        numPickSlots++
        assert e.r is undefined
      else if k is 'd'
        checkNonNegInteger v
        assert !droppedSlots[v]
        droppedSlots[v] = true
        numDropSlots++
        assert e.i is undefined
      else if k in ['e', 'es', 'en']
        assert !hasEdit
        hasEdit = true
        type = getType e
        assert type
        type.checkValidOp? getEdit e

      # And checks for the edit.
    assert !empty

  SCALAR=1; EDIT=2; DESCENT=3
  checkDescent = (descent, isRoot) ->
    throw Error 'Op must be null or a list' unless Array.isArray descent
    throw Error 'Empty descent' unless descent.length >= 1
    checkScalar descent[0] unless isRoot

    last = SCALAR
    numDescents = 0
    lastKey = 0

    for d in descent
      assert d?

      last = if Array.isArray(d)
        key = checkDescent d, no
        if numDescents
          t1 = typeof lastKey
          t2 = typeof key
          if t1 == t2
            assert lastKey < key
          else
            assert t1 is 'number' and t2 is 'string'

        lastKey = key
        numDescents++
        DESCENT
      else if typeof d is 'object'
        assert last == SCALAR
        checkComponent d
        EDIT
      else
        assert last != DESCENT
        checkScalar d
        SCALAR

    assert numDescents != 1
    assert last in [EDIT, DESCENT]

    return descent[0]


  checkDescent op, true

  assert.equal numPickSlots, numDropSlots
  for i in [0...numPickSlots]
    assert pickedSlots[i]
    assert droppedSlots[i]

  #console.log numPickSlots, numDropSlots, pickedSlots, droppedSlots

  #console.log '---> ok', op


type.apply = (snapshot, op) ->
  # snapshot is a regular JSON object. It gets consumed in the process of
  # making the new object. (So we don't need to clone). I'm not 100% sure this
  # is the right choice... immutable stuff is super nice.
  #
  # ????

  checkOp op

  # Technically the snapshot should *never* be undefined, but I'll quietly
  # convert it to null if it is.
  snapshot = null if snapshot is undefined

  return snapshot if op is null

  held = []

  # Phase 1: Pick
  pick = (subDoc, descent, isRoot) ->
    # console.log 'pick', subDoc, descent, isRoot
    if isRoot
      rootContainer = container = [subDoc]
      key = 0
      i = 0
    else
      container = subDoc
      key = descent[0]
      subDoc = subDoc?[key]
      i = 1

    while i < descent.length and !Array.isArray descent[i]
      d = descent[i]
      # console.log 'd', d, i, subDoc, container, key
      if typeof d is 'object'
        if hasPick d
          assert subDoc != undefined
          held[d.p] = subDoc if d.p?
          removeChild container, key
          container = null
      else
        container = subDoc
        key = d
        subDoc = subDoc?[d]

      i++

    # Children. These need to be traversed in reverse order here.
    j = descent.length - 1
    while j >= i
      pick subDoc, descent[j], false
      j--

    if isRoot
      snapshot = rootContainer[0] || null

  pick snapshot, op, true

  # console.log '---- after pick phase ----'
  # console.log held, snapshot

  # Phase 2: Drop
  drop = (subDoc, descent, isRoot) ->
    # console.log 'drop', subDoc, descent, isRoot

    if isRoot
      rootContainer = container = {s:snapshot}
      key = 's'
      i = 0
    else
      container = subDoc
      key = descent[0]
      subDoc = subDoc?[key]
      i = 1

    while i < descent.length
      d = descent[i]
      # console.log 'd', d, i, subDoc, container, key

      if Array.isArray d
        drop subDoc, d, false
      else if typeof d is 'object'
        if d.d?
          subDoc = insertChild container, key, held[d.d]
        else if d.i != undefined
          subDoc = insertChild container, key, d.i

        if (type = getType d)
          replacement = type.apply subDoc, getEdit d
          subDoc = insertChild container, key, replacement
        else if d.e != undefined
          throw Error "Subtype #{d.et} undefined"
      else
        container = subDoc
        key = d
        subDoc = subDoc?[d]

      i++

    if isRoot
      snapshot = rootContainer.s

  drop snapshot, op, true

  return snapshot



listmap = require './listmap'

LEFT = 0
RIGHT = 1


transform = type.transform = (oldOp, otherOp, direction) ->
  assert direction in ['left', 'right']
  side = if direction == 'left' then LEFT else RIGHT
  debug = type.debug
  log.quiet = !debug

  if debug
    console.log "transforming #{direction}:"
    console.log 'op1', JSON.stringify(oldOp)
    console.log 'op2', JSON.stringify(otherOp)

  checkOp oldOp
  checkOp otherOp

  # Indexed by op2's slots.
  heldRead = [] # Read cursor at the place in op1
  heldTaint = []

  nextSlot = 0
  # slotMap = []

  pickComponent = [] # indexed by p1's original slot #

  otherPickScan = (p1, p2, taint) ->
    # Scanning the other op looking for the pickup locations.
    c1 = p1?.getComponent()
    c2 = p2.getComponent()

    if (slot = c2?.p)?
      log slot, c1, c2
      if p1
        heldRead[slot] = p1.clone()
      else
        heldRead[slot] = null
      heldTaint[slot] = taint

    taint = true if c1?.r
    cursor.eachChildOf p1, p2, null, null, (key, p1, p2) ->
      log 'in', key
      otherPickScan p1, p2, taint if p2
      log 'out', key

  p1 = readCursor oldOp
  p2 = readCursor otherOp
  otherPickScan p1, p2, false
  log 'hr', (!!x for x in heldRead)

  # This handles the semantics of op (p1) having a pick or a remove.
  opPick = (p1, p2, w) ->
    if (c2 = p2?.getComponent())
      if (slot = c2.d)?
        p1 = heldRead[slot]
      else if hasPick c2
        p1 = null
      log 'p1->', !!p1

    log !!p1, !!p2
    return if !p1 and !p2

    if (c1 = p1?.getComponent())
      log 'get the pick!', c1, c2
      if c1.r != undefined then w.write 'r', true
      if c1.p? and !(side == RIGHT and hasDrop c2)
        # This will either contain a p:X or r:true.
        c = pickComponent[c1.p] = w.getComponent()

    # TODO with pick list semantics
    cursor.eachChildOf p1, p2, null, null, (key, p1, p2) ->
      w.descend key
      log 'descend', key
      opPick p1, p2, w
      log 'ascend', key
      w.ascend()

  w = writeCursor()
  log '---- pick ----'
  opPick p1, p2, w

  # This handles the semantics of op (p1) having a drop or an insert
  opDrop = (p1, p2, w) ->
    log 'opdrop', !!p1, !!p2

    log 'c2c', p1?.getComponent(), p2?.getComponent()

    # Logic figured out via a truth table
    c1 = p1?.getComponent()
    c2 = p2?.getComponent()
    if hasDrop(c1) and (side == LEFT || !hasDrop c2)
      # Copy the drops
      if c1.d? and (pc = pickComponent[c1.d])
        w.write 'd', pc.p = nextSlot++
        pickComponent[c1.d] = null
      else if c1.i != undefined
        w.write 'i', clone c1.i
      if hasDrop c2 then w.write 'r', true
    else if hasPick(c2) or hasDrop(c2)
      if (slot = c2.d)?
        p1 = heldRead[slot]
        c1 = p1?.getComponent()
        w.write 'r', true if heldTaint[slot]
      else if c2.i != undefined || hasPick c2
        c1 = p1 = null
      log 'p1 ->', !!p1

    # Edit
    if (t1 = getType c1)
      e1 = getEdit c1
      if (t2 = getType c2)
        # This might cause problems later. ... eh, later problem.
        throw Error "Transforming incompatible types" unless t1 == t2
        e2 = getEdit c2
        e = t1.transform e1, e2, direction
      else
        e = clone e1

      if t1 == subtypes.text
        w.write 'es', e
      else # also if t1 == subtypes.number then write 'en', e...
        w.write 'et', c1.et # Just copy the nomenclosure
        w.write 'e', e

    # TODO with drop list semantics
    cursor.eachChildOf p1, p2, null, null, (key, p1, p2) ->
      w.descend key
      log 'in', key
      opDrop p1, p2, w
      log 'out', key
      w.ascend()

  w.reset()
  log '----- drop -----'
  opDrop p1, p2, w

  # log 'pc:'
  # log !!pc for pc in pickComponent
  pc.r = true for pc in pickComponent when pc

  result = w.get()
  log '->', result
  checkOp result
  return result


if require.main == module
  type.debug = true
  transform [["x",{"p":0}],["z",{"d":0}]], ["z",{"i":5}], 'right'
  log '-----'
  transform [["x",{"p":0}],["z",{"d":0}]], [['y', p:0], ['z', d:0]], 'right'
