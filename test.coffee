assert = require 'assert'
type = require './json1'

{transform} = type

# Transform tests

printRepro = (op1, op2, direction, expect) ->
  console.error 'Repro with:'
  console.log "transform #{JSON.stringify(op1)}, #{JSON.stringify(op2)}, '#{direction}'"



describe 'json1', ->
  describe 'apply', ->
    apply = ({doc:snapshot, op, expected}) ->
      snapshot = type.apply snapshot, op
      assert.deepEqual snapshot, expected

    it 'Can set properties', ->
      apply
        doc: null
        op: {di:5}
        expected: 5
        
      apply
        doc: []
        op: {l:1:{di:17}}
        expected: [17]

      apply
        doc: {}
        op: {o:{x:{di:5}}}
        expected: {x:5}

    it 'can move', ->
      apply
        doc: {x:5}
        op: {o:{x:{p:0}, y:{d:0}}}
        expected: {y:5}

      apply
        doc: [0,1,2]
        op: {l:{1:{p:0}, 2:{d:0}}}
        expected: [0,2,1]
        

  describe 'transform', ->
    xf = ({op1, op2, expect, expectLeft, expectRight, debug}) ->
      if expect != undefined then expectLeft = expectRight = expect

      transform.debug = debug

      try
        #printRepro op1, op2, 'left', expectLeft
        left = transform op1, op2, 'left'
        assert.deepEqual left, expectLeft
      catch e
        transform.debug = true
        printRepro op1, op2, 'left', expectLeft
        transform op1, op2, 'left'
        throw e

      try
        #printRepro op1, op2, 'right', expectRight
        right = transform op1, op2, 'right'
        assert.deepEqual right, expectRight
      catch e
        transform.debug = true
        printRepro op1, op2, 'right', expectRight
        transform op1, op2, 'right'
        throw e

    it 'foo', ->
      xf
        op1: o:
          x:{o:{a:{p:0}, b:{d:0}}}
          y:{o:{a:{p:1}, b:{d:1}}}
        op2: {o:{x:{p:null}}}
        expect: o:
          y:{o:{a:{p:0}, b:{d:0}}}

    it 'delete the source of a move', -> xf
      op1: {o:{x:{p:0}, y:{d:0}}}
      op2: {o:{x:{p:null}}}
      expect: null


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

      it 'move vs delete', -> xf
        op1: {o:{y:{o:{a:{p:1}, b:{d:1}}}}}
        op2: {o:{y:{p:null}}}
        expect: null

      it 'delete parent of a move', -> xf
        # obj.a = obj.x.a; delete obj.y;
        op1: {o:{x:{p:null, o:{a:{p:1}}}, a:{d:1}}}
        op2: {o:{x:{o:{a:{p:0}, b:{d:0}}}}}
        expect: {o:{x:{p:null, o:{b:{p:0}}}, a:{d:0}}}

      it.skip 'deletes follow an escapee', -> xf
        op2: {o:{x:{o:{a:{p:1}}}, a:{d:1}}}
        op1: {o:{x:{p:null}}}
        expect: {o:{x:{p:null}, a:{p:null}}}

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

      it 'list drop vs delete and drop', ->
        xf
          op2: {l:{2:{p:null, di:'other'}}}
          op1: {l:{2:{di:'hi'}}}
          expectLeft: {l:{2:{di:'hi'}}}
          expectRight: {l:{3:{di:'hi'}}}

        xf
          op2: {l:{2:{p:null}, 3:{di:'other'}}}
          op1: {l:{3:{di:'hi'}}}
          expect: {l:{2:{di:'hi'}}}

        xf
          op2: {l:{2:{p:null}, 3:{di:'other'}}}
          op1: {l:{4:{di:'hi'}}}
          expectLeft: {l:{3:{di:'hi'}}}
          expectRight: {l:{4:{di:'hi'}}}

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

      it 'insert vs delete parent', -> xf
        op2: {l:{2:{p:null}}} # Shouldn't effect the op.
        op1: {l:{2:{o:{x:{di:"hi"}}}}}
        expect: null


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
