assert = require 'assert'

isObject = (o) -> o && typeof(o) is 'object' && !Array.isArray(o)

isGreaterKey = (a, b) ->
  if typeof(a) is typeof(b)
    a > b
  else
    typeof a is 'string' and typeof b is 'number'

makeCursor = (op = null) ->
  # Each time we descend we store the parent and the index of the child.
  # The indexes list is appended twice each time we descend - once with the last
  # key index of the parent, and once with the index of the array we're
  # descending down.
  parents = []
  indexes = []

  # The index of the last listy child we visited for write cursors. This is used
  # to ensure we are traversing the op in order.
  lcIdx = -1

  # The way we handle the root of the op is a big hack - its like that because
  # the root of an op is different from the rest; it can contain a component
  # immediately.
  # Except at the root (which could be null), container will always be a list.
  container = op; idx = -1

  ascend = ->
    assert.equal parents.length, indexes.length / 2
    if idx is 0
      if parents.length
        lcIdx = indexes.pop()
        container = parents.pop()
        idx = indexes.pop()
      else
        #log 'dodgy hax ascension'
        lcIdx = 0
        idx = -1
    else
      idx--
      idx-- if isObject container[idx]

  read: ->
    # Only valid to call this after descending into a child.
    getKey: -> container[idx]

    getComponent: ->
      if container && container.length > idx + 1 && isObject (c = container[idx + 1])
        return c
      else
        return null

    hasChildren: -> container && (idx+1) < container.length &&
            (!isObject(container[idx+1]) || (idx+2) < container.length)

    descendFirst: ->
      # Only valid to call this if hasChildren() returns true.
      assert @hasChildren()
      i = idx + 1
      i++ if isObject container[i]
      firstChild = container[i]
      if Array.isArray firstChild
        indexes.push idx
        parents.push container
        indexes.push i
        idx = 0
        container = firstChild
      else
        idx = i

    nextSibling: ->
      # children are inline or we're at the root
      return false if idx > 0 or parents.length is 0
      assert.equal parents.length, indexes.length / 2
      i = indexes[indexes.length - 1] + 1
      c = parents[parents.length - 1]
      return false if i >= c.length # Past the end of the listy children
      assert !isNaN(i)
      indexes[indexes.length - 1] = i
      container = c[i]
      # idx = 0 # But it should be zero anyway...
      return true

    ascend: ascend

  write: ->
    pendingDescent = []

    flushDescent = ->
      assert.equal parents.length, indexes.length / 2

      # First flush and pending descents.
      if container == null
        op = container = []

      for k in pendingDescent
        #log 'flushDescent', k, container, idx
        i = idx + 1
        i++ if i < container.length and isObject(container[i]) # Skip the component here, if any.

        assert i == container.length || !isObject container[i]

        if i == container.length
          # Just append a child here.
          #log 'strategy: push to the end'
          container.push k
          idx = i

        else if container[i] == k
          #log 'strategy: traverse right'
          idx = i

        else

          if !Array.isArray container[i]
            # Its not an array. Its not the same as me. I must have a new child! Woohoo!
            #log '(making a child)'
            oldChild = container.splice i, container.length - i
            container.push oldChild

          indexes.push idx
          #log 'strategy: descend'
          parents.push container

          if lcIdx != -1
            #log 'i', i, 'lcIdx', lcIdx
            assert isGreaterKey k, container[lcIdx][0]
            i = lcIdx + 1
            lcIdx = -1

          i++ while i < container.length and isGreaterKey k, container[i][0]
          indexes.push i
          idx = 0
          if i < container.length and container[i][0] == k
            container = container[i]
          else
            # Insert a new child and descend into it.
            container.splice i, 0, (child = [k])
            container = child

      pendingDescent.length = 0

    write: (key, value) ->
      flushDescent()

      # Actually writing is quite easy now.
      i = idx + 1
      if i < container.length and isObject container[i]
        container[i][key] = value
      else
        component = {}
        component[key] = value
        container.splice i, 0, component

    get: -> op
    descend: (key) -> pendingDescent.push key
    ascend: ->
      if pendingDescent.length
        pendingDescent.pop()
      else
        ascend()

exports.writeCursor = (op) -> makeCursor(op).write()
exports.readCursor = (op) -> makeCursor(op).read()
