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
forward = exports.forward = (kcList, pickSide, defaultDropSide) ->
  assert pickSide in [0, 1]

  return identity if kcList is null
  {keys, components} = kcList # For the other op.

  pickKeyPos = dropKeyPos = 0
  pickOffset = dropOffset = 0

  lastSrc = -1 # for debugging

  (src, dropSide) ->
    dropSide = defaultDropSide if typeof dropSide != 'number'
    assert dropSide in [0, 1]
    assert src >= lastSrc
    lastSrc = src

    while pickKeyPos < keys.length and
          (keys[pickKeyPos] < src || (keys[pickKeyPos] == src && pickSide == RIGHT))
      pickOffset++ if hasPick components[pickKeyPos]
      pickKeyPos++

    src2 = src - pickOffset
    #while dropKeyPos < keys.length and (k = keys[dropKeyPos]) < src2 + dropOffset
    while dropKeyPos < keys.length
      k = keys[dropKeyPos]
      break if dropSide is LEFT and k >= src2 + dropOffset
      break if dropSide is RIGHT and k > src2 + dropOffset

      dropOffset++ if hasDrop components[dropKeyPos]
      dropKeyPos++

    log 'forward', kcList, src, src2, src2+dropOffset
    return src2 + dropOffset


# This function does an inverse map of list drop positions to figure out what
# the index is in the original document.
#
# So, if you have an op which does 10:pick, 20:drop it'll map the index 20 ->
# 21 because thats where the drop would have been if the pick didn't happen.
reverse = (kcList) ->
  pickKeyPos = dropKeyPos = 0
  pickOffset = dropOffset = 0

  prevDestIdx = -1 # for debugging

  cursor = {raw:0, offset:0, dropHere:false}

  # Ugh this cursor thing.
  if kcList is null then return (i) ->
    cursor.raw = i
    return cursor

  {keys, components} = kcList

  (destIdx) ->
    assert destIdx >= prevDestIdx
    prevDestIdx = destIdx

    while dropKeyPos < keys.length and keys[dropKeyPos] < destIdx
      dropOffset++ if hasDrop components[dropKeyPos]
      dropKeyPos++

    cursor.dropHere = dropKeyPos < keys.length and
      keys[dropKeyPos] == destIdx and hasDrop components[dropKeyPos]

    d2 = destIdx - dropOffset
    assert d2 >= 0

    while pickKeyPos < keys.length and (k = keys[pickKeyPos]) - pickOffset <= d2
      break if k - pickOffset == d2 and hasDrop components[pickKeyPos]
      pickOffset++ if hasPick components[pickKeyPos]
      pickKeyPos++

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
exports.xfDrop = (opKC, otherKC, side) ->
  return identity unless otherKC

  toRaw = reverse opKC
  rawToOther = forward otherKC, LEFT
  # cursor = {otherIdx:0, finalIdx:0}

  (opIdx) ->
    {raw:rawIdx, offset, dropHere} = toRaw opIdx
    otherIdx = rawToOther rawIdx, (if dropHere then side else RIGHT)

    # console.log "#{side} #{opIdx} -> #{rawIdx} do: #{offset} -> #{otherIdx} (#{otherIdx + offset})" if type.debug

    # cursor.otherIdx = if iHaveDrop then null else otherIdx
    # cursor.finalIdx = otherIdx + offset
    # console.log cursor if type.debug

    otherIdx + offset
