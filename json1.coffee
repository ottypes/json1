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
# - number operations
# - compose()
# - compose preserve invertable data
# - makeInvertable and invert()
# - Fuzzer, fix bugs
# - Port to JS.

# - setNull = ??
# - remove N items in a list
# - a backup move location in the op
# - Conversion between json1 ops and json0, json-patch.

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

# ******** checkOp

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

# ******* apply

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
  heldOp1Pick = [] # Cloned read cursors for teleporting
  heldOp2Drop = []
  cancelledOp2 = [] # op2 moves which have been cancelled.

  op1PickAtOp2Pick = []

  nextSlot = 0
  # slotMap = []

  p1 = readCursor oldOp
  p2 = readCursor otherOp
  w = writeCursor()

  # ---------------------------------------------------------------------
  scanOp2Pick = (p1, p2, removed) ->
    # Scanning for a few things:
    # - Marking cancelled op2 moves based on op1 removing things
    # - Getting op2 drop read cursors
    # - Figuring out which operations share pickup locations
    if (c1 = p1?.getComponent())
      if c1.r != undefined then removed = true
      else if c1.p? then removed = false

    if (c2 = p2.getComponent()) and (slot2 = c2.p)?
      log slot2, c1, c2
      cancelledOp2[slot2] = true if removed
      op1PickAtOp2Pick[slot2] = slot1 if (slot1 = c1?.p)?

    ap1 = cursor.advancer p1
    p2.eachChild (key) ->
      log 'in', key
      scanOp2Pick ap1(key), p2, removed
      log 'out', key
    ap1.end()

  scanOp2Pick p1, p2, false

  # ---------------------------------------------------------------------
  # This traverses op2's drop locations to cancel them.
  scanOp2DropAndCancel = (p2, p1, w, removed) ->
    if (c1 = p1?.getComponent())
      removed = true if c1.r != undefined
      removed = false if c1.p?

    if (c2 = p2.getComponent()) and (slot = c2.d)?
      heldOp2Drop[slot] = p2.clone()

      if !removed and cancelledOp2[slot]
        w.write 'r', true
        # w.write 'r', 'cancelop2'
        removed = true

    ap1 = cursor.advancer p1
    p2.eachChild (key) ->
      w.descend key
      scanOp2DropAndCancel p2, ap1(key), w, removed
      w.ascend key
    ap1.end()

  scanOp2DropAndCancel p2, p1, w, false
  w.reset()
  log 'hd', (!!x for x in heldOp2Drop)

  # ---------------------------------------------------------------------

  heldWrites = [] # indexed by op2 slot numbers

  # Could almost double up on pickComponents and heldOp1Pick - heldOp1Pick shows us the original component, but pickComponents are actually write components, so its no good.
  pickComponents = [] # indexed by op1 original slot numbers

  # This handles the semantics of op (p1) having a pick or a remove.
  opPick = (p1Pick, p2Pick, p2Drop, w, removed) ->
    # log 'opPick', !!p2Pick, !!p2Drop
    # p1Pick and w are always defined.
    iAmMoved = false
    # pickedHere = false
    if (c2 = p2Pick?.getComponent())
      if (slot = c2.p)?
        # aah we need to teleport THINGS!
        p2Drop = heldOp2Drop[slot]
        w = heldWrites[slot] = writeCursor()
        iAmMoved = true
        removed = false
      else if c2.r != undefined
        removed = true

    if (c1 = p1Pick.getComponent())
      if (slot = c1.p)?
        log 'rrr', removed, side, iAmMoved
        pickComponents[slot] = if removed or (side == RIGHT and iAmMoved)
          log "cancelling #{slot}"
          null
        else
          w.getComponent()
        heldOp1Pick[slot] = p1Pick.clone()
      else if c1.r != undefined and !removed
        w.write 'r', true
        # w.write 'r', 'xx'

    p2PickOff = p2DropOff = 0
    ap2Pick = cursor.advancer p2Pick, null, (k, c) ->
      if hasPick(c)
        p2PickOff++
        log 'p2Pick++', p2PickOff, k, c
      # return k # -> raw
    ap2Pick._name = '2pick'
    ap2Drop = cursor.advancer p2Drop, (k, c) ->
      return if hasDrop(c) then -(k - p2DropOff) else k - p2DropOff
    , (k, c) ->
      if hasDrop(c)
        p2DropOff++
        log 'p2Drop++', p2DropOff, k, c
    ap2Drop._name = '2drop'

    log 'children', '2p', !!p2Pick, '2d', !!p2Drop
    p1Pick.eachChild (key) ->
      if typeof key is 'string'
        log 'string key', key
        p2Pick_ = ap2Pick key
        p2Drop_ = ap2Drop key
        w.descend key
        opPick p1Pick, p2Pick_, p2Drop_, w, removed
        w.ascend()
      else
        p2Pick_ = ap2Pick key
        p2Mid = key - p2PickOff
        p2Drop_ = ap2Drop p2Mid
        finalKey = p2Mid + p2DropOff
        log "k#{key} -> m#{p2Mid} -> f#{finalKey}"
        assert finalKey >= 0
        w.descend finalKey
        opPick p1Pick, p2Pick_, p2Drop_, w, removed
        w.ascend()
    ap2Pick.end(); ap2Drop.end()


  log '---- pick ----'
  opPick p1, p2, p2.clone(), w, false
  w.reset()

  log 'hp', (x.getComponent() for x in heldOp1Pick)
  log 'pc', pickComponents

  # ---------------------------------------------------------------------
  log 'cancelled', cancelledOp2
  # This handles the semantics of op (p1) having a drop or an insert
  opDrop = (p1Pick, p1Drop, p2Pick, p2Drop, w, removed) ->
    log 'drop', !!p1Pick, !!p1Drop, !!p2Pick, !!p2Drop
    # Logic figured out via a truth table
    c1d = p1Drop.getComponent()
    c2d = p2Drop?.getComponent()
    droppedHere = false

    if c1d
      slot1 = c1d.d
      p1Pick = heldOp1Pick[slot1] if slot1?
      if c1d.i != undefined or (slot1? and (pc = pickComponents[slot1]))
        # log 'rr', !removed, side == LEFT, !hasDrop(c2d), c2d, cancelledOp2[c2d.d]

        # Times to write:
        # - There is no c2 drop
        # - The other drop has been cancelled
        # - We are left (and then we also need to remove)
        # If we are identical, skip everything. Neither write nor remove.

        # Doing this with logical statements was too hard. This just sets up
        # some state variables which are used in conditionals below.
        write = true
        identical = false
        if c2d
          if (slot2 = c2d.d)?
            if cancelledOp2[slot2]
              write = true
            else
              write = side == LEFT
              identical = slot1? and slot1 == op1PickAtOp2Pick[slot2]

          else if (inserted = c2d.i) != undefined
            identical = deepEqual(inserted, c1d.i)
            write = side == LEFT

        if !identical
          if !removed and write
            # Copy the drops
            if c1d.d?
              w.write 'd', pc.p = nextSlot++
              droppedHere = true
              # pickComponent[c1.d] = null
            else if c1d.i != undefined
              w.write 'i', clone c1d.i
              droppedHere = true

            assert w.getComponent().r if hasDrop(c2d) and (c1d.d? and cancelledOp2[c1d.d])

            if hasDrop c2d then w.write 'r', true # I fart in your general direction
            # if hasDrop c2d then w.write 'r', 'overwrite'

          else
            log "Halp! We're being overwritten!"
            pc.r = true if pc
            removed = true
      else if c1d.d? and !pickComponents[c1d.d]
        removed = true # I'm not 100% sure this is the right way to implement this logic...

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
    log 'edit:', removed, c1d, c2d
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


    p1PickOff = p1DropOff = 0
    p2PickOff = p2DropOff = 0
    outPickOff = outDropOff = 0

    ap1p = cursor.advancer p1Pick, (k, c) ->
      log 'ca map p1pick', k, c
      return if hasPick(c) then -(k - p1PickOff) else k - p1PickOff
    , (k, c) ->
      log 'ca p1pick', k, c
      if hasPick(c)
        p1PickOff++
        log 'p1Pick++', p1PickOff, k, c
        # Basically, if it wasn't cancelled.
        # I'm not sure if its possible for a p1 pick to be cancelled here. I can't figure out how to write a test case which requires this conditional.
        outPickOff++ # if c.r != undefined or pickComponents[c.p]

    ap1p._name = '1p'

    ap2p = cursor.advancer p2Pick, null, (k, c) ->
      if hasPick(c)
        p2PickOff++
        log 'p2Pick++', p2PickOff, k, c
    ap2p._name = '2p'

    ap2d = cursor.advancer p2Drop, (k, c) ->
      return if hasDrop(c) then -(k - p2DropOff) else k - p2DropOff
    , (k, c) ->
      if hasDrop(c)
        p2DropOff++
        # We've added a remove to cancel the op.
        outPickOff++ if c.d? and cancelledOp2[c.d]
        log 'p2Drop++', p2DropOff, k, c

    ap2d._name = '2d'

    log 'children.', '1p:', !!p1Pick, '1d:', !!p1Drop, '2p:', !!p2Pick

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
        log 'p1DropEachChild k:', key,
          'p1p:', p1PickOff, 'p1d:', p1DropOff,
          'p2p:', p2PickOff, 'p2d:', p2DropOff,
          'op:', outPickOff, 'od:', outDropOff
        k1Mid = key - p1DropOff
        _p1Pick = ap1p k1Mid # Advances p1PickOff.
        raw = k1Mid + p1PickOff
        _p2Pick = ap2p raw # Advances p2PickOff.
        k2Mid = raw - p2PickOff
        _p2Drop = ap2d if side is LEFT and hasDrop(p1Drop.getComponent())
          k2Mid-1
        else
          k2Mid

        k2Final = k2Mid + p2DropOff

        log '->DropEachChild k:', key,
          'p1p:', p1PickOff, 'p1d:', p1DropOff,
          'p2p:', p2PickOff, 'p2d:', p2DropOff,
          'op:', outPickOff, 'od:', outDropOff,

        log "k: #{key} -> mid #{k1Mid} -> raw #{raw} -> k2Mid #{k2Mid} -> k2Final #{k2Final}"

        w.descend k2Final - outPickOff + outDropOff

        if hasDrop p1Drop.getComponent()
          # If we drop here
          _p1Pick = _p2Pick = _p2Drop = null
          log 'omg p1dropoff', p1DropOff
          p1DropOff++

        outDropOff++ if opDrop _p1Pick, p1Drop, _p2Pick, _p2Drop, w, removed
        w.ascend()

    ap1p.end(); ap2p.end(); ap2d.end()
    return droppedHere

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
  transform [["x",{"r":true}],["y",3,{"i":5}]], [["x","a",{"p":0}],["y",2,{"d":0}]], 'left'
