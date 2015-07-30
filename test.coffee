# The Nate format:
#
#
# Each descent looks like this:
# - Optional {} first element containing the edits at this leaf.
# - Next, optional list of scalars describing a descent
# - Finally either an edit {} or a list of descent.
#
# This is more complicated than the current system. It works like this:
# - The operation is a list.
# - 


assert = require 'assert'
type = require './json1'

{transform} = type

# Transform tests

printRepro = (op1, op2, direction, expect) ->
  console.error 'FAIL! Repro with:'
  console.log "transform #{JSON.stringify(op1)}, #{JSON.stringify(op2)}, '#{direction}'"



describe 'json1', ->
  before -> type.debug = true
  after -> type.debug = false

  describe 'checkOp', ->
    pass = (op) -> type.checkValidOp op
    fail = (op) -> assert.throws -> type.checkValidOp op

    it 'allows some simple valid ops', ->
      pass null
      pass [{e:"hi"}]
      pass [{i:[1,2,3]}]
      pass [{r:{}}]
      pass [['x',{p:0}], ['y',{d:0}]]
      pass [[0,{p:0}], [10,{d:0}]]
      pass [['a',{p:0}],['b',{d:0}],['x',{p:1}],['y',{d:1}]]

    it 'disallows invalid syntax', ->
      fail {}
      fail "hi"
      fail true
      fail false
      fail 0
      fail 10
      fail [{}]
      fail [{invalid:true}]
      fail [10, {}]
      fail [10, {invalid:true}]
      fail [10, 'hi']

    it 'throws if there is any empty leaves', ->
      fail []
      fail ['x']
      fail ['x', {}]
      fail ['x', []]
      fail [10]
      fail [10, {}]
      fail [10, []]

    it 'ensures path components are non-zero integers or strings', ->
      fail [-1, {r:{}}]
      fail [0.5, {r:{}}]
      fail [true, {r:{}}]
      fail [false, {r:{}}]
      fail [null, {r:{}}]
      fail [undefined, {r:{}}]

    it 'does not allow two pickups or two drops in a component', ->
      fail [{p:0, r:{}}]
      fail [{p:1, r:{}}]
      fail ['x', {p:0, r:{}}]
      fail ['x', {p:1, r:{}}]

      fail [{d:0, i:'hi'}]
      fail [{d:1, i:'hi'}]
      fail [10, {d:0, i:'hi'}]
      fail [10, {d:1, i:'hi'}]

    it 'throws if there are mismatched pickups / drops', ->
      fail [{p:0}]
      fail [{d:0}]
      fail ['x', {p:0}]
      fail [10, {p:0}]
      fail ['x', {d:0}]
      fail [10, {d:0}]

    it 'throws if pick/drop indexes dont start at 0', ->
      fail [['x', {p:1}], ['y', {d:1}]]
      fail [[10, {p:1}], [20, {d:1}]]

    it 'throws if a descent starts with an edit', ->
      fail [10, [{i:"hi"}]]

    it 'throws if descents are out of order', ->
      fail ['x', ['b', {r:{}}], ['a', {r:{}}]]
      fail ['x', [10, {r:{}}], [5, {r:{}}]]
      fail ['x', ['a', {r:{}}], [5, {r:{}}]]

    it 'throws if descents start with the same scalar', ->
      fail ['x', ['a', {r:{}}], ['a', {e:{}}]]

    it 'throws if descents have two adjacent edits', ->
      fail [{r:{}}, {p:0}]
      fail ['x', {r:{}}, {p:0}]
      fail ['x', {r:{}}, {p:0}, 'y', {r:{}}]

    it.skip 'does not allow ops to overwrite their own inserted data', ->
      fail [{i:{x:5}}, 'x', {i:6}]
      fail [{i:['hi']}, 0, {i:'omg'}]

    it.skip 'does not allow immediate data directly parented in other immediate data', ->
      fail [{i:{}}, 'x', {i:5}]
      fail [{i:{x:5}}, 'x', 'y', {i:6}]
      fail [{i:[]}, 0, {i:5}]

    it 'does not allow the final item to be a single descent', ->
      fail ['a', ['b', r:{}]] # It should be ['a', 'b', r:{}]

    it 'does not allow anything after the descents at the end', ->
      fail [[1, r:{}], [2, r:{}], 5]
      fail [[1, r:{}], [2, r:{}], 5, r:{}]
      fail [[1, r:{}], [2, r:{}], r:{}]

# ****** Apply ******

  describe 'apply', ->
    apply = ({doc:snapshot, op, expect}) ->
      snapshot = type.apply snapshot, op
      assert.deepEqual snapshot, expect

    it 'Can set properties', ->
      apply
        doc: []
        op: [0, {i:17}]
        expect: [17]

      apply
        doc: {}
        op: ['x', {i:5}]
        expect: {x:5}

    it 'can edit the root', ->
      apply
        doc: {x:5}
        op: [r:{}]
        expect: null

      apply
        doc: null
        op: [{i:5}]
        expect: 5
        
      apply
        doc: {x:5}
        op: [r:{}, i:[1,2,3]]
        expect: [1,2,3]

      # TODO: And an edit of the root.

    it 'can move', ->
      apply
        doc: {x:5}
        op: [['x', p:0], ['y', d:0]]
        expect: {y:5}

      apply
        doc: [0,1,2]
        op: [[1, p:0], [2, d:0]]
        expect: [0,2,1]

    it 'can handle complex list index stuff', ->
      apply
        doc: [0,1,2,3,4,5]
        op: [[1, r:{}, i:11], [2, r:{}, i:12]]
        expect: [0,11,12,3,4,5]

    it 'correctly handles interspersed descent and edits', ->
      apply
        doc: {x: {y: {}}}
        op: [['X',{d:0},'Y',{d:1}], ['x',{p:0},'y',{p:1}]]
        expect: {X: {Y: {}}}


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

      t [['x', p:0], ['y', d:0]]
      t [[1, p:0], [2, d:0]]

    it 'gloms together unrelated edits', ->
      compose
        op1: [['a', p:0], ['b', d:0]]
        op2: [['x', p:0], ['y', d:0]]
        expect: [['a', p:0], ['b', d:0], ['x', p:1], ['y', d:1]]

      compose
        op1: [2, i:'hi']
        op2: [0, 'x', r:{}]
        expect: [[0, 'x', r:{}], [2, i:"hi"]]

    it 'matches op1.dest -> op2.source', ->
      compose
        op1: [['x', p:0], ['y', d:0]]
        op2: [['y', p:0], ['z', d:0]]
        expect: [['x', p:0], ['z', d:0]]

    it 'translates drops in objects', ->
      compose
        op1: ['x', ['a', p:0], ['b', d:0]] # x.a -> x.b
        op2: [['x', p:0], ['y', d:0]] # x -> y
        expect: [['x', {p:0}, 'a', {p:1}], ['y', {d:0}, 'b', {d:1}]] # x.a -> y.b, x -> y

    it 'untranslates picks in objects', ->
      compose
        op1: [['x', p:0], ['y', d:0]] # x -> y
        op2: [['y', 'a', p:0], ['z', d:0]] # y.a -> z
        expect: [['x',p:0,'a',p:1], ['y',d:1], ['z',d:0]] # x.a -> z, x -> y

    it 'insert gets carried wholesale', ->
      compose
        op1: ['x', i:'hi there']
        op2: [['x', p:0], ['y', d:0]] # x -> y
        expect: ['y', i:'hi there']

    it 'insert gets edited by the op', ->
      compose
        op1: ['x', {i:{a:1, b:2, c:3}}]
        op2: [['x', 'a', {p:0}], ['y', d:0]]
        expect: [['x', {i:{b:2, c:3}}], ['y', {i:1}]]

    it 'merges mutual inserts', ->
      compose
        op1: [i:{}]
        op2: ['x', i:"hi"]
        expect: [i:{x:"hi"}]

    # TODO: List nonsense.

    # TODO: Edits.


# ****** Transform ******

  describe.skip 'transform', ->
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
        op2: {o:{x:{r:{}}}}
        expect: o:
          y:{o:{a:{p:0}, b:{d:0}}}

    it 'delete the source of a move', -> xf
      op1: {o:{x:{p:0}, y:{d:0}}}
      op2: {o:{x:{r:{}}}}
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
        op1: {o:{x:{i:"one"}}}
        op2: {o:{x:{i:"two"}}}
        expectLeft: {o:{x:{i:"one"}}}
        expectRight: null

      it 'delete vs delete', -> xf
        op2: {o:{a:{r:{}}}}
        op1: {o:{a:{r:{}}}}
        expect: null # It was already deleted.

      it 'move vs delete', -> xf
        op1: {o:{y:{o:{a:{p:0}, b:{d:0}}}}}
        op2: {o:{y:{r:{}}}}
        expect: null

      it 'delete parent of a move', -> xf
        # obj.a = obj.x.a; delete obj.y;
        op1: {o:{x:{r:{}, o:{a:{p:0}}}, a:{d:0}}}
        op2: {o:{x:{o:{a:{p:0}, b:{d:0}}}}}
        expect: {o:{x:{r:{}, o:{b:{p:0}}}, a:{d:0}}}

      it.skip 'deletes follow an escapee', -> xf
        op2: {o:{x:{o:{a:{p:1}}}, a:{d:1}}}
        op1: {o:{x:{r:{}}}}
        expect: {o:{x:{r:{}}, a:{r:{}}}}

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
        op2: {l:{0:{i:'oh hi'}}}
        op1: {l:{10:{e:'edit'}}}
        expect: {l:{11:{e:'edit'}}}

      it 'can change the root from an object to a list', -> xf
        op1: {o:{a:{e:'edit'}}}
        op2: {o:{a:{p:0}}, i:[], l:{0:{d:0}}}
        expect: {l:{0:{e:'edit'}}}

      it 'can handle adjacent drops', -> xf
        op1: {l:{11:{i:1}, 12:{i:2}, 13:{i:3}}}
        op2: {l:{0:{r:{}}}}
        expect: {l:{10:{i:1}, 11:{i:2}, 12:{i:3}}}

      it 'fixes drop indexes correctly 1', -> xf
        op2: {l:{1:{r:{}}}}
        op1: l:
          0: r:{}
          1: i:'hi'
        expect: l:
          0: {r:{}, i:'hi'}

      it 'list drop vs delete uses the correct result index', ->
        xf
          op2: {l:{2:{r:{}}}}
          op1: {l:{2:{i:'hi'}}}
          expect: {l:{2:{i:'hi'}}}

        xf
          op2: {l:{2:{r:{}}}}
          op1: {l:{3:{i:'hi'}}}
          expect: {l:{2:{i:'hi'}}}

      it 'list drop vs drop uses the correct result index', -> xf
        op2: {l:{2:{i:'other'}}}
        op1: {l:{2:{i:'hi'}}}
        expectLeft: {l:{2:{i:'hi'}}}
        expectRight: {l:{3:{i:'hi'}}}

      it 'list drop vs delete and drop', ->
        xf
          op2: {l:{2:{r:{}, i:'other'}}}
          op1: {l:{2:{i:'hi'}}}
          expectLeft: {l:{2:{i:'hi'}}}
          expectRight: {l:{3:{i:'hi'}}}

        xf
          op2: {l:{2:{r:{}}, 3:{i:'other'}}}
          op1: {l:{3:{i:'hi'}}}
          expect: {l:{2:{i:'hi'}}}

        xf
          op2: {l:{2:{r:{}}, 3:{i:'other'}}}
          op1: {l:{4:{i:'hi'}}}
          expectLeft: {l:{3:{i:'hi'}}}
          expectRight: {l:{4:{i:'hi'}}}

      it 'list delete vs drop', ->
        xf
          op2: {l:{2:{i:'hi'}}}
          op1: {l:{1:{r:{}}}}
          expect: {l:{1:{r:{}}}}

        xf
          op2: {l:{2:{i:'hi'}}}
          op1: {l:{2:{r:{}}}}
          expect: {l:{3:{r:{}}}}

        xf
          op2: {l:{2:{i:'hi'}}}
          op1: {l:{3:{r:{}}}}
          expect: {l:{4:{r:{}}}}

      it 'list delete vs delete', ->
        xf
          op2: {l:{1:{r:{}}}}
          op1: {l:{1:{r:{}}}}
          expect: null # It was already deleted.

      it 'fixes drop indexes correctly 2', -> xf
        op2: {l:{2:{r:{}}}} # Shouldn't effect the op.
        op1: l:
          0: r:{}
          1: i:'hi'
        expect: l:
          0: r:{}
          1: i:'hi'

      it 'insert vs delete parent', -> xf
        op2: {l:{2:{r:{}}}} # Shouldn't effect the op.
        op1: {l:{2:{o:{x:{i:"hi"}}}}}
        expect: null

      it 'transforms against inserts in my own list', ->
        xf #[0,1,2,3] -> [a,0,b,1,2,3...]
          op1: {l:{0:{i:'a'}, 2:{i:'b'}}}
          op2: {l:{1:{r:{}}}}
          expect: {l:{0:{i:'a'}, 2:{i:'b'}}}

        ###
        xf #[0,1,2,3] -> ['a', 0, 'b', 'c', 1, 2, 3...]
          op1: {l:{0:{i:'a'}, 2:{i:'b'}, 3:{i:'c'}}}
          op2: {l:{1:{r:{}, i:'X'}}}
          expect: {l:{0:{i:'a'}, 2:{i:'b'}, 3:{i:'c'}}}
        ###
###
        op1:
          l:
            1: {p:1}
            2: {r:{}}
            3:
              p: null
              d: 1
            4: {r:{}}
        expect: {}

###
