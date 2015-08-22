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
{getKList} = cursor

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
  heldOp2Drop = [] # Read cursor at the pick up in op2
  cancelledOp2 = [] # op2 moves which have been cancelled.

  nextSlot = 0
  # slotMap = []

  p1 = readCursor oldOp
  p2 = readCursor otherOp
  w = writeCursor()

  # ---------------------------------------------------------------------
  scanOp2 = (p1, p2, removed) ->
    # Scanning the other op looking for the pickup locations.
    c1 = p1?.getComponent()
    c2 = p2.getComponent()

    if c1
      if c1.r != undefined then removed = true
      else if c1.p? then removed = false

    if c2
      if (slot = c2.p)?
        log slot, c1, c2
        cancelledOp2[slot] = true if removed

      if (slot = c2.d)?
        heldOp2Drop[slot] = p2.clone()

    ap1 = cursor.advancer p1
    p2.eachChild (key) ->
      log 'in', key
      scanOp2 ap1(key), p2, removed
      log 'out', key
    ap1.end()

  scanOp2 p1, p2, false
  log 'hd', (!!x for x in heldOp2Drop)

  # ---------------------------------------------------------------------
  cancelOp2Drops = (p2, p1, w, removed) ->
    removed = true if (c1 = p1?.getComponent())?.r != undefined
    removed = false if c1?.p?

    c2 = p2.getComponent()
    if !removed and (slot = c2?.d)? and cancelledOp2[slot]
      w.write 'r', true
      # w.write 'r', 'cancelop2'
      removed = true

    ap1 = cursor.advancer p1
    p2.eachChild (key) ->
      w.descend key
      cancelOp2Drops p2, ap1(key), w, removed
      w.ascend key
    ap1.end()

  cancelOp2Drops(p2, p1, w, false) if cancelledOp2.length
  w.reset()

  # ---------------------------------------------------------------------

  heldWrites = [] # indexed by op2 slot numbers

  pickComponents = [] # indexed by op1 original slot numbers

  # This handles the semantics of op (p1) having a pick or a remove.
  opPick = (p1, p2Pick, p2Drop, w, removed) ->
    # p1 and w are always defined.
    iAmMoved = false
    if (c2 = p2Pick?.getComponent())
      if (slot = c2.p)?
        # aah we need to teleport THINGS!
        p2Drop = heldOp2Drop[slot]
        w = heldWrites[slot] = writeCursor()
        iAmMoved = true
        removed = false
      else if c2.r != undefined
        removed = true

    if (c1 = p1.getComponent())
      if (slot = c1.p)?
        log 'rrr', removed, side, iAmMoved
        pickComponents[slot] = if removed or (side == RIGHT and iAmMoved)
          null
        else
          w.getComponent()
      else if c1.r != undefined and !removed
        w.write 'r', true
        # w.write 'r', 'xx'

    map = listmap.forward p2Pick?.getKList(hasPick), p2Drop?.getKList(hasDrop), side, RIGHT
    ap2Pick = cursor.advancer p2Pick
    ap2Drop = cursor.advancer p2Drop
    p1.eachChild (key) ->
      p2Pick_ = ap2Pick key
      mappedKey = map key
      p2Drop_ = ap2Drop mappedKey
      w.descend mappedKey
      opPick p1, p2Pick_, p2Drop_, w, removed
      w.ascend()
    ap2Pick.end(); ap2Drop.end()

  log '---- pick ----'
  opPick p1, p2, p2.clone(), w, false
  w.reset()

  log pickComponents

  # ---------------------------------------------------------------------
  log 'cancelled', cancelledOp2
  # This handles the semantics of op (p1) having a drop or an insert
  opDrop = (p1Pick, p1Drop, p2Pick, p2Drop, w, removed) ->
    # Logic figured out via a truth table
    c1d = p1Drop.getComponent()
    c2d = p2Drop?.getComponent()
    if c1d and (c1d.i != undefined or (c1d.d? and (pc = pickComponents[c1d.d])))
      # log 'rr', !removed, side == LEFT, !hasDrop(c2d), c2d, cancelledOp2[c2d.d]

      if !removed and (side == LEFT || !hasDrop(c2d) || (c2d.d? and cancelledOp2[c2d.d]))
        # Copy the drops
        if c1d.d?
          w.write 'd', pc.p = nextSlot++
          # pickComponent[c1.d] = null
        else if c1d.i != undefined
          w.write 'i', clone c1d.i

        assert w.getComponent().r if hasDrop(c2d) and (c1d.d? and cancelledOp2[c1d.d])

        if hasDrop c2d then w.write 'r', true # I fart in your general direction
        # if hasDrop c2d then w.write 'r', 'overwrite'

      else
        log "Halp! We're being overwritten!"
        pc.r = true if pc



    if (c2p = p2Pick?.getComponent())
      if (slot = c2p.p)?
        # Teleport.
        p2Drop = heldOp2Drop[slot]
        c2d = p2Drop?.getComponent()
        w = heldWrites[slot] = writeCursor() if !(w = heldWrites[slot])
        w.reset()
        removed = false
      else if c2p.r != undefined
        removed = true


    # Edit
    if !removed and (t1 = getType c1d)
      e1 = getEdit c1d
      if (t2 = getType c2d)
        # This might cause problems later. ... eh, later problem.
        throw Error "Transforming incompatible types" unless t1 == t2
        e2 = getEdit c2d
        e = t1.transform e1, e2, direction
      else
        e = clone e1

      if t1 == subtypes.text
        w.write 'es', e
      else # also if t1 == subtypes.number then write 'en', e...
        w.write 'et', c1d.et # Just copy the nomenclosure
        w.write 'e', e


    # Somehow we also have to add in the cancelled children
    p1pk = p1Pick?.getKList(hasPick)
    p1dk = p1Drop.getKList(hasDrop)
    p2pk = p2Pick?.getKList(hasPick)
    p2dk = p2Drop?.getKList(hasDrop)

    ap1p = cursor.advancer p1Pick
    ap2p = cursor.advancer p2Pick
    ap2d = cursor.advancer p2Drop

    p1Drop.eachChild (key) ->
      # hookaaay....
      if typeof key is 'string'
        _p1Pick = ap1p key
        _p2Pick = ap2p key
        _p2Drop = ap2d key
        w.descend key

        opDrop _p1Pick, p1Drop, _p2Pick, _p2Drop, w, removed
        w.ascend key
      else
        throw Error 'kill me!'


    ap1p.end(); ap2p.end(); ap2d.end()

  log '----- drop -----'
  opDrop p1, p1.clone(), p2, p2.clone(), w, false
  w.reset()

  # ---------------------------------------------------------------------

  # Now we need to fill in the moved writes.

  emplaceWrites = (p2Drop, w) ->
    if (c2 = p2Drop.getComponent()) and (slot = c2.d)?
      _w = heldWrites[slot]
      w.mergeTree _w.get() if _w

    p2Drop.eachChild (key) ->
      w.descend key
      emplaceWrites p2Drop, w
      w.ascend()

  emplaceWrites p2, w

  # log 'pc:'
  # log !!pc for pc in pickComponents
  # pc.r = true for pc in pickComponents when pc

  result = w.get()
  log '->', result
  checkOp result
  return result


if require.main == module
  type.debug = true
  transform ["x",{"es":["hi"]}], ["x",{"r":true}], 'left'
