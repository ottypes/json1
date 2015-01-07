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
    mapping.l ||= []
    mapping.l[key] ||= {}
  else
    mapping.o ||= {}
    mapping.o[key] ||= {}

# Prefix tree walking
walk = (mapping, phase, fn) ->
  if mapping.p? and phase is 'pickup' # Pickup phase behaviour
    fn 'pickup', mapping.p
  if mapping.d? and phase is 'drop' # Drop behaviour
    fn 'drop', mapping.d
  
  if mapping.o
    # Object children
    for k, child of mapping.o
      fn 'in', k, child
      walk child, phase, fn
      fn 'out', k, child

  if mapping.l
    # list children
    for k, child of mapping.l
      # This should track offsets in each of the phases.
      k = +k
      fn 'in', k, child
      walk child, phase, fn
      fn 'out', k, child

  



  


#C = (type, value) -> {t:type, v:value}

# {x:5, y:[10,11,12]} -> {a:11, z:5, y:[10,12]}
#  pick:[C('in', 'x'), C('pickup'), C('skip', 'y'), C('in', 1), C('pickup')]
#  drop:[C('in', 'a'), C('drop', 1), C('skip', 'z'), C('drop', 0)]

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
        '0': p: 0
        '1': p: 'del'
    q:
      d: 0


walk op2, 'pickup', (what, val, map) -> console.log what, val
console.log '---'
walk op2, 'drop', (what, val, map) -> console.log what, val
#xf op1, op2


# Swap items
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

