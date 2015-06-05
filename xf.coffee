

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




transform = (oldOp, other, direction) ->
  debug = transform.debug

  check oldOp
  check other

  op = shallowClone oldOp
  console.log 'transforming', JSON.stringify(op, null, 2) if debug

  held = []

  console.log '---- pick phase ----' if debug

  pick = (me, other, parent, key) ->
    if me.o and other.o then for k, otherChild of other.o when (child = me.o[k])?
      pick child, otherChild, me, k

    if other.p?
      # Pick this node up
      if parent
        delete parent.o[key]
      else
        op = null

      if other.p != null
        console.log "picking up to slot #{other.p}", me if debug
        held[other.p] = me
    
  pick op, other

  console.log 'held', held if debug
  console.log '---- drop phase ----' if debug

  drop = (me, other, parent, key) ->
    if other.d?
      val = held[other.d] || {}
      if parent
        parent.o ?= {}
        console.log "dropping slot #{other.d} =", val, parent if debug
        #console.warn('overwriting data!', key, parent.o, parent.o[key]) if parent.o[key]?
        parent.o[key] = me = val
      else
        op = val

      delete held[other.d]

    if other.o
      me.o ?= {}
      for k, otherChild of other.o
        me.o[k] ?= {}
        drop me.o[k], otherChild, me, k

  drop op, other

  console.log 'pre strip:', JSON.stringify(op, null, 2) if debug
  console.log held if debug

  strip op
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



#console.log transform op1, op2, 'left'




#  xf op, other, PICK_PHASE | DROP_PHASE


module.exports =
  transform: transform


