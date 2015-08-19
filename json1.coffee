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


log = module.exports = (args...) ->
  return if log.quiet
  {inspect} = require 'util'
  f = (a) ->
    if typeof a is 'string'
      a
    else
      inspect a, {depth:5, colors:true}
  console.log args.map(f).join ' '

log.quiet = false



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

{readCursor, writeCursor, eachChildOf, getKCList} = require './cursor'

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
  if component.et
    return subtypes[component.et]
  else if component.es
    return subtypes.text
  else if component.en
    throw Error 'Not implemented!'
  else
    return null

getOp = (component) -> return component.es || component.en || component.e

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
        type.checkValidOp? getOp e

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
    #console.log 'pick', subDoc, descent, isRoot
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
      #console.log 'd', d, i, subDoc, container, key
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

  #console.log '---- after pick phase ----'
  #console.log held, snapshot

  # Phase 2: Drop
  drop = (subDoc, descent, isRoot) ->
    #console.log 'drop', subDoc, descent, isRoot

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
      #console.log 'd', d, i, subDoc, container, key

      if Array.isArray d
        drop subDoc, d, false
      else if typeof d is 'object'
        if d.d?
          subDoc = insertChild container, key, held[d.d]
        else if d.i != undefined
          subDoc = insertChild container, key, d.i
        else if (type = getType d)
          replacement = type.apply subDoc, getOp d
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

  # Phase 3: Do inline edits. (Although this may be possible during the drop phase)
  # TODO

  return snapshot



listmap = require './listmap'

LEFT = 0
RIGHT = 1

transform = type.transform = (oldOp, otherOp, direction) ->
  assert direction in ['left', 'right']
  side = if direction == 'left' then LEFT else RIGHT
  debug = type.debug
  log.quiet = !debug

  checkOp oldOp
  checkOp otherOp

  if debug
    console.log "transforming #{direction}:"
    console.log 'op1', JSON.stringify(oldOp)
    console.log 'op2', JSON.stringify(otherOp)

  held = [] # Indexed by op2's slots.
  slotMap = [] # Map from oldOp's slots -> op's slots.

  console.log '---- pick phase ----' if debug
  pick = (o1, o2, w) ->
    return if !o1?
    # other can be null when we're copying

    if (c2 = o2?.getComponent())
      log 'found c2', c2
      w = null if c2.r != undefined
      w = writeCursor() if c2.p?

    # Copy in the component from c1
    if w and (c1 = o1.getComponent())
      log 'found c1', c1, c2
      if c1.p?
        slot = slotMap.length
        slotMap[c1.p] = slot
        w.write 'p', slot
      if w
        w.write 'r', c1.r if c1.r != undefined
        w.write 'e', clone(c1.e) if c1.e
        w.write 'es', clone(c1.es) if c1.es

    # Now descend through our children
    map = listmap.forward getKCList(o2), side, RIGHT
    eachChildOf o1, o2, null, null, (key, o1, o2) ->
      log 'descending to', key, !!o1, !!o2
      key = map key if typeof key is 'number'
      w?.descend key
      pick o1, o2, w
      w?.ascend()
      log 'ascending    ', key

    if c2 && (slot = c2.p)?
      log 'holding in slot', slot, w.get()
      held[slot] = w.get()

  w = writeCursor()
  pick readCursor(oldOp), readCursor(otherOp), w

  console.log '---- drop phase ----' if debug
  drop = (o1, o2, w) -> # Op1, Op2, output cursors.
    assert o1 or o2

    # No early return here because nested somewhere in o2 might be a drop.
    # console.log 'drop', dest, op, other if debug

    c2 = o2.getComponent() if o2
    # The other op deletes everything in this subtree.
    o1 = null if c2?.r != undefined
    c1 = o1.getComponent() if o1

    return unless o1 || o2

    if c1 && (c1.i != undefined || (c1.d? and slotMap[c1.d]?))
      if !hasDrop(c2) || side == LEFT
        # console.log 'write'
        w.write 'd', slotMap[c1.d] if c1.d?
        w.write 'i', clone(c1.i) if c1.i != undefined

    if c2 && (slot = c2.d)?
      _w = w
      w = writeCursor held[slot]
      log 'dropping', held[slot]
      delete held[slot] # For debugging

    opKCList = getKCList o1
    otherKCList = getKCList o2
    opToFinal = listmap.xfDrop opKCList, otherKCList, side
    otherToFinal = listmap.xfDrop otherKCList, opKCList, 1-side
    eachChildOf o1, o2, opToFinal, otherToFinal, (key, o1, o2) ->
      log 'descending to', key
      w.descend key
      drop o1, o2, w
      w.ascend()
      log 'ascending    ', key

    if c2 && (slot = c2.d)?
      log 'writeTree', w.get()
      _w.writeTree w.get()

  log held, slotMap

  # We'll need a fresh cursor for the next traversal
  w = writeCursor w.get()
  drop readCursor(oldOp), readCursor(otherOp), w

  console.log '---- end phase ----' if debug
  log held, slotMap
  result = w.get()
  log result
  checkOp result
  return result

if require.main == module
  type.debug = true
  console.log transform [2,{"i":"hi"}], [2,{"r":true,"i":"other"}], 'left'
