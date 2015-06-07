assert = require 'assert'
type = require './json1'

{transform} = type

# Transform tests

describe 'json1', ->
  describe 'transform', ->
    xf = ({op1, op2, expect, expectLeft, expectRight, debug}) ->
      if expect != undefined then expectLeft = expectRight = expect

      transform.debug = debug

      try
        left = transform op1, op2, 'left'
        assert.deepEqual left, expectLeft
      catch e
        transform.debug = true
        transform op1, op2, 'left'
        throw e

      try
        right = transform op1, op2, 'right'
        assert.deepEqual right, expectRight
      catch e
        transform.debug = true
        #transform op1, op2, 'right'
        throw e

    it 'foo', ->
      xf
        op1: o:
          #x:{o:{a:{p:0}, b:{d:0}}}
          y:{o:{a:{p:1}, b:{d:1}}}
        op2: {o:{y:{p:null}}}
        expect: null
        #expect: o:
        #  x:{o:{a:{p:0}, b:{d:0}}}

    describe 'object edits', ->
      it 'can move an edit', -> xf
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

      it 'obeys symmetry', -> xf
        op1: {o:{x:{di:"one"}}}
        op2: {o:{x:{di:"two"}}}
        expectLeft: {o:{x:{di:"one"}}}
        expectRight: null

      it 'delete vs delete', -> xf
        op2: {o:{a:{p:null}}}
        op1: {o:{a:{p:null}}}
        expect: null # It was already deleted.

    describe 'swap', ->
      swap =
        o:
          a: {p:0, o:{b:{p:1}}}
          b: {d:1, o:{a:{d:0}}}

      it 'noop vs swap', -> xf
        op1: null
        op2: swap
        expect: null

      it 'can swap two edits', -> xf
        op1: {o:{a:{e:'a edit', o:{b:{e:'b edit'}}}}}
        op2: swap
        expect: {o:{b:{e:'b edit', o:{a:{e:'a edit'}}}}}


    describe 'lists', ->

      it 'can rewrite simple list indexes', -> xf
        op2: {l:{0:{di:'oh hi'}}}
        op1: {l:{10:{e:'edit'}}}
        expect: {l:{11:{e:'edit'}}}

      it 'can change the root from an object to a list', -> xf
        op1: {o:{a:{e:'edit'}}}
        op2: {o:{a:{p:0}}, di:[], l:{0:{d:0}}}
        expect: {l:{0:{e:'edit'}}}

      it 'can handle adjacent drops', -> xf
        op1: {l:{11:{di:1}, 12:{di:2}, 13:{di:3}}}
        op2: {l:{0:{p:null}}}
        expect: {l:{10:{di:1}, 11:{di:2}, 12:{di:3}}}

      it 'fixes drop indexes correctly 1', -> xf
        op2: {l:{1:{p:null}}}
        op1: l:
          0: p:null
          1: di:'hi'
        expect: l:
          0: {p:null, di:'hi'}

      it 'list drop vs delete uses the correct result index', ->
        xf
          op2: {l:{2:{p:null}}}
          op1: {l:{2:{di:'hi'}}}
          expect: {l:{2:{di:'hi'}}}
        xf
          op2: {l:{2:{p:null}}}
          op1: {l:{3:{di:'hi'}}}
          expect: {l:{2:{di:'hi'}}}

      it 'list drop vs drop uses the correct result index', -> xf
        op2: {l:{2:{di:'other'}}}
        op1: {l:{2:{di:'hi'}}}
        expectLeft: {l:{2:{di:'hi'}}}
        expectRight: {l:{3:{di:'hi'}}}

      it 'list delete vs drop', ->
        xf
          op2: {l:{2:{di:'hi'}}}
          op1: {l:{1:{p:null}}}
          expect: {l:{1:{p:null}}}

        xf
          op2: {l:{2:{di:'hi'}}}
          op1: {l:{2:{p:null}}}
          expect: {l:{3:{p:null}}}

        xf
          op2: {l:{2:{di:'hi'}}}
          op1: {l:{3:{p:null}}}
          expect: {l:{4:{p:null}}}

      it 'list delete vs delete', ->
        xf
          op2: {l:{1:{p:null}}}
          op1: {l:{1:{p:null}}}
          expect: null # It was already deleted.

      it 'fixes drop indexes correctly 2', -> xf
        op2: {l:{2:{p:null}}} # Shouldn't effect the op.
        op1: l:
          0: p:null
          1: di:'hi'
        expect: l:
          0: p:null
          1: di:'hi'


###
        op1:
          l:
            1: {p:1}
            2: {p:null}
            3:
              p: null
              d: 1
            4: {p:null}
        expect: {}

###
