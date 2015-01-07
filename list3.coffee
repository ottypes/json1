# This iteration fixed original op drop location transformation. We now have 5
# marching integers (!!) to figure out how to transform the operation.

util = require 'util'

C = (type, value) -> {t:type, v:value}

sortedKeys = (list) -> (+x for x of list).sort (a, b) -> a - b

# I'd love to generalize these three functions. I splayed them out to let my
# brain do its magic.
xfListMapPick = (keys, list) ->
  keyPos = 0
  offset = 0

  (srcIdx) ->
    while keyPos < keys.length and (k = keys[keyPos]) <= srcIdx
      keyPos++

      v = list[k]
      if v.p
        if srcIdx == k
          console.log 'TODO - requested item was picked up by other op.'

        offset--

    return srcIdx + offset

xfListMapDrop = (keys, list) ->
  keyPos = 0
  offset = 0

  (srcIdx) ->
    while keyPos < keys.length and (k = keys[keyPos]) <= srcIdx + offset
      keyPos++

      v = list[k]
      offset++ if v.d

    return srcIdx + offset

xfListReversePick = (keys, list) ->
  keyPos = 0
  offset = 0

  (destIdx) ->
    while keyPos < keys.length and (k = keys[keyPos]) <= destIdx + offset
      keyPos++

      v = list[k]
      offset++ if v.p

    return offset


triWalk = (op, other) ->
  list = op.l
  opK = sortedKeys list
  otherK = sortedKeys other.l

  otherPickMap = xfListMapPick otherK, other.l
  otherDropMap = xfListMapDrop otherK, other.l
  revPickMap = xfListReversePick opK, list

  pickIdx = dropIdx = 0

  
  loop
    pickIdx++ while pickIdx < opK.length and !list[opK[pickIdx]].p
    dropIdx++ while dropIdx < opK.length and !list[opK[dropIdx]].d
    break unless pickIdx < opK.length || dropIdx < opK.length

    #console.log 'p,d', pickIdx, dropIdx

    if dropIdx >= opK.length || opK[pickIdx] < (dropOffset = revPickMap(opK[dropIdx]); dropSrc = opK[dropIdx] + dropOffset)
      #console.log 'pickIdx'

      src = opK[pickIdx]
      dest = otherPickMap src
      dest = otherDropMap dest
      console.log "pick #{dest}: #{JSON.stringify list[src].p}"

      pickIdx++
    else
      #console.log 'dropIdx'

      dest = otherPickMap dropSrc
      dest = otherDropMap dest
      console.log "drop #{dest - dropOffset}: #{JSON.stringify list[opK[dropIdx]].d}"

      dropIdx++





###
op2 =
  l:
    '0': {d:C('move', 0)}
    '5': {p:C('move', 0)}
###

op2 =
  l:
    '5':
      p:C('del')


op1 =
  l:
    '1': {p:C('move', 1)}
    '2': {p:C('del')}
    '3':
      p: C('del')
      d: C('move', 1)
    '4': {p:C('del')}




triWalk op1, op2

return

