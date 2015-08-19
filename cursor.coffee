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

    descendFirst: ->
      i = idx + 1

      # Only valid to call this if hasChildren() returns true.
      return false if !container || i >= container.length ||
              (isObject(container[i]) && (i+1) >= container.length)

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
      return true

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

    writeTree: (data) ->
      return if data is null
      assert Array.isArray data
      depth = 0
      for c in data
        if typeof c in ['string', 'number']
          depth++
          @descend c
        else if Array.isArray c
          @writeTree c
        else if typeof c is 'object'
          @write k, v for k, v of c
      @ascend() for [0...depth]

exports.writeCursor = (op) -> makeCursor(op).write()
exports.readCursor = (op) -> makeCursor(op).read()

exports.eachChildOf = (c1, c2, listMap1, listMap2, fn) ->
  hasChild1 = descended1 = c1?.descendFirst()
  hasChild2 = descended2 = c2?.descendFirst()

  while hasChild1 || hasChild2
    k1 = if hasChild1 then c1.getKey() else null
    k2 = if hasChild2 then c2.getKey() else null

    k1 = listMap1 k1 if listMap1 && typeof k1 is 'number'
    k2 = listMap2 k2 if listMap2 && typeof k2 is 'number'

    # console.log 'k1k2', k1, k2

    if k1 != null and k2 != null
      if isGreaterKey k2, k1
        k2 = null
      else if k1 != k2
        k1 = null

    # fn key, c1 or null, c2 or null
    fn (if k1 == null then k2 else k1), (c1 if k1 != null), (c2 if k2 != null)
    hasChild1 = c1.nextSibling() if k1 != null and hasChild1
    hasChild2 = c2.nextSibling() if k2 != null and hasChild2

  c1.ascend() if descended1
  c2.ascend() if descended2

# Only for listy children. Returns null or [keys, components] for numeric key &
# non-null component pairs.
exports.getKCList = (cursor) ->
  return null if !cursor? or !cursor.descendFirst()

  keys = null
  components = null

  loop
    key = cursor.getKey()
    if typeof key is 'number' and (c = cursor.getComponent())
      if keys is null
        keys = []
        components = []
      keys.push key
      components.push c
    break unless cursor.nextSibling()
  cursor.ascend()

  return if keys is null then null else {keys, components}
