
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

traverse = (obj, path, fn) ->
  stack = []
  container = data:obj
  key = 'data'

  for c in path
    console.log 'at', container, 'looking at', key
    value = c.v
    switch c.t
      when 'in'
        stack.push {container, key}
        container = container[key]
        key = value

      when 'skip'
        if typeof value is 'number'
          key += value
        else
          throw Error 'invalid skip' unless value > key
          key = value

      when 'out'
        value ||= 1
        {container, key} = stack.pop() for [0...value]

      else
        fn container, key, c

apply = (obj, op) ->
  held = []
  if op.pick
    markers = []
    traverse obj, op.pick, (container, key, c) ->
      if c.t is 'pickup'
        console.log 'pickup', key, container
        markers.push {container, key}
        # Note that we don't actually take it out of the object yet.

      else
        throw Error 'Invalid component', c

    held.length = markers.length
    for {container, key}, i in markers by -1
      held[i] = container[key]
      if typeof key is 'string'
        delete container[key]
      else
        container.splice key, 1

    console.log held

  if op.drop
    traverse obj, op.drop, (container, key, c) ->
      if c.t is 'drop'
        idx = c.v
        throw Error 'Held component already dropped' if held[idx] is undefined
        if typeof key is 'string'
          container[key] = held[idx]
        else
          container.splice key, 0, held[idx]

        held[idx] = undefined # Mark that its been used.
      else
        throw Error 'Invalid component', c

  
  throw Error "Held item #{i} not used" for h, i in held when h != undefined


  console.log "result", obj

C = (type, value) -> {t:type, v:value}

#apply {x:5, y:[10,11,12]},
#  pick:[C('in', 'x'), C('pickup'), C('skip', 'y'), C('in', 1), C('pickup')]
#  drop:[C('in', 'a'), C('drop', 1), C('skip', 'z'), C('drop', 0)]


# Swap items
#apply {x:{y:5}},
#  pick: [C('in','x'), C('pickup'), C('in', 'y'), C('pickup')]
#  drop: [C('in','y'), C('drop',1), C('in', 'x'), C('drop',0)]


# Swap items
console.log {x:{y:{was:'y'}, was:'x'}}
apply {x:{y:{was:'y'}, was:'x'}, was:'root'},
  pick: [C('in','x'), C('pickup'), C('in', 'y'), C('pickup')]
  drop: [C('in','x'), C('drop',1), C('in', 'y'), C('drop',0)]
