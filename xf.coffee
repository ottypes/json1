
# This function takes a sparse list object (l:{1:..., 5:...} and returns a
# sorted list of the keys [1,5,...]
sortedKeys = (list) -> (+x for x of list).sort (a, b) -> a - b


# This function returns a function which maps a list position through an
# operation. keys is the l: property of the other op, and list must be
# sortedKeys(keys).
#
# The returned function is called with an index. The passed index must be >=
# any previously passed index.
xfMap = (keys, list) ->
  pickKeyPos = dropKeyPos = 0
  pickOffset = dropOffset = 0

  (src) ->
    while pickKeyPos < keys.length and (k = keys[pickKeyPos]) <= src
      pickKeyPos++
      if list[k].p != undefined
        if src == k
          console.log 'TODO - requested item was picked up by other op.'
        pickOffset--

    src2 = src + pickOffset
    while dropKeyPos < keys.length and (k = keys[dropKeyPos]) < src2 + dropOffset
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



check = (op) ->


addDestObjChild = (dest, key, child) ->
  return dest unless child
  dest ?= {}
  dest.o ?= {}
  dest.o[key] = child
  return dest

addDestListChild = (dest, key, child) ->
  return dest unless child
  dest ?= {}
  dest.l ?= {}
  dest.l[key] = child
  return dest


transform = (oldOp, otherOp, direction) ->
  debug = transform.debug

  check oldOp
  check otherOp

  #op = shallowClone oldOp
  console.log 'transforming', JSON.stringify(oldOp, null, 2) if debug

  held = []

  console.log '---- pick phase ----' if debug

  pick = (op, other) ->
    return null if !op?
    # other can be null

    console.log 'pick', op, other if debug

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
        oldChild = op.o[k] # might be null.
        dest = addDestObjChild dest, k, pick oldChild, otherChild

      # Add in anything that hasn't been copied over as a result of iterating
      # through other, above. This might be worth special casing instead of
      # calling pick recursively.
      for k, oldChild of op.o when !other?.o?[k]
        # Basically just copy them in.
        dest = addDestObjChild dest, k, pick oldChild, null

    # **** List children
    if (list = op.l)
      if other?.l
        console.log 'fancy list splice' if debug
        opK = sortedKeys list
        otherK = sortedKeys other.l

        # Iterate through children, adjusting indexes as needed.

        otherMap = xfMap otherK, other.l

        for idx, i in opK
          oldChild = list[idx]
          otherChild = other.l[idx]
          if (child = pick oldChild, otherChild)
            newIdx = otherMap idx
            dest = addDestListChild dest, newIdx, child
      else
        # Just go through normally - no transform of indexes needed.
        for idx, oldChild of list
          dest = addDestListChild dest, idx, pick oldChild, null

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

    if (slot = op?.d)?
      dest ?= {}
      dest.d = slot
    if (obj = op?.di) != undefined
      dest ?= {}
      dest.di = obj # Shallow copy of the data itself.

    if (slot = other?.d)?
      console.warn 'Overwriting!' if dest
      dest = held[slot]
      console.log "dropping slot #{slot} =", dest if debug

      # For debugging.
      delete held[slot]


    # ***** Object children
    if other?.o then for k, otherChild of other.o
      destChild = dest?.o?[k]
      opChild = op?.o?[k]
      dest = addDestObjChild dest, k, drop destChild, opChild, otherChild

    if op?.o then for k, opChild of op.o when !other?.o?[k]
      # yadda yadda deep copy.
      destChild = dest?.o?[k]
      dest = addDestObjChild dest, k, drop destChild, opChild, null


    # **** List children
    if other?.l || op?.l
      opList = op?.l || {}
      otherList = other?.l || {}

      console.log 'fancy list splice in drop', opList, otherList if debug

      opKeys = if opList then sortedKeys(opList) else []
      otherKeys = sortedKeys otherList

      # Map from raw index -> transformed index
      rawToOtherMap = xfMap otherKeys, otherList

      # Map from drop index in op -> raw index offset
      opToRawOffset = xfListReversePick opKeys, opList

      # Map from drop index in other -> raw index offset
      otherToRawOffset = xfListReversePick otherKeys, otherList


      opI = otherI = 0
      opRawOffset = 0

      while opI < opKeys.length || otherI < otherKeys.length
        #console.log opI, otherI, opKeys.length, otherKeys.length
        if opI < opKeys.length
          opKey = opKeys[opI]
          opRawOffset = opToRawOffset opKey
          opRaw = opKey + opRawOffset
          #console.log 'opRaw', opRaw

        if otherI < otherKeys.length
          otherKey = otherKeys[otherI]
          otherRaw = otherKey + otherToRawOffset otherKey

          #console.log 'otherRaw', otherRaw

        if otherI >= otherKeys.length || opRaw < otherRaw
          #console.log 'a'
          # Descend into op list
          xfIdx = rawToOtherMap(opRaw) - opRawOffset
          child = drop dest?.l?[xfIdx], opList[opKey], null
          dest = addDestListChild dest, xfIdx, child

          opI++
        else if opI >= opKeys.length || opRaw >= otherRaw
          #console.log 'b'
          # Descend into other.
          xfIdx = rawToOtherMap(otherRaw) - opRawOffset
          #console.log xfIdx, otherRaw, opRawOffset
          child = drop dest?.l?[xfIdx], null, otherList[otherKey]
          dest = addDestListChild dest, xfIdx, child

          otherI++
        else
          #console.log 'c'
          # Transform children against each other
          xfIdx = rawToOtherMap(opRaw) - opRawOffset
          child = drop dest?.l?[xfIdx], opList[opKey], otherList[otherKey]
          dest = addDestListChild dest, xfIdx, child

          opI++
          otherI++
         
    console.log 'drop returning', dest if debug
    return dest

  op = drop op, oldOp, otherOp

  #console.log 'pre strip:', JSON.stringify(op, null, 2) if debug
  console.log held if debug

  #strip op
  check op
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


