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

  if Array.isArray o
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

{readCursor, writeCursor} = require './cursor'

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

eachChildOf = (c1, c2, listMap, fn) ->
  finished1 = c1.descendFirst()
  finished2 = c2.descendFirst()

  while !finished1 || !finished2
    k1 = if !finished1 then c1.getKey() else null
    k2 = if !finished2 then c2.getKey() else null

    if k1 != null and k2 != null
      if isGreaterKey k2, k1
        k2 = null
      else if k1 != k2
        k1 = null

    fn (if k1 == null then k2 else k1), (c1 if k1 != null), (c2 if k2 != null)
    finished1 = c1.nextSibling() if k1 != null
    finished2 = c2.nextSibling() if k2 != null

  c1.ascend()
  c2.ascend()


LEFT = 0
RIGHT = 1

transform = type.transform = (oldOp, otherOp, direction) ->
  assert direction in ['left', 'right']
  side = if direction == 'left' then LEFT else RIGHT
  debug = type.debug

  checkOp oldOp
  checkOp otherOp

  if debug
    console.log "transforming #{direction}:"
    console.log 'op', JSON.stringify(oldOp, null, 2)
    console.log 'op2', JSON.stringify(otherOp, null, 2)

  held = [] # Indexed by op2's slots.
  slotMap = [] # Map from oldOp's slots -> op's slots.

  newOp = writeCursor()

  pick = (c1, c2) ->
    #return null if !op?

    # op is a list.



    component = c1.getComponent()
    if component.r
      return
    else if component.p?
      hold cursor

    eachChildOf c1, c2, xfMap, (key) ->
      return if c1.inDarkDepthsOfUnknowing()
      newOp.descend key
      pick c1, c2
      newOp.ascend()

  cursor1 = cursor op1
  cursor2 = cursor op2
  pick cursor1, cursor2




  console.log '---- pick phase ----' if debug

  return newOp.get()
