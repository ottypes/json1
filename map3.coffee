util = require 'util'
# Simple idea: Think of the process in a set of phases which happen in order:
#
# First the pickup phase marks objects for pickup. After the pickup phase runs,
# we go through and pick up all the objects. (Notably, you can still decend
# into picked up objects after marking them during the pickup phase).
#
# Then maybe we have an edit phase where we make all the normal edits.
#
# Finally we have a drop phase where we go through and insert back all the
# things we picked up.

mappingChild = (mapping, key) ->
  if typeof key is 'number'
    mapping.clist ||= []
    mapping.clist[key] ||= {}
  else
    mapping.cobj ||= {}
    mapping.cobj[key] ||= {}

stepCursor = (cursor, c) ->
  {mapping, stack} = cursor
  value = c.v
  switch c.t
    when 'in'
      stack.push {mapping, value}
      # Decend
      cursor.mapping = mappingChild mapping, value

    when 'skip'
      throw Error 'Cannot skip at root' unless stack.length
      topstack = stack[stack.length - 1]
      {mapping:parent, value:prevValue} = topstack

      if typeof c.v is 'number'
        value += prevValue
      else
        throw Error 'invalid skip' unless value > prevValue

      cursor.mapping = mappingChild parent, value
      topstack.value = value

    when 'out'
      value ||= 1
      {mapping} = stack.pop() for [0...value]
      cursor.mapping = mapping


fillMapping = (mapping, path, fn) ->
  {stack} = cursor = {stack:[], mapping}

  for c in path
    stepCursor cursor, c
    fn cursor, c
  return


opToMap = (op) ->
  map = {}

  pickups = [] # map from pickup id -> pickup mapping.
  if op.pick then fillMapping map, op.pick, ({mapping}, {t, v}) ->
    if t is 'pickup'
      #mapping.pickid = pickups.length
      pickups.push(mapping) - 1 # push returns new length
    else if t is 'del'
      mapping.del = true

  if op.drop then fillMapping map, op.drop, ({mapping}, {t, v}) ->
    if t is 'drop'
      pickMap = pickups[v]
      throw Error "Component #{v} already dropped" unless pickMap
      pickups[v] = null
      #mapping.dropid = v

      pickMap.mapTo = mapping
      mapping.mapFrom = pickMap
    else if t is 'insert'
      mapping.insert = v

  console.log util.inspect map, depth:10, colors:true
  return map

xf = (oldOp, map) ->
  mappingCursor = {stack:[], mapping:map}
  location = {stack:[], mapping:map}

  pickups = []

  for c in (oldOp.pick || [])
    # I think it would also be valid to put this at the end, and check for op types which aren't 'in' or something.
    if c.t in ['skip', 'out'] and (src = location.mapping.mapFrom)
      console.log 'tele back'
      location.mapping = location.mapping.mapFrom

    stepCursor mappingCursor, c
    stepCursor location, c

    if c.t is 'del'
      location.mapping.xfdel = true
    else if c.t is 'pickup'
      location.mapping.xfpick = pickups.length
      pickups.push location.mapping

    if c.t in ['skip', 'in'] and (dest = mappingCursor.mapping.mapTo)
      console.log 'teleporting'
      location.mapping = dest
    

  console.log util.inspect map, depth:10, colors:true

  



  


C = (type, value) -> {t:type, v:value}

#apply {x:5, y:[10,11,12]},
#  pick:[C('in', 'x'), C('pickup'), C('skip', 'y'), C('in', 1), C('pickup')]
#  drop:[C('in', 'a'), C('drop', 1), C('skip', 'z'), C('drop', 0)]


# {x:5, y:[10,11,12]} -> {a:11, z:5, y:[10,12]}
map = opToMap
  pick:[C('in', 'x'), C('pickup'), C('skip', 'y'), C('in', 1), C('pickup')]
  drop:[C('in', 'a'), C('drop', 1), C('skip', 'z'), C('drop', 0)]

op =
  pick:[C('in', 'y'), C('in', 1), C('del'), C('skip', 1), C('pickup')]

xf op, map


# Swap items
#apply {x:{y:5}},
map = opToMap
  pick: [C('in','x'), C('pickup'), C('in', 'y'), C('pickup')]
  drop: [C('in','y'), C('drop',1), C('in', 'x'), C('drop',0)]


# data.x.y.z = 5, which should translate to data.y = 5.
op =
  pick: [C('in', 'x'), C('in', 'y'), C('in', 'z'), C('del')]

xf op, map

# Swap items
#console.log {x:{y:{was:'y'}, was:'x'}}
#apply {x:{y:{was:'y'}, was:'x'}, was:'root'},
#  pick: [C('in','x'), C('pickup'), C('in', 'y'), C('pickup')]
#  drop: [C('in','x'), C('drop',1), C('in', 'y'), C('drop',0)]

