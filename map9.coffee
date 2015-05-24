# This iteration makes the teleport index lazy
#
#
# ABANDONED - this doesn't work.

util = require 'util'

i = (obj) -> util.inspect obj, depth:10, colors:true

C = (type, value) -> {t:type, v:value}

Cursor = (@map) ->
  @stack = []
  return

Cursor::push = (map) -> @stack.push @map; @map = map
Cursor::pop = -> @map = @stack.pop()

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

Cursor::step = (step, key, create = true) ->
  return if key is null # walk2 workaround.
  switch step
    when 'in'
      @push mappingChild @map, key, create
    when 'out'
      @pop()
  return

# Prefix tree walking
_walk = (map, fn) ->
  fn 'drop', map.d, map if map.d

  # TODO when does this happen?
  fn 'edit', map.edit, map if map.edit
  
  # Object children
  if map.o then for k, child of map.o
    fn 'in', k, child
    _walk child, fn
    fn 'out', k, child

  # list children
  if map.l then for k, child of map.l
    # This should track offsets in each of the phases.
    k = +k
    fn 'in', k, child
    _walk child, fn
    fn 'out', k, child

  fn 'pickup', map.p, map if map.p

walk = (map, fn) ->
  fn 'in', null, map
  _walk map, fn
  fn 'out', null, map

# Returns true if the entire tree can be removed.
strip = (map) ->
  canRemove = !map.p and !map.d and !map.edit

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


# Clone an operation, but only do a shallow copy of any inserted objects.
shallowClone = (from) ->
  to = {}
  to.p = from.p if from.p
  to.d = from.d if from.d

  to.edit = from.edit if from.edit

  if from.o
    to.o = {}
    for k, v of from.o
      to.o[k] = shallowClone v

  if from.l
    to.l = {}
    for k, v of from.l
      to.l[k] = shallowClone v

  to


xf = (oldOp, otherOp) ->
  # Make a copy then rip it apart.
  op = shallowClone oldOp

  opCursor = new Cursor op

  held = []

  # STEP 1: Do all the picks.
  walk otherOp, (step, key, child) ->
    #console.log step, key, opCursor

    if step is 'in' and child.p
      # This is a bit of a hack... we're going to come back to this node soon
      # and pick it up. But when we do, we want to unlink it from the tree. So
      # I'll do that here where its easy.
      console.log 'unlinking', key, opCursor
      parent = opCursor.map
      opCursor.step step, key, no
      if typeof key is 'number'
        delete parent?.l?[key]
      else
        delete parent?.o?[key]
    else
      opCursor.step step, key, no

    map = opCursor.map

    #console.log step, key, child, oldMap

    if step is 'pickup'
      console.warn 'unsupported', key if key.t not in ['move', 'del']

      console.log 'pick', key.v, map

      if key.t is 'move'
        held[key.v] = map


  console.log 'held', i held
  console.log 'op', i op


  # STEP 2: All the drops
  walk otherOp, (step, key, child) ->
    if step is 'in' and child.d
      drop = child.d
      if drop.t is 'move'
        value = held[drop.v]
        console.log 'drop', drop.v, value
      else
        # The other op is inserting. We'll run the same clobber logic.
        value = {}

      parent = opCursor.map
      type = if typeof key is 'number' then 'l' else 'o'
      parent[type] ||= {}
      if parent[type][key]?.d
        console.error 'Clobbering existing drop - TODO.'
      parent[type][key] = value

    opCursor.step step, key, yes


  strip op
  op

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

op1 =
  o:
    x: {p:C('move', 0)}
    y:
      l: '1': {p:C('move', 1)}
    a: {d:C('move', 1)}
    z: {d:C('move', 0)}

op2 =
  o:
    y:
      l:
        0: p: C('move', 0)
        1: p: C('del')
    q:
      d: C('move', 0)


#walk op2, (what, val, map) -> console.log what, val

console.log i xf op1, op2
return

assert = require 'assert'
for {op1, op2, expect} in require('./tests')
  console.log 'xf op1', i(op1)
  console.log 'xf op2', i(op2)
  result = xf op1, op2
  console.log '----->', i(result)
  assert.deepEqual result, expect


