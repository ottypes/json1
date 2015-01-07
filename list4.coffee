# This iteration fixed original op drop location transformation. We now have 5
# marching integers (!!) to figure out how to transform the operation.

util = require 'util'

C = (type, value) -> {t:type, v:value}

sortedKeys = (list) -> (+x for x of list).sort (a, b) -> a - b

xfMap = (keys, list) ->
  pickKeyPos = dropKeyPos = 0
  pickOffset = dropOffset = 0

  (src) ->
    while pickKeyPos < keys.length and (k = keys[pickKeyPos]) <= src
      pickKeyPos++
      if list[k].p
        if src == k
          console.log 'TODO - requested item was picked up by other op.'
        pickOffset--

    src2 = src + pickOffset
    while dropKeyPos < keys.length and (k = keys[dropKeyPos]) <= src2 + dropOffset
      dropKeyPos++
      dropOffset++ if list[k].d

    return src2 + dropOffset


xfListReversePick = (keys, list) ->
  keyPos = 0
  offset = 0

  (destIdx) ->
    while keyPos < keys.length and (k = keys[keyPos]) <= destIdx + offset
      keyPos++
      offset++ if list[k].p

    return offset


triWalk = (op, other) ->
  list = op.l
  opK = sortedKeys list
  otherK = sortedKeys other.l

  otherMap = xfMap otherK, other.l
  revPickMap = xfListReversePick opK, list

  pickIdx = dropIdx = 0

  
  loop
    pickIdx++ while pickIdx < opK.length and !list[opK[pickIdx]].p
    dropIdx++ while dropIdx < opK.length and !list[opK[dropIdx]].d
    break unless pickIdx < opK.length || dropIdx < opK.length

    #console.log 'p,d', pickIdx, dropIdx

    if dropIdx >= opK.length || (pickSrc = opK[pickIdx]) < (dropOffset = revPickMap(opK[dropIdx]); dropSrc = opK[dropIdx] + dropOffset)
      #console.log 'pickIdx'

      dest = otherMap pickSrc
      console.log "pick #{dest}: #{JSON.stringify list[pickSrc].p}"

      pickIdx++
    else
      #console.log 'dropIdx'

      dest = otherMap dropSrc
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

