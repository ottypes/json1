# This iteration fixed original op drop location transformation. We now have 5
# marching integers (!!) to figure out how to transform the operation.

util = require 'util'

C = (type, value) -> {t:type, v:value}

# This function takes a sparse list object (l:{1:..., 5:...} and returns a
# sorted list of the keys [1,5,...]
sortedKeys = (list) -> (+x for x of list).sort (a, b) -> a - b


# This function returns a function which maps a list position through an
# operation. keys is the l: property of the other op, and list must be
# sortedKeys(keys).
#
# The returned function is called with an index. The passed index must be >=
# any previously passed index.
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


# This function does an inverse map of list drop positions via the pick list.
# So, if you have an op which does 10:pick, 20:drop it'll map the index 20 ->
# 21 because thats where the drop would have been if the pick didn't happen.
xfListReversePick = (keys, list) ->
  keyPos = 0
  offset = 0

  (destIdx) ->
    while keyPos < keys.length and (k = keys[keyPos]) <= destIdx + offset
      keyPos++
      offset++ if list[k].p

    return offset


listWalk = (op, other) ->
  list = op.l
  opK = sortedKeys list
  otherK = sortedKeys other.l

  otherMap = xfMap otherK, other.l
  revPickMap = xfListReversePick opK, list

  pickIdx = dropIdx = 0

  # We're going to walk through all lists at once. There's 4 of them:
  # op pick list, op drop list
  # other pick list, other drop list
  #
  # [other pick->other drop] is wrapped by otherMap.
  # op pick goes through otherMap
  # op drop goes backwards through op pick list, then through otherMap then
  # through pick list again.
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




listWalk op1, op2

return

