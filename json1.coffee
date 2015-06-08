
assert = require 'assert'

# This function takes a sparse list object (l:{1:..., 5:...} and returns a
# sorted list of the keys [1,5,...]
sortedKeys = (list) -> if list then (+x for x of list).sort (a, b) -> a - b else []

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

hasDrop = (op) -> op && (op.d? || op.di != undefined)

module.exports = type =
  name: 'json1'

###
walk = (op, fn) ->
  fn op
  walk child, fn for k, child of op.o if op.o
  walk child, fn for k, child of op.l if op.l
###

eachChild = (op, fn) ->
  fn k, child for k, child of op.o if op.o
  fn k, child for k, child of op.l if op.l

subtypes = {}
type.registerSubtype = (subtype) ->
  subtypes[subtype.name] = subtype
  subtypes[subtype.uri] = subtype

checkOp = type.checkValidOp = (op) ->
  # I really want to use ES6 Set for these :p
  numPickSlots = numDropSlots = 0
  pickedSlots = {}
  droppedSlots = {}

  check = (branch) ->
    assert typeof(branch) == 'object'
    assert k in ['p', 'd', 'di', 'e', 'o', 'l'] for k, v of branch
    # TODO: Invariant: embedded ops have a known type & are valid.

    hasChildren = branch.d? || branch.di != undefined || branch.p != undefined

    if (slot = branch.p)?
      assert !pickedSlots[slot]
      pickedSlots[slot] = true
      numPickSlots++

    if (slot = branch.d)?
      assert !droppedSlots[slot]
      droppedSlots[slot] = true
      numDropSlots++

    if op.o
      assert isObject op.o
      for k, child of op.o
        hasChildren = yes; check child
    if op.l
      assert isObject op.l
      for k, child of op.l
        hasChildren = yes; check child

    # Invariant: There are no empty leaves.
    assert hasChildren

  # Invariant: Every pick has a corresponding drop. Every drop has a corresponding pick.
  # Invariant: Slot names start from 0 and they're contiguous.
  assert.equal numPickSlots, numDropSlots
  for i in [0...numPickSlots]
    assert pickedSlots[i]
    assert droppedSlots[i]

  return

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

type.apply = (snapshot, op) ->
  # snapshot is a regular JSON object. It gets consumed in the process of
  # making the new object. (So we don't need to clone). I'm not 100% sure this
  # is the right choice... immutable stuff is super nice.
  #
  # ????
  
  held = []
  # Phase 1: Pick.
  pick = (subDoc, subOp) ->
    if isObject(subDoc) and subOp.o then for k, opChild of subOp.o
      docChild = subDoc[k]
      #console.log 'descending', subDoc, subOp, k, docChild, opChild
      setO subDoc, k, pick docChild, opChild

    if Array.isArray(subDoc) and subOp.l
      keys = sortedKeys subOp.l
      for i in keys by -1
        setA subDoc, i, pick subDoc[i], subOp.l[i]

    if subOp.p != undefined
      held[subOp.p] = subDoc if subOp.p?
      return undefined

    return subDoc

  snapshot = pick snapshot, op


  # Phase 2: Drop
  drop = (subDoc, subOp) ->
    if subOp.di != undefined
      console.warn 'Overwriting a subtree. You should have deleted it' if subDoc != undefined
      subDoc = clone subOp.di
    else if subOp.d?
      console.warn 'Overwriting a subtree. You should have deleted it' if subDoc != undefined
      subDoc = held[subOp.d]

    if isObject(subDoc) and subOp.o then for k, opChild of subOp.o
      docChild = subDoc[k]
      setO subDoc, k, drop docChild, opChild

    if Array.isArray(subDoc) and subOp.l
      keys = sortedKeys subOp.l
      for i in keys
        replacement = drop subDoc[i], subOp.l[i]
        if hasDrop(subOp.l[i])
          subDoc.splice i, 0, replacement
        else
          # Otherwise ... nothing?
          assert.strictEqual replacement, subDoc[i]

    return subDoc

  snapshot = drop snapshot, op

  return snapshot


LEFT = 0
RIGHT = 1

# This function returns a function which maps a list position through an
# operation. keys is the l: property of the other op, and list must be
# sortedKeys(keys).
#
# The returned function is called with an index. The passed index must be >=
# any previously passed index.
xfMap = (keys, list) ->
  pickKeyPos = dropKeyPos = 0
  pickOffset = dropOffset = 0

  (src, pickSide, dropSide) ->
    while pickKeyPos < keys.length and ((k = keys[pickKeyPos]) < src || (pickSide == RIGHT && k == src))
      pickKeyPos++
      pickOffset-- if list[k].p != undefined

    src2 = src + pickOffset
    #while dropKeyPos < keys.length and (k = keys[dropKeyPos]) < src2 + dropOffset
    while dropKeyPos < keys.length
      k = keys[dropKeyPos]
      break if dropSide is LEFT and k >= src2 + dropOffset
      break if dropSide is RIGHT and k > src2 + dropOffset

      dropKeyPos++
      dropOffset++ if list[k].d? or (list[k].di != undefined)

    return src2 + dropOffset


# This function does an inverse map of list drop positions via the pick list.
# So, if you have an op which does 10:pick, 20:drop it'll map the index 20 ->
# 21 because thats where the drop would have been if the pick didn't happen.
xfListReversePick = (keys, list) ->
  keyPos = 0
  offset = 0

  (destIdx) ->
    while keyPos < keys.length and (k = keys[keyPos]) <= destIdx + offset
      keyPos++
      offset++ if list[k].p != undefined

    return offset



addOChild = (dest, key, child) ->
  if child?
    dest ?= {}
    dest.o ?= {}
    dest.o[key] = child
  return dest

addLChild = (dest, key, child) ->
  if child?
    dest ?= {}
    dest.l ?= {}
    dest.l[key] = child
  return dest

transform = type.transform = (oldOp, otherOp, direction) ->
  assert direction in ['left', 'right']
  side = if direction == 'left' then LEFT else RIGHT
  debug = transform.debug

  checkOp oldOp
  checkOp otherOp

  if debug
    console.log "transforming #{direction}:"
    console.log 'op', JSON.stringify(oldOp, null, 2)
    console.log 'op2', JSON.stringify(otherOp, null, 2)

  held = [] # Indexed by op2's slots.
  slotMap = [] # Map from oldOp's slots -> op's slots.

  console.log '---- pick phase ----' if debug

  pick = (op, other) ->
    return null if !op?
    # other can be null

    console.log 'pick', op, other if debug

    return null if other?.p is null

    dest = null
    if op.p == null
      dest = {p:null}
    else if op.p?
      slot = slotMap.length
      slotMap[op.p] = slot
      dest = {p:slot}

    if (edit = op.e)
      dest ?= {}
      dest.e = edit

    # **** Object children
    if op.o
      # If op doesn't have any object children now, its not going to get any in
      # the pick phase.
      if other?.o then for k, otherChild of other.o
        # op.o[k] might be undefined - but thats ok.
        dest = addOChild dest, k, pick op.o[k], otherChild

      # Add in anything that hasn't been copied over as a result of iterating
      # through other, above. This might be worth special casing instead of
      # calling pick recursively.
      for k, oldChild of op.o when !other?.o?[k]
        # Basically just copy them in.
        dest = addOChild dest, k, pick oldChild, null

    # **** List children
    if (list = op.l)
      if other?.l
        opK = sortedKeys list
        otherK = sortedKeys other.l

        # Iterate through children, adjusting indexes as needed.
        otherMap = xfMap otherK, other.l

        for idx, i in opK
          oldChild = list[idx]
          otherChild = other.l[idx]
          if (child = pick oldChild, otherChild)
            newIdx = otherMap idx, side, RIGHT
            dest = addLChild dest, newIdx, child
      else
        # Just go through normally - no transform of indexes needed.
        dest = addLChild dest, idx, pick oldChild, null for idx, oldChild of list

    if (slot = other?.p)?
      # Pick this node up
      console.log "picking up to slot #{other.p}", dest if debug
      held[slot] = dest
      return null

    return dest

    
  op = pick oldOp, otherOp

  console.log '---- drop phase ---- -> held:', held, op if debug

  drop = (dest, op, other) ->
    assert op || other

    # Any of dest, op and other can be null. No early return here because
    # nested somewhere in other might be a drop.
    console.log 'drop', dest, op, other if debug

    # The other op deletes everything in this subtree anyway.
    return dest if other?.p == null

    if op && (op.di != undefined || (op.d? && slotMap[op.d]?))
      # Uh oh. They collide. There can only be one (tear!)
      unless hasDrop(other) && side == RIGHT
        dest ?= {}
        dest.d = slotMap[op.d] if op.d?
        dest.di = op.di if op.di != undefined

    if (slot = other?.d)?
      console.warn 'Overwriting!' if dest
      dest = held[slot]
      console.log "dropping slot #{slot} =", dest if debug

      # For debugging.
      delete held[slot]


    # ***** Object children
    if other?.o then for k, otherChild of other.o
      dest = addOChild dest, k, drop dest?.o?[k], op?.o?[k], otherChild

    if op?.o then for k, opChild of op.o when !other?.o?[k]
      # yadda yadda deep copy.
      dest = addOChild dest, k, drop dest?.o?[k], opChild, null


    # **** List children
    if other?.l || op?.l
      opList = op?.l
      otherList = other?.l

      console.log 'fancy list splice in drop', opList, otherList if debug

      opKeys = sortedKeys opList
      otherKeys = sortedKeys otherList

      # Map from raw index -> transformed index
      rawToOtherMap = xfMap otherKeys, otherList

      # I'm surprised this is needed. We need to transform the other map's
      # indexes too!
      rawToOpMap = xfMap opKeys, opList

      # Map from drop index in op -> raw index offset
      opToRawOffset = xfListReversePick opKeys, opList

      # Map from drop index in other -> raw index offset
      otherToRawOffset = xfListReversePick otherKeys, otherList

      opI = otherI = 0

      while (a = opI < opKeys.length; b = otherI < otherKeys.length; a || b)
        #console.log opI, otherI, opKeys.length, otherKeys.length
        opChild = otherChild = null

        if a
          opKey = opKeys[opI]
          opRawOffset = opToRawOffset opKey
          opRaw = opKey + opRawOffset
          opIdx = rawToOtherMap(opRaw, LEFT, side) - opRawOffset
          opChild = opList[opKey]
          console.log 'opRaw', opRaw, 'op', opList[opKey] if debug

        if b
          otherKey = otherKeys[otherI]
          otherRawOffset = otherToRawOffset otherKey
          otherRaw = otherKey + otherRawOffset
          otherIdx = rawToOpMap(otherRaw, LEFT, 1-side) - otherRawOffset
          console.log 'otherRaw', otherRaw, 'other', otherList[otherKey] if debug
          otherChild = otherList[otherKey]

        if opChild && otherChild
          # See if we can knock one off.
          if opIdx < otherIdx then otherChild = null
          else if opIdx > otherIdx then opChild = null
          else
            assert.equal opIdx, otherIdx
            # Hmm... maybe one is an insert.
            otherChild = null if hasDrop opChild
            opChild = null if hasDrop otherChild
            assert opChild || otherChild

        opI++ if opChild
        otherI++ if otherChild
        xfIdx = if opChild then opIdx else otherIdx

        console.log 'list descend', xfIdx, opChild, otherChild if debug
        child = drop dest?.l?[xfIdx], opChild, otherChild
        dest = addLChild dest, xfIdx, child

         
    console.log 'drop returning', dest if debug
    return dest

  op = drop op, oldOp, otherOp

  #console.log 'pre strip:', JSON.stringify(op, null, 2) if debug
  console.log held if debug

  #strip op
  checkOp op
  console.log 'result:', op if debug
  return op





if require.main == module
  transform.debug = true
  #console.log transform op1, op2, 'left'

  transform {"l":{"2":{"di":"hi"}}}, {"l":{"2":{"p":null,"di":"other"}}}, 'right'




#  xf op, other, PICK_PHASE | DROP_PHASE


