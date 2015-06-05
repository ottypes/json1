

# Clone an operation, but only do a shallow copy of any inserted objects.
shallowClone = (from) ->
  to = {}
  to.p = from.p if from.p?
  to.d = from.d if from.d?
  to.e = from.e if from.e

  if from.o
    to.o = {}
    for k, v of from.o
      to.o[k] = shallowClone v

  if from.l
    to.l = {}
    for k, v of from.l
      to.l[k] = shallowClone v

  return to


# Returns true if the entire tree can be removed.
strip = (map) ->
  canRemove = !map.p? and !map.d? and !map.di? and !map.e

  for mapKey in ['o', 'l']
    if (m = map[mapKey])
      # Object children
      removeAllChildren = yes
      for k, child of m
        if strip child
          delete m[k]
        else
          removeAllChildren = no
          canRemove = no

      if removeAllChildren
        delete map[mapKey]

  return canRemove



check = (op) ->




transform = (oldOp, otherOp, direction) ->
  debug = transform.debug

  check oldOp
  check otherOp

  #op = shallowClone oldOp
  console.log 'transforming', JSON.stringify(oldOp, null, 2) if debug

  held = []

  console.log '---- pick phase ----' if debug

  pick = (op, other) ->
    console.log 'pick', op, other if debug
    # Any / all of op, other and parent can be null.

    return null if op?.p is null

    dest = if op?.p? then {p:op.p} else null
    if (edit = op?.e)
      dest ?= {}
      dest.e = edit
 
    if other?.o then for k, otherChild of other.o
      oldChild = op?.o?[k]
      if (child = pick oldChild, otherChild)
        dest ?= {}
        dest.o ?= {}
        dest.o[k] = child

    # Add in anything that hasn't been copied over as a result of iterating
    # through other, above. This might be worth special casing instead of
    # calling pick recursively.
    if op and op.o then for k, oldChild of op.o when !other?.o?[k]
      # Basically just copy them in.
      if (child = pick oldChild, null)
        dest ?= {}
        dest.o ?= {}
        dest.o[k] = child

    #if op.l and other.l
      # Decend through both lists, transforming 

    if (slot = other?.p)?
      # Pick this node up
      console.log "picking up to slot #{other.p}", dest if debug
      held[slot] = dest
      return null

    return dest

    
  op = pick oldOp, otherOp

  console.log '---- drop phase ---- -> held:', held if debug

  drop = (dest, op, other) ->
    if (slot = op?.d?)
      dest ?= {}
      dest.d = op.d

    # Again, any of dest, op and other can be null.
    if (slot = other?.d)?
      console.warn 'Overwriting!' if dest
      dest = held[slot]
      console.log "dropping slot #{slot} =", dest if debug

      # For debugging.
      delete held[slot]

    if other?.o then for k, otherChild of other.o
      destChild = dest?.o?[k]
      opChild = op?.o?[k]
      if (destChild = drop destChild, opChild, otherChild)
        dest ?= {}
        dest.o ?= {}
        dest.o[k] = destChild

    if op?.o then for k, opChild of op.o when !other?.o?[k]
      # yadda yadda deep copy.
      destChild = dest?.o?[k]
      if (destChild = drop destChild, opChild, null)
        dest ?= {}
        dest.o ?= {}
        dest.o[k] = destChild

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


