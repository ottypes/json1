# First attempt at dealing with list vs list transform. Currently (I think)
# works properly for any other op cases. Does not deal with indexes changed as
# a result of internal changes in op1.

util = require 'util'

C = (type, value) -> {t:type, v:value}

sortedKeys = (list) -> (+x for x of list).sort (a, b) -> a - b

xfListMap = (keys, list, type) -> # type = 'pick' or 'drop'
  keyPos = 0

  offset = 0

  # Advance list map to some source position, and return the destination index
  # offset at the specified source index
  (x) ->
    # Drop operation indexes take into account the push from previous drops,
    # but picks don't.
    x += offset if type is 'drop'

    while keyPos < keys.length and (k = keys[keyPos]) <= x # < or <= ??
      keyPos++

      v = list[k]
      if type is 'pick' and v.p
        if x == k
          console.log 'TODO - requested item was picked up by other op.'

        offset--
      else if type is 'drop' and v.d
        offset++

    return offset


triWalk = (op, other) ->
  # So, the thing we need to do is walk through 3 things at the same time:
  # - The operation itself, and in doing so we find out the source of any
  # change (and put it in the right place)
  # - The pickups in the other op. Each one will decrement the dest index for
  # successive drops and destinations. The pickup index is 'raw' - it does not
  # affect subsequent pickups.
  # - The drops in the other op. Each one will increment the dest index for
  # successive destinations and drops.
  #
  # Its tempting to merge the pickup and drop iterator, but we can't because
  # their indexes need to move separately. (They move through the same list,
  # but they won't necessarily move together).

  opK = sortedKeys op.l
  otherK = sortedKeys other.l

  otherPickMap = xfListMap otherK, other.l, 'pick'
  otherDropMap = xfListMap otherK, other.l, 'drop'

  for k in opK
    offset = otherPickMap k
    console.log 'pk', offset

    offset += otherDropMap k+offset
    console.log 'dk', offset

    console.log "#{k+offset}: #{JSON.stringify op.l[k]}"






###
op2 =
  l:
    '0': {d:C('move', 0)}
    '5': {p:C('move', 0)}
###

op2 =
  l:
    '1': {p:C('move', 1)}
    '2': {p:C('move', 2)}
    '3': {p:C('move', 3)}
    '4': {p:C('move', 4)}


op1 =
  l:
    #'2': {p:C('del')}
    '5': {p:C('del')}


triWalk op1, op2

return

