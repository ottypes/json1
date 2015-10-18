assert = require 'assert'
type = require './objdescent'

{transform} = type

# Transform tests

printRepro = (op1, op2, direction, expect) ->
  console.error 'FAIL! Repro with:'
  console.log "transform #{JSON.stringify(op1)}, #{JSON.stringify(op2)}, '#{direction}'"



describe 'json1', ->
  describe 'checkOp', ->
    pass = (op) -> type.checkValidOp op
    fail = (op) -> assert.throws -> type.checkValidOp op

    it 'allows some simple valid ops', ->
      pass null
      pass {e:"hi"}
      pass {di:[1,2,3]}
      pass {p:null}
      pass {o:{x:{p:0}, y:{d:0}}}
      pass {l:{0:{p:0}, 10:{d:0}}}
      pass {o:{x:{p:0}, y:{d:0}, a:{p:1}, b:{d:1}}}

    it 'throws if there is any empty leaves', ->
      fail {}
      fail {o:{}}
      fail {o:{x:{}}}
      fail {l:{}}
      fail {l:{0:{}}}

    it 'throws if there are mismatched pickups / drops', ->
      fail {p:0}
      fail {d:0}
      fail {o:x:p:0}
      fail {l:10:p:0}
      fail {o:x:d:0}
      fail {l:10:d:0}

    it 'throws if pick/drop indexes dont start at 0', ->
      fail {o:{x:{p:1}, y:{d:1}}}
      fail {l:{0:{p:1}, 10:{d:1}}}

    it.skip 'does not allow ops to overwrite their own di data', ->
      fail {di:{x:5}, o:{x:{di:6}}}
      fail {di:["hi"], l:{0:{di:"omg"}}}

    it.skip 'does not allow immediate data directly parented in other immediate data', ->
      fail {di:{}, o:{x:{di:5}}}
      fail {di:[], l:{0:{di:5}}}


# ****** Apply ******

  describe 'apply', ->
    apply = ({doc:snapshot, op, expect}) ->
      snapshot = type.apply snapshot, op
      assert.deepEqual snapshot, expect

    it 'Can set properties', ->
      apply
        doc: null
        op: {di:5}
        expect: 5

      apply
        doc: []
        op: {l:0:{di:17}}
        expect: [17]

      apply
        doc: {}
        op: {o:{x:{di:5}}}
        expect: {x:5}

    it 'can move', ->
      apply
        doc: {x:5}
        op: {o:{x:{p:0}, y:{d:0}}}
        expect: {y:5}

      apply
        doc: [0,1,2]
        op: {l:{1:{p:0}, 2:{d:0}}}
        expect: [0,2,1]

    describe 'complex list index stuff', ->
      it 'sdaf', ->
        apply
          doc: [0,1,2,3,4,5]
          op: {l:{1:{p:null, di:11}, 2:{p:null, di:12}}}
          expect: [0,11,12,3,4,5]


# ******* Compose *******

  describe.skip 'compose', ->
    compose = ({op1, op2, expect}) ->
      result = type.compose op1, op2
      assert.deepEqual result, expect


    it 'composes empty ops to nothing', ->
      compose
        op1: null
        op2: null
        expect: null

    it 'composes null and another op to that other op', ->
      t = (op) ->
        compose {op1:op, op2:null, expect:op}
        compose {op1:null, op2:op, expect:op}

      t {o:{x:{p:0}, y:{d:0}}}
      t {l:{1:{p:0}, 2:{d:0}}}

    it 'gloms together unrelated edits', ->
      compose
        op1: {o:{x:{p:0}, y:{d:0}}}
        op2: {o:{a:{p:0}, b:{d:0}}}
        expect: {o:{x:{p:0}, y:{d:0}, a:{p:1}, b:{d:1}}}

      compose
        op1: {l:{2:{di:"hi"}}}
        op2: {l:{0:{o:{x:{p:null}}}}}
        expect: {l:{0:{o:{x:{p:null}}},2:{di:"hi"}}}

    it 'matches op1.dest -> op2.source', ->
      compose
        op1: {o:{x:{p:0}, y:{d:0}}}
        op2: {o:{y:{p:0}, z:{d:0}}}
        expect: {o:{x:{p:0}, z:{d:0}}}

    it 'translates drops in objects', ->
      compose
        op1: {o:{x:{o:{a:{p:0}, b:{d:0}}}}} # x.a -> x.b
        op2: {o:{x:{p:0}, y:{d:0}}} # x -> y
        expect: {o:{x:{p:0,o:{a:{p:1}}}, y:{d:0,o:{b:{d:1}}}}} # x.a -> y.b, x -> y

    it 'untranslates picks in objects', ->
      compose
        op1: {o:{x:{p:0}, y:{d:0}}} # x -> y
        op2: {o:{y:{o:{a:{p:0}}}, z:{d:0}}} # y.a -> z
        expect: {o:{x:{p:0, o:{a:{p:1}}}, y:{d:0}, z:{d:1}}} # x.a -> z, x -> y

    it 'di gets carried wholesale', ->
      compose
        op1: {o:{x:{di:"hi there"}}}
        op2: {o:{x:{p:0}, y:{d:0}}} # x -> y
        expect: {o:{y:{di:"hi there"}}}

    it 'di gets edited by the op', ->
      compose
        op1: {o:{x:{di:{a:1, b:2, c:3}}}}
        op2: {o:{x:{o:{a:{p:0}}}, y:{d:0}}}
        expect: {o:{x:{di:{b:2, c:3}}, y:{di:1}}}

    it 'merges mutual dis', ->
      compose
        op1: {di:{}}
        op2: {o:{x:{di:"hi"}}}
        expect: {di:{x:"hi"}}

    # TODO: List nonsense.

    # TODO: Edits.


# ****** Transform ******

  describe 'transform', ->
    xf = ({op1, op2, expect, expectLeft, expectRight, debug}) ->
      if expect != undefined then expectLeft = expectRight = expect

      type.debug = !!debug

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

      it.skip 'can move an insert', -> xf
        op1: {o:{x:{di:'hi'}}}
        op2: {o:{x:{p:0}, y:{d:0}}}
        expect: {o:{y:{di:'hi'}}}

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
        op1: {o:{y:{o:{a:{p:0}, b:{d:0}}}}}
        op2: {o:{y:{p:null}}}
        expect: null

      it 'delete parent of a move', -> xf
        # obj.a = obj.x.a; delete obj.y;
        op1: {o:{x:{p:null, o:{a:{p:0}}}, a:{d:0}}}
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

      it.only 'can rewrite simple list indexes', -> xf
        op2: {l:{0:{di:'oh hi'}}}
        op1: {l:{10:{e:'edit'}}}
        expect: {l:{11:{e:'edit'}}}

      it.skip 'can change the root from an object to a list', -> xf
        op1: {o:{a:{e:'edit'}}}
        op2: {o:{a:{p:0}}, p:null, di:[], l:{0:{d:0}}}
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

      it 'transforms against inserts in my own list', ->
        xf #[0,1,2,3] -> [a,0,b,1,2,3...]
          op1: {l:{0:{di:'a'}, 2:{di:'b'}}}
          op2: {l:{1:{p:null}}}
          expect: {l:{0:{di:'a'}, 2:{di:'b'}}}

        ###
        xf #[0,1,2,3] -> ['a', 0, 'b', 'c', 1, 2, 3...]
          op1: {l:{0:{di:'a'}, 2:{di:'b'}, 3:{di:'c'}}}
          op2: {l:{1:{p:null, di:'X'}}}
          expect: {l:{0:{di:'a'}, 2:{di:'b'}, 3:{di:'c'}}}
        ###
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
