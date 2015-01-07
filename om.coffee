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
    if c.in?
      stack.push {container, key}
      container = container[key]
      key = c.in

    else if c.skip?
      if typeof c.skip is 'number'
        key += c.skip
      else
        throw Error 'invalid skip' unless c.skip > key
        key = c.skip

    else if c.out?
      {container, key} = stack.pop()

    else
      fn container, key, c

apply = (obj, op) ->
  held = []
  if op.pick
    markers = []
    traverse obj, op.pick, (container, key, c) ->
      if c.pickup
        markers.push {container, key}
        # Note that we don't actually take it out of the object yet.

      else
        throw Error 'Invalid component', c

    for {container, key} in markers by -1
      held.push container[key]
      if typeof key is 'string'
        delete container[key]
      else
        container.splice key, 1

    console.log held

  if op.drop
    traverse obj, op.drop, (container, key, c) ->
      if (idx = c.drop)?
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


#traverse {}
#traverse {x:5, y:[10,11,12]}, [{in: 'x'}, {skip:'y'}, {in:1}, {na:5}, {skip:1}, {li:"oh hi"}, {out:1}, {skip:'z'}, {oi:'hi'}]
#traverse {a:{b:{c:{x:5}}}}
#traverse [1,2,3]


#apply {x:5, y:[10,11,12]},
#  pick:[{in:'x'}, {pickup:true}, {skip:'y'}, {in:1}, {pickup:true}]
#  drop:[{in:'a'}, {drop:1}, {skip:'z'}, {drop:0}]

apply {x:{y:5}},
  pick: [{in:'x'}, {pickup:true}, {in: 'y'}, {pickup:true}]
  drop: [{in:'y'}, {drop:1}, {in:'x'}, {drop:0}]

