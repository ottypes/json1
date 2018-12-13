{randomInt, randomReal, randomWord} = require 'ot-fuzzer'
# require 'ot-fuzzer'

assert = require 'assert'
{writeCursor} = require '../lib/cursor'
log = require '../lib/log'
type = require '../lib/json1'


# This is an awful function to clone a document snapshot for use by the random
# op generator. .. Since we don't want to corrupt the original object with
# the changes the op generator will make.
clone = (o) -> if typeof o is 'object' then JSON.parse(JSON.stringify(o)) else o

randomKey = (obj) -> # this works on arrays too!
  if Array.isArray obj
    if obj.length is 0
      return undefined
    else
      return randomInt obj.length
  else
    keys = Object.keys obj
    if keys.length is 0
      return undefined
    else
      return keys[randomInt keys.length]

letters = 'abxyz'

# Generate a random new key for a value in obj.
randomNewKey = (obj) ->
  if Array.isArray obj
    return randomInt obj.length + 1
  else
    loop
      # Mostly try just use a small letter
      key = if randomInt(20) == 0 then randomWord() else letters[randomInt(letters.length)]
      break if obj[key] == undefined
    return key

# Generate a random object
randomThing = ->
  switch randomInt 7
    when 0 then null
    when 1 then ''
    when 2 then randomWord()
    when 3
      obj = {}
      obj[randomNewKey(obj)] = randomThing() for [1..randomInt(2)]
      obj
    when 4 then (randomThing() for [1..randomInt(2)])
    when 5 then 0 # bias toward zeros to find accidental truthy checks
    when 6 then randomInt(50)

# Pick a random path to something in the object.
randomPath = (data) ->
  return [] if !data? or typeof data != 'object'

  path = []
  while randomReal() < 0.9 and data? and typeof data == 'object'
    key = randomKey data
    break unless key?

    path.push key
    data = data[key]

  path

randomWalkPick = (w, container) ->
  path = randomPath container.data
  parent = container
  key = 'data'
  #log 'rwp', container, path, parent

  for p in path
    parent = parent[key]
    key = p
    w.descend key
  operand = parent[key]
  return [path, parent, key, operand]

# Returns [path, parent, key] if we can drop here, or null if no drop is
# possible
randomWalkDrop = (w, container) ->
  if container.data == undefined
    return [[], container, 'data']
  else if typeof container.data != 'object' or container.data == null
    return null # Can't insert into a document that is a string or number

  [path, parent, key, operand] = randomWalkPick w, container
  if typeof operand == 'object' and operand != null
    parent = operand
  else
    w.ascend()
    w.reset()
    path.pop()
  key = randomNewKey parent
  # log 'key', key
  return [path, parent, key]

set = (container, key, value) ->
  if value == undefined
    if Array.isArray container
      container.splice key, 1
    else
      delete container[key]
  else
    if Array.isArray container
      container.splice key, 0, value
    else
      container[key] = value

genRandomOpPart = (data) ->
  # log 'genRandomOp', data

  container = {data}
  w = writeCursor()

  # Remove something

  # Things we can do:
  # 0. remove something
  # 1. move something
  # 2. insert something
  # 3. edit a string
  mode = if data == undefined and randomReal() < 0.9 then 2 else randomInt 4
  #mode = 1
  #log 'mode', mode
  switch mode
    when 0, 1
      [path, parent, key, operand] = randomWalkPick w, container
      #log 'ppko', path, parent, key, operand
      if mode is 1 and typeof operand is 'string'
        # Edit it!
        genString = require 'ot-text/test/genOp'
        [stringOp, result] = genString operand
        w.write 'es', stringOp
        parent[key] = result
      else if mode is 1 and typeof operand is 'number'
        increment = randomInt 10
        w.write 'ena', increment
        parent[key] += increment
      else
        # Remove it
        if operand != undefined
          w.write 'r', true #operand
          set parent, key, undefined

    when 2
      # insert something
      walk = randomWalkDrop w, container
      if walk != null
        [path, parent, key] = walk
        #log 'walk', walk
        val = randomThing()
        w.descend key if parent != container
        w.write 'i', val
        set parent, key, clone val

    when 3
      # Move something. We'll pick up the current operand...
      [path1, parent1, key1, operand] = randomWalkPick w, container
      if operand != undefined
        set parent1, key1, undefined # remove it from the result...

        if parent1 == container # We're removing the whole thing.
          w.write 'r', true
        else
          w.write 'p', 0

          # ... and find another place to insert it!
          w.ascend() for [0...path1.length]
          w.reset()
          [path2, parent2, key2] = randomWalkDrop w, container
          w.descend key2
          set parent2, key2, operand
          w.write 'd', 0

  doc = container.data
  op = w.get()

  type.checkValidOp op

  # assert.deepEqual doc, type.apply clone(data), op

  return [op, doc]

module.exports = genRandomOp = (doc) ->
  doc = clone doc

  # 90% chance of adding an op the first time through, then 50% each successive time.
  chance = 0.99

  op = null # Aggregate op

  while randomReal() < chance
    [opc, doc] = genRandomOpPart(doc)
    log opc
    # type.setDebug false
    op = type.compose op, opc

    chance = 0.5

  # log.quiet = false
  log '-> generated op', op, 'doc', doc
  return [op, doc]

if require.main == module
  # log genRandomOp {}
  # log genRandomOp({x:5, y:7, z:[1,2,3]}) for [1..10]
  for [1..10]
    type.debug = true
    log.quiet = false
    log genRandomOp({x:"hi", y:'omg', z:[1,'whoa',3]})
    # log genRandomOp(undefined)
