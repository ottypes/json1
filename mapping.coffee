C = (type, value) -> {t:type, v:value}


class Mapping
  constructor: (op) ->

  map: ->

#apply {x:5, y:[10,11,12]},
#  pick:[C('in', 'x'), C('pickup'), C('skip', 'y'), C('in', 1), C('pickup')]
#  drop:[C('in', 'a'), C('drop', 1), C('skip', 'z'), C('drop', 0)]


# Swap items
#apply {x:{y:5}},
#  pick: [C('in','x'), C('pickup'), C('in', 'y'), C('pickup')]
#  drop: [C('in','y'), C('drop',1), C('in', 'x'), C('drop',0)]


# Swap items
console.log {x:{y:{was:'y'}, was:'x'}}
apply {x:{y:{was:'y'}, was:'x'}, was:'root'},
  pick: [C('in','x'), C('pickup'), C('in', 'y'), C('pickup')]
  drop: [C('in','x'), C('drop',1), C('in', 'y'), C('drop',0)]
