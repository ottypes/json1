assert = require 'assert'
type = require './xf'

{transform} = type

# Transform tests

describe 'json1', ->
  describe 'transform', ->
    xf = ({op1, op2, expect, expectLeft, expectRight, debug}) ->
      if expect then expectLeft = expectRight = expect

      transform.debug = debug

      left = transform op1, op2, 'left'
      assert.deepEqual left, expectLeft
      right = transform op1, op2, 'right'
      assert.deepEqual left, expectRight

    it 'can do a simple reparent', -> xf
      op1: {o:{x:{e:'edit'}}}
      op2: {o:{x:{p:0}, y:{d:0}}}
      expect: {o:{y:{e:'edit'}}}

    it 'can reparent with some extra junk', -> xf
      op1: {o:{x:{p:0}, y:{d:0}}}
      op2:
        o:
          x:
            p:0
            o:
              a: {p:1}
          _x: {d:0}
          _a: {d:1}

      expect: {o:{_x:{p:0}, y:{d:0}}}

    it 'can move the source of a pickup', -> xf
      op1:
        o:
          x:
            p:0
            o:
              a: {p:1}
          _x: {d:0}
          _a: {d:1}
      op2: {o:{x:{p:0}, y:{d:0}}}

      expect:
        o:
          y:
            p:0
            o:
              a: {p:1}
          _x: {d:0}
          _a: {d:1}


    describe 'swap', ->
      swap =
        o:
          a: {p:0, o:{b:{p:1}}}
          b: {d:1, o:{a:{d:0}}}

      it 'noop vs swap', -> xf
        op1: {}
        op2: swap
        expect: {}

      it 'can swap two edits', -> xf
        op1: {o:{a:{e:'a edit', o:{b:{e:'b edit'}}}}}
        op2: swap
        expect: {o:{b:{e:'b edit', o:{a:{e:'a edit'}}}}}


    describe.skip 'lists', ->

      it 'can do a simple list operation', -> xf
        op2: {l:{0:{di:'oh hi'}}}
        op1: {l:{10:{e:'edit'}}}
        expect: {l:{11:{e:'edit'}}}
        debug: true

      it.skip 'can change the root from an object to a list', -> xf
        op1: {o:{a:{e:'edit'}}}
        op2: {o:{a:{p:0}}, di:[], l:{0:{d:0}}}
        expect: {l:{0:{e:'edit'}}}


