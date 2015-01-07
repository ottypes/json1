

traverse = (obj, path) ->
  stack = []
  container = data:obj
  key = 'data'

  for c in path
    console.log 'at', container, 'looking at', key
    if c.in?
      stack.push {container, key}
      container = container[key]
      key = c.in
      #throw new Error 'Not object' if Array.isArray



    else if c.skip?
      if typeof c.skip is 'number'
        key += c.skip
      else
        throw Error 'invalid skip' unless c.skip > key
        key = c.skip

    else if c.out?
      {container, key} = stack.pop()

    else if c.na?
      container[key] += c.na

    else if c.li?
      container.splice key, 0, c.li

    else if c.oi?
      container[key] = c.oi

    else
      throw Error 'Invalid component', c



  console.log "result", obj


#traverse {}
traverse {x:5, y:[10,11,12]}, [{in: 'x'}, {skip:'y'}, {in:1}, {na:5}, {skip:1}, {li:"oh hi"}, {out:1}, {skip:'z'}, {oi:'hi'}]
#traverse {a:{b:{c:{x:5}}}}
#traverse [1,2,3]
