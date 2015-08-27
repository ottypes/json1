# This file contains all the logic for modifying list positions in operations.

assert = require 'assert'

LEFT = 0
RIGHT = 1

hasPick = (op) -> op && (op.p? || op.r != undefined)
hasDrop = (op) -> op && (op.d? || op.i != undefined)

identity = (x) -> x

log = require './log'
log.quiet = true



# This function returns a function which maps list positions forward through an
# operation.
# kcList comes from calling cursor.getKCList on the other op read cursor.
#
# The returned function is called with an index. The passed index must be >=
# any previously passed index.
forward = exports.forward = (pickList = [], dropList = [], pickSide, defaultDropSide) ->
  assert pickSide in [0, 1]

  return identity if pickList.length == 0 and dropList.length == 0

  pickPos = dropPos = 0

  lastSrc = -1 # for debugging

  (src, dropSide) ->
    return src if typeof src is 'string'
    dropSide = defaultDropSide if typeof dropSide != 'number'
    assert dropSide in [0, 1]

    assert src >= lastSrc
    lastSrc = src

    while pickPos < pickList.length and
          (pickList[pickPos] < src || (pickSide == RIGHT and pickList[pickPos] == src))
      pickPos++

    src2 = src - pickPos
    #while dropKeyPos < keys.length and (k = keys[dropKeyPos]) < src2 + dropOffset
    while dropPos < dropList.length
      k = dropList[dropPos]
      break if dropSide is LEFT and k >= src2 + dropPos
      break if dropSide is RIGHT and k > src2 + dropPos
      dropPos++

    log 'forward', pickList, dropList, src, src2, src2+dropPos
    return src2 + dropPos


# This function does an inverse map of list drop positions to figure out what
# the index is in the original document.
#
# So, if you have an op which does 10:pick, 20:drop it'll map the index 20 ->
# 21 because thats where the drop would have been if the pick didn't happen.
reverse = exports.reverse = (pickList = [], dropList = []) ->
  pickOffset = dropOffset = 0

  prevDestIdx = -1 # for debugging

  cursor = {raw:0, offset:0, dropHere:false}

  # Ugh this cursor thing.
  if pickList.length == 0 and dropList.length == 0 then return (i) ->
    cursor.raw = i
    return cursor

  (destIdx) ->
    return destIdx if typeof destIdx is 'string'

    assert destIdx >= prevDestIdx
    prevDestIdx = destIdx

    while dropOffset < dropList.length and dropList[dropOffset] < destIdx
      dropOffset++ #if hasDrop components[dropKeyPos]

    cursor.dropHere = dropOffset < dropList.length and
      dropList[dropOffset] == destIdx #and hasDrop components[dropKeyPos]

    d2 = destIdx - dropOffset
    assert d2 >= 0

    while pickOffset < pickList.length and (k = pickList[pickOffset]) - pickOffset <= d2
      break if k - pickOffset == d2 and cursor.dropHere
      pickOffset++ #if hasPick components[pickKeyPos]

    #return pickOffset - dropOffset
    #return {raw:d2 + pickOffset, o:dropOffset}
    cursor.raw = d2 + pickOffset
    cursor.offset = dropOffset - pickOffset

    #console.log "#{destIdx} do #{dropOffset} po #{pickOffset} final #{cursor.raw}"
    return cursor


# This function calls uses xfListReverse and xfMap to translate drop positions
# in the current op to calculate:
# - The corresponding drop position in the other op
# - The final index
exports.xfDrop = (pickList1, dropList1, pickList2, dropList2, side) ->
  return identity unless pickList2.length || dropList2.length

  toRaw = reverse pickList1, dropList1
  rawToOther = forward pickList2, dropList2, LEFT
  # cursor = {otherIdx:0, finalIdx:0}

  (opIdx) ->
    {raw:rawIdx, offset, dropHere} = toRaw opIdx
    otherIdx = rawToOther rawIdx, (if dropHere then side else RIGHT)

    # console.log "#{side} #{opIdx} -> #{rawIdx} do: #{offset} -> #{otherIdx} (#{otherIdx + offset})" if type.debug

    # cursor.otherIdx = if iHaveDrop then null else otherIdx
    # cursor.finalIdx = otherIdx + offset
    # console.log cursor if type.debug

    otherIdx + offset
