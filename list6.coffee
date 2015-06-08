assert = require 'assert'

LEFT = 0
RIGHT = 1


# This function takes a sparse list object (l:{1:..., 5:...} and returns a
# sorted list of the keys [1,5,...]
sortedKeys = (list) -> if list then (+x for x of list).sort (a, b) -> a - b else []


# This function does an inverse map of list drop positions via the pick list.
# So, if you have an op which does 10:pick, 20:drop it'll map the index 20 ->
# 21 because thats where the drop would have been if the pick didn't happen.
xfListReverse = (keys, list) ->
  pickKeyPos = dropKeyPos = 0
  pickOffset = dropOffset = 0

  (destIdx) ->
    while dropKeyPos < keys.length and (k = keys[dropKeyPos]) < destIdx
      dropKeyPos++
      dropOffset++ if list[k].d? or (list[k].di != undefined)

    d2 = destIdx - dropOffset

    while pickKeyPos < keys.length and (k = keys[pickKeyPos]) - pickOffset < d2
      pickKeyPos++
      pickOffset++ if list[k].p != undefined

    #return pickOffset - dropOffset
    return {raw:d2 + pickOffset, o:dropOffset}

xfMap = (keys, list, dropSide) ->
  pickKeyPos = dropKeyPos = 0
  pickOffset = dropOffset = 0

  (src) ->
    while pickKeyPos < keys.length and ((k = keys[pickKeyPos]) < src)
      pickKeyPos++
      pickOffset++ if list[k].p != undefined

    src2 = src - pickOffset
    #while dropKeyPos < keys.length and (k = keys[dropKeyPos]) < src2 + dropOffset
    while dropKeyPos < keys.length
      k = keys[dropKeyPos]
      break if dropSide is LEFT and k >= src2 + dropOffset
      break if dropSide is RIGHT and k > src2 + dropOffset

      dropKeyPos++
      dropOffset++ if list[k].d? or (list[k].di != undefined)

    return {idx:src2 + dropOffset, dropOffset, pickOffset}
    #return {pickOffset, dropOffset}



for [1..100000]
  list = {}
  for i in [1...5]
    if Math.random() < 0.3
      list[i] ?= {}
      list[i].p = null
    if Math.random() < 0.3
      list[i] ?= {}
      list[i].di = "#{i}"

  #list = { '1': { p: null, di: '1' }, '3': { p: null }, '4': { p: null } }
  #list = { '1': { di: '1' }, '3': { di: '3' }, '4': { p: null } }

  keys = sortedKeys list
  toRaw = xfListReverse keys, list
  toFinal = xfMap keys, list, RIGHT

  #console.log list

  for i in keys
    {raw, o} = toRaw i
    {idx, dropOffset, pickOffset} = toFinal raw
    #console.log "i #{i}, raw #{raw}, drop offset #{o}, final #{idx} (#{idx+o})"

    assert.equal idx - dropOffset + o, i


return


expando = (opKeys, opList, otherKeys, otherList, side) ->
  # Ok, we're transforming list positions in opList by otherList. Any drops in
  # the list have to be transformed back by the list's picks first.

  revPick = xfListReverse opKeys, opList
  otherMap = xfMap otherKeys, otherList, side

  # Take in a drop index.
  (src) ->
    {raw, o:myDrop} = revPick src
    #destIdx = otherMap raw
    #{pickOffset, dropOffset} = otherMap raw
    {idx:destIdx, pickOffset} = otherMap raw

    {e:destIdx + myDrop + pickOffset, idx:destIdx + myDrop}



# This is a sandbox for playing with list iteration
drop = (dest, op, other) ->
  
  # **** List children
  if other?.l || op?.l
    opList = op?.l
    otherList = other?.l

    console.log 'fancy list splice in drop', opList, otherList

    opKeys = sortedKeys opList
    otherKeys = sortedKeys otherList

    # Expando point = what the resultant index would be in this op transformed
    # by the other op, if the op didn't have any pickups.

    



op2 =
  0: {di:"aaa"}
  #1: {di:"bbb"}

op1 =
  0: {p:null, di:'bbb'}
  1: {di:'ccc'}

###
op2 =
  1: {p:null, op2:1}
  2: {p:null, op2:2}
  5: {e:'b', op2:5}
###

side = LEFT
eOp = expando sortedKeys(op1), op1, sortedKeys(op2), op2, side
eOther = expando sortedKeys(op2), op2, sortedKeys(op1), op1, 1-side

k1 = sortedKeys op1
k2 = sortedKeys op2

i1 = i2 = 0
while (a = i1 < k1.length; b = i2 < k2.length; a || b)
  console.log i1, i2, a, b

  if a && !b
    console.log 'descend', eOp(k1[i1]).idx, k1[i1], op1[k1[i1]]
    i1++
  else if b && !a
    console.log 'descend', eOther(k2[i2]).idx, k2[i2], op2[k2[i2]]
    i2++
  else
    e1 = eOp k1[i1]
    e2 = eOther k2[i2]
    console.log 'expando', k1[i1], e1, k2[i2], e2

    c1 = c2 = null
    if e1.e <= e2.e
      idx = e1.idx
      c1 = op1[k1[i1]]
      i1++

    if e1.e >= e2.e
      idx = e2.idx
      c2 = op2[k2[i2]]
      i2++

    console.log 'descend2', idx, c1, c2





#for i in [0..5]
#  console.log "#{i}:", e i

#drop null, op1, op2



