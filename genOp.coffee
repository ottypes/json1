{randomInt, randomReal, randomWord} = require './node_modules/ot-fuzzer/lib/index.coffee'
# require 'ot-fuzzer'

assert = require 'assert'
{writeCursor} = require './lib/cursor'
log = require './lib/log'
log.quiet = false
type = require './lib/json1'


# This is an awful function to clone a document snapshot for use by the random
# op generator. .. Since we don't want to corrupt the original object with
# the changes the op generator will make.
clone = (o) -> JSON.parse(JSON.stringify(o))

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

# Generate a random new key for a value in obj.
randomNewKey = (obj) ->
  if Array.isArray obj
    return randomInt obj.length + 1
  else
    loop
      key = randomWord()
      break if obj[key] == undefined
    return key

# Generate a random object
randomThing = ->
  switch randomInt 6
    when 0 then null
    when 1 then ''
    when 2 then randomWord()
    when 3
      obj = {}
      obj[randomNewKey(obj)] = randomThing() for [1..randomInt(2)]
      obj
    when 4 then (randomThing() for [1..randomInt(2)])
    when 5 then randomInt(50)

# Pick a random path to something in the object.
randomPath = (data) ->
  return [] if data is null or typeof data != 'object'

  path = []
  while randomReal() < 0.9 and data != null and typeof data == 'object'
    key = randomKey data
    break unless key?

    path.push key
    data = data[key]

  path

randomWalkPick = (w, container) ->
  path = randomPath container.data
  parent = container
  key = 'data'

  for p in path
    parent = parent[key]
    key = p
    w.descend key
  operand = parent[key]
  return [path, parent, key, operand]

randomWalkDrop = (w, container) ->
  if container.data == null
    return [[], container, 'data']
  else if typeof container.data != 'object'
    return null # Can't insert into a document that is a string

  [path, parent, key, operand] = randomWalkPick w, container
  # log 'pp', path, parent
  if operand != null and typeof operand == 'object'
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

module.exports = genRandomOp = (data) ->
  log.quiet = false
  log 'genRandomOp', data

  container = data: clone data
  w = writeCursor()

  # Remove something

  # Things we can do:
  # - remove something
  # - move something
  # - insert something
  # - edit a string
  mode = randomInt 4
  # mode = 2
  # log 'mode', mode
  switch mode
    when 0, 1
      [path, parent, key, operand] = randomWalkPick w, container
      if mode is 1 and typeof operand is 'string'
        # Edit it!
        genString = require 'ot-text/test/genOp'
        [stringOp, result] = genString operand
        w.write 'es', stringOp
        parent[key] = result
      else
        # Remove it
        if operand != null
          w.write 'r', true #operand
          set parent, key, undefined
          container.data = null if parent == container

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
      set parent1, key1, undefined # remove it from the result...
      container.data = null if parent1 == container

      if parent1 == container # We're removing the whole thing.
        w.write 'r', true unless operand is null
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

  log '-> generated', op, doc

  type.checkValidOp op

  assert.deepEqual doc, type.apply clone(data), op

  return [op, doc]


if require.main == module
  type.debug = true
  log.quiet = false
  # log genRandomOp {}
  log genRandomOp({x:5, y:7, z:[1,2,3]}) for [1..10]
  # log genRandomOp({x:"hi", y:'omg', z:[1,'whoa',3]}) for [1..10]
