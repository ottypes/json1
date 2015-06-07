
LEFT = 0
RIGHT = 1

# This function takes a sparse list object (l:{1:..., 5:...} and returns a
# sorted list of the keys [1,5,...]
sortedKeys = (list) ->
  if list
    (+x for x of list).sort (a, b) -> a - b
  else
    []


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



checkOp = (op) ->
  # Invariant: There are no empty leaves.
  # Invariant: Every pick has a corresponding drop. Every drop has a corresponding pick.
  # Invariant: Slot names start from 0 and they're contiguous.



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

hasDrop = (op) -> op && (op.d? || op.di != undefined)

copyDrop = (dest, op) ->
  dest ?= {}
  dest.d = op.d if op.d?
  dest.di = op.di if op.di != undefined
  return dest

transform = (oldOp, otherOp, direction) ->
  side = if direction == 'left' then LEFT else RIGHT
  debug = transform.debug

  checkOp oldOp
  checkOp otherOp

  if debug
    console.log "transforming #{direction}:"
    console.log 'op', JSON.stringify(oldOp, null, 2)
    console.log 'op2', JSON.stringify(otherOp, null, 2)

  held = []

  console.log '---- pick phase ----' if debug

  pick = (op, other) ->
    return null if !op?
    # other can be null

    console.log 'pick', op, other if debug

    return null if other?.p is null
    return {p:null} if op.p is null

    dest = if op.p? then {p:op.p} else null
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
    # Any of dest, op and other can be null. No early return here because
    # nested somewhere in other might be a drop.
    console.log 'drop', dest, op, other if debug

    # The other op deletes everything in this subtree anyway.
    return dest if other?.p == null

    if hasDrop(op)
      # Uh oh. They collide. There can only be one (tear!)
      dest = copyDrop(dest, op) unless hasDrop(other) && side == RIGHT

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
        if b
          otherKey = otherKeys[otherI]

          if otherList[otherKey].p == null
            otherI++
            continue

          otherRawOffset = otherToRawOffset otherKey
          otherRaw = otherKey + otherRawOffset
          otherIdx = rawToOpMap(otherRaw, LEFT, 1-side) - otherRawOffset
          console.log 'otherRaw', otherRaw, 'other', otherList[otherKey] if debug

        if a
          opKey = opKeys[opI]
          opRawOffset = opToRawOffset opKey
          opRaw = opKey + opRawOffset
          opIdx = rawToOtherMap(opRaw, LEFT, side) - opRawOffset
          console.log 'opRaw', opRaw, 'op', opList[opKey] if debug

        opChild = otherChild = null

        if a && (!b || opIdx <= otherIdx)
          # Left because drops always insert left of the target
          xfIdx = opIdx
          opChild = opList[opKey]
          opI++
        if b && (!a || opIdx >= otherIdx)
          xfIdx = otherIdx
          otherChild = otherList[otherKey]
          otherI++

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




op1 =
  o:
    x: {p:0}
    y: {d:0}

op2 =
  o:
    x:
      p:0
      o:
        a: {p:1}
    _x: {d:0}
    _a: {d:1}


#op1 = {}


if require.main == module
  transform.debug = true
  console.log transform op1, op2, 'left'




#  xf op, other, PICK_PHASE | DROP_PHASE


module.exports =
  transform: transform


