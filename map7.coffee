# This iteration makes inserts and list operations work.

util = require 'util'

C = (type, value) -> {t:type, v:value}

mappingChild = (map, key, create = yes) ->
  return null if map is null # in deleted region
  if typeof key is 'number'
    if create
      map.l ||= {} # The object is used as a sparse list.
      map.l[key] ||= {}
    else
      map and map.l?[key]
  else
    if create
      map.o ||= {}
      map.o[key] ||= {}
    else
      map and map.o?[key]

stepCursor = (cursor, step, key, create = true) ->
  {map, stack} = cursor
  return if key is null # walk2 workaround.
  switch step
    when 'in'
      stack.push map
      cursor.map = mappingChild map, key, create
    when 'out'
      cursor.map = stack.pop()
  return

# Prefix tree walking
walk = (map, fn) ->
  if map.p # Pickup phase behaviour
    fn 'pickup', map.p, map
  if map.d # Drop behaviour
    fn 'drop', map.d, map
  if map.edit # Generic editing here. TODO
    fn 'edit', map.edit, map
  
  if map.o
    # Object children
    for k, child of map.o
      fn 'in', k, child
      walk child, fn
      fn 'out', k, child

  if map.l
    # list children
    for k, child of map.l
      # This should track offsets in each of the phases.
      k = +k
      fn 'in', k, child
      walk child, fn
      fn 'out', k, child

walk2 = (map, fn) ->
  fn 'in', null, map
  walk map, fn

# Returns true if the entire tree can be removed.
strip = (map) ->
  canRemove = !map.p and !map.d and !map.edit

  delete map._xfpick
  delete map._xfdrop

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



xf = (oldOp, otherOp) ->
  op = {}

  # Index is a map of move indexes in the other op.
  index = []

  opCursor = {map:op, stack:[]}
  walk otherOp, (step, action, map) ->
    stepCursor opCursor, step, action
    {map} = opCursor
    if step is 'pickup'
      map._xfpick = if action.t is 'del' then -1 else action.v # TODO: Handle del here
    if step is 'drop'
      if action.t is 'ins'
        console.log 'unhandled insert'
      else if action.t is 'move'
        index[action.v] = map
        map._xfdrop = action.v # redundant, useful for debugging.

  throw Error 'Missing data' unless v for i, v in index
  console.log util.inspect op, depth:10, colors:true

  console.log 'index', index

  teleCursor = {map:op, stack:[]}
  opCursor = {map:op, stack:[]}
  # walk2 = the first step is always 'in' with a null key. This is important
  # for moves from the document root.
  walk2 oldOp, (step, key, child) ->
    stepCursor teleCursor, step, key

    if step is 'in' and (idx = teleCursor.map._xfpick)?
      console.log 'tele', key, idx
      opCursor.stack.push opCursor.map
      opCursor.map = if idx is -1 then null else index[idx]
      console.log '-> ', opCursor.map
    else
      # Step 
      stepCursor opCursor, step, key

    console.log step, key, opCursor.map

    if opCursor.map != null
      if step is 'pickup'
        opCursor.map.p = key
      else if step is 'drop'
        opCursor.map.d = key
      else if step is 'edit'
        console.log 'copying edit'
        opCursor.map.edit = key

  strip op
  console.log util.inspect op, depth:10, colors:true

###
  
op2 =
  l:
    '0': {p:C('del')}

op1 =
  o: x: p:C('move', 0)
  l:
    '2': {d:C('move', 0)}

xf op1, op2
return

op2 =
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

op2 =
  o:
    x:
      p: C('move', 0)
      o:
        a: {p:C('del')}
    _a: {d:C('move',0)}


op1 =
  o:
    x:
      edit: C('do', 'stuff')
      o:
        a: {p:C('del')}

  
xf op1, op2
return
###

#C = (type, value) -> {t:type, v:value}

# {x:5, y:[10,11,12]} -> {a:11, z:5, y:[10,12]}
#  pick:[C('in', 'x'), C('pickup'), C('skip', 'y'), C('in', 1), C('pickup')]
#  drop:[C('in', 'a'), C('drop', 1), C('skip', 'z'), C('drop', 0)]

###
op1 =
  o:
    x: {p:0}
    y:
      l: '1': {p:1}
    a: {d:1}
    z: {d:0}

op2 =
  o:
    y:
      l:
        0: p: 0
        1: p: 'del'
    q:
      d: 0


#walk op2, (what, val, map) -> console.log what, val

xf op1, op2
###

# Swap items

op2 =
  o:
    a:
      p: C('move', 0)
      o:
        b:
          p: C('move', 1)
    b:
      d: C('move', 1)
      o:
        a:
          d: C('move', 0)

op1 =
  o:
    a:
      edit: C('edit', 'a')
      o:
        b:
          edit: C('edit', 'b')

xf op1, op2


#apply {x:{y:5}},
#map = opToMap
#  pick: [C('in','x'), C('pickup'), C('in', 'y'), C('pickup')]
#  drop: [C('in','y'), C('drop',1), C('in', 'x'), C('drop',0)]


# data.x.y.z = 5, which should translate to data.y = 5.
#op =
#  pick: [C('in', 'x'), C('in', 'y'), C('in', 'z'), C('del')]

#xf op, map

# Swap items
#console.log {x:{y:{was:'y'}, was:'x'}}
#apply {x:{y:{was:'y'}, was:'x'}, was:'root'},
#  pick: [C('in','x'), C('pickup'), C('in', 'y'), C('pickup')]
#  drop: [C('in','x'), C('drop',1), C('in', 'y'), C('drop',0)]

