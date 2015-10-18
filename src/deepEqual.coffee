
eqObj = (a, b) ->
  return false if Array.isArray b
  for k, v of a
    return false unless deepEqual v, b[k]
  for k, v of b when a[k] == undefined
    return false
  return true

eqArr = (a, b) ->
  return false unless Array.isArray b
  return false unless a.length == b.length

  for v, i in a
    return false unless deepEqual v, b[i]

  return true

deepEqual = (a, b) ->
  # This will cover null, bools, string and number.
  return true if a == b
  return false if a == null or b == null
  return false unless typeof(a) == 'object' and typeof(b) == 'object'

  if Array.isArray a
    return eqArr a, b
  else
    return eqObj a, b

module.exports = deepEqual
