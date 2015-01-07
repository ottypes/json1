isArray = Array.isArray || (obj) ->
  Object.prototype.toString.call(obj) == '[object Array]'

clone = (obj) -> JSON.parse JSON.stringify obj



traverseObj = (obj, path, fn) ->
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



module.exports =
  name: 'jsonmove-experiment'

  create: (data) -> if data? then clone(data) else null
  
  apply: (snapshot, op) ->
    if op.pick
      markers = []
      traverseObj snapshot, op.pick, (container, key, c) ->
        if c.t is 'pickup'
          markers.push {container, key, del:false}
          # Note that we don't actually take it out of the object yet.
        else if c.t is 'del'
          markers.push {container, key, del:true}

        else
          throw Error 'Invalid component', c

      held = new Array markers.length
      for {container, key, del}, i in markers by -1
        held[i] = container[key] unless del
        if typeof key is 'string'
          delete container[key]
        else
          container.splice key, 1

      console.log held

    if op.drop
      traverseObj snapshot, op.drop, (container, key, c) ->
        if c.t is 'drop'
          idx = c.v
          throw Error 'held component not picked up' unless held && held.length > idx
          throw Error 'Held component already dropped' if held[idx] is undefined
          if typeof key is 'string'
            container[key] = held[idx]
          else
            container.splice key, 0, held[idx]

          held[idx] = undefined # Mark that its been used.
        else if c.t is 'ins'
          if typeof key is 'string'
            throw Error 'Trying to overwrite value without deleting it' if container[key] != undefined
            container[key] = c.v
          else
            container.splice key, 0, c.v
        else
          throw Error 'Invalid component', c

    
    throw Error "Held item #{i} not used" for h, i in held when h != undefined
    console.log "result", snapshot

    return snapshot

  compose: (op1, op2) ->
    throw Error 'Not implemented'

  transform: (op, otherOp, side) ->
    newOp = pick:[], drop:[]




