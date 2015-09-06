
assert = require 'assert'
deepEqual = require './deepequal'

console.log deepEqual

describe 'deepEqual', ->
  y = (a, b) ->
    assert deepEqual a, b
    assert deepEqual b, a
  n = (a, b) ->
    assert !deepEqual a, b
    assert !deepEqual b, a

  describe 'primitives', ->
    it 'works for all the usual primitives', ->
      y null, null
      y false, false
      y true, true
      y 'hi', 'hi'
      y 10, 10

      n null, false
      n null, 0
      n null, ''

      n null, []
      n 'hi', []
      n 123, {}

      y [1,2,3], [1,2,3]
      y [], []
      y {}, {}
      n [], {}
      y {x:5}, {x:5}
      n {x:6}, {x:5}
      y {x:[]}, {x:[]}

    it 'regressions', ->
      n {}, null
