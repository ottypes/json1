# Unit tests for the JSON1 OT type.
#
# These tests are quite unstructured. You can see the skeletons of a few
# organizing systems, but ultimately there's just lots of test cases to run.
#
# Cleanups welcome, so long as you don't remove any tests.

assert = require 'assert'
{type} = require './index'
log = require './lib/log'

{transform} = type
deepClone = require './lib/deepClone'

# Transform tests

printRepro = (op1, op2, direction, expect) ->
  console.error 'FAIL! Repro with:'
  console.log "transform #{JSON.stringify(op1)}, #{JSON.stringify(op2)}, '#{direction}'"

apply = ({doc:snapshot, op, expect}) ->
  type.debug = false

  orig = deepClone snapshot
  result = type.apply snapshot, op
  assert.deepStrictEqual snapshot, orig, 'Original snapshot was mutated'
  assert.deepStrictEqual result, expect

xf = ({op1, op2, expect, expectLeft, expectRight, debug, lnf}) ->
  if expect != undefined then expectLeft = expectRight = expect

  type.debug = !!debug

  opts = {lnf}

  try
    #printRepro op1, op2, 'left', expectLeft
    left = transform op1, op2, 'left', opts
    assert.deepStrictEqual left, expectLeft
  catch e
    type.debug = true
    printRepro op1, op2, 'left', expectLeft
    transform op1, op2, 'left'
    throw e

  try
    #printRepro op1, op2, 'right', expectRight
    right = transform op1, op2, 'right', opts
    assert.deepStrictEqual right, expectRight
  catch e
    type.debug = true
    printRepro op1, op2, 'right', expectRight
    transform op1, op2, 'right'
    throw e

diamond = ({doc, op1, op2}) ->
  type.debug = false

  try
    # Test that the diamond property holds
    op1_ = transform op1, op2, 'left'
    op2_ = transform op2, op1, 'right'

    doc1 = type.apply doc, op1
    doc2 = type.apply doc, op2

    doc12 = type.apply doc1, op2_
    doc21 = type.apply doc2, op1_

    assert.deepStrictEqual doc12, doc21
  catch e
    log.quiet = false
    log '\nOops! Diamond property does not hold. Given document', doc
    log 'op1 ', op1, '   /    op2', op2
    log 'op1_', op1_, '   /    op2_', op2_
    log '---- 1'
    log 'op1', op1, '->', doc1
    log 'op2', op2_, '->', doc12
    log '---- 2'
    log 'op2', op2, '->', doc2
    log 'op1', op1_, '->', doc21
    log '----------'
    log doc12, '!=', doc21
    throw e


describe 'json1', ->
  before ->
    type.registerSubtype require 'ot-simple'
    type.debug = true
  after -> type.debug = false

  describe 'checkOp', ->
    pass = (op) -> type.checkValidOp op
    fail = (op) -> assert.throws -> type.checkValidOp op

    it 'allows some simple valid ops', ->
      pass null
      pass [{es:["hi"]}]
      pass [{e:"hi", et:'simple'}]
      pass [{i:[1,2,3]}]
      pass [{r:{}}]
      pass [['x',{p:0}], ['y',{d:0}]]
      pass [[0,{p:0}], [10,{d:0}]]
      pass [['a',{p:0}],['b',{d:0}],['x',{p:1}],['y',{d:1}]]

    it 'disallows invalid syntax', ->
      fail undefined
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
      fail ['x', ['a', {r:{}}], ['a', {r:{}}]]
      fail ['x', [10, {r:{}}], [10, {r:{}}]]

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

    it 'allows removes inside removes', ->
      pass ['x', r:true, 'y', r:true]
      pass ['x', r:{}, 'y', r:true]
      pass [['x', r:true, 'y', p:0, 'z', r:true], ['y', d:0]]
      pass [['x', r:{}, 'y', p:0, 'z', r:true], ['y', d:0]]

    it 'allows inserts inside inserts', ->
      pass [1, i:{}, 'x', i:10]
      pass [[0, 'x', p:0], [1, i:{}, 'x', d:0, 'y', i:10]]

    it.skip 'fails if the operation drops items inside something it picked up', ->
      fail ['x', r:true, 1, i:'hi']
      fail ['x', d:0, 1, p:0]
      fail [r:true, 1, p:0, d:0]

    describe 'edit', ->
      it 'requires all edits to specify their type', ->
        fail [{e:{}}]
        fail [5, {e:{}}]
        pass [{e:{}, et:'simple'}]

      it 'allows edits to have null or false for the operation', ->
        # These aren't valid operations according to the simple type, but the
        # type doesn't define a checkValidOp so we wouldn't be able to tell
        # anyway.
        pass [{e:null, et:'simple'}]
        pass [5, {e:null, et:'simple'}]
        pass [{e:false, et:'simple'}]
        pass [5, {e:false, et:'simple'}]

      it 'does not allow an edit to use an unregistered type', ->
        fail [{e:{}, et:'an undefined type'}]
        fail [{e:null, et:'an undefined type'}]

      it 'does not allow two edits in the same operation', ->
        fail [{e:{}, et:'simple', es:[1,2,3]}]
        # + the edits for numbers.

      it 'does not allow anything inside an edited subtree'

# ****** Apply ******

  describe 'apply', ->
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
        op: [r:true]
        expect: undefined

      apply
        doc: ''
        op: [r:true]
        expect: undefined

      apply
        doc: 'hi'
        op: [r:true, i:null]
        expect: null

      assert.throws ->
        apply
          doc: null
          op: [{i:5}]
          expect: 5

      apply
        doc: undefined
        op: [i:5]
        expect: 5

      apply
        doc: {x:5}
        op: [r:{}, i:[1,2,3]]
        expect: [1,2,3]

      # TODO: And an edit of the root.

    it 'can move 1', ->
      apply
        doc: {x:5}
        op: [['x', p:0], ['y', d:0]]
        expect: {y:5}

    it 'can move 2', ->
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
        doc: {x: {y: {was:'y'}, was:'x'}}
        op: [['X',{d:0},'Y',{d:1}], ['x',{p:0},'y',{p:1}]]
        expect: {X: {Y: {was:'y'}, was:'x'}}

    it 'can edit strings', ->
      apply
        doc: "errd"
        op: [{es:[2,"maghe"]}]
        expect: "ermagherd"

    it 'can edit subdocuments using an embedded type', ->
      apply
        doc: {str:'hai'}
        op: [{e:{position:2, text:'wai'}, et:'simple'}]
        expect: {str:'hawaii'}

    it 'applies edits after drops', -> apply
      doc: {x: "yooo"}
      op: [['x', p:0], ['y', d:0, es:['sup']]]
      expect: {y: "supyooo"}

  describe 'fuzzer tests', ->
    it 'asdf', -> apply
      doc: { the: '', Twas: 'the' }
      op: [ 'the', { es: [] } ]
      expect: { the: '', Twas: 'the' }

    it 'does not duplicate list items from edits', -> apply
      doc: ['eyes']
      op: [ 0, { es: [] } ]
      expect: ['eyes']

    it 'will edit the root document', -> apply
      doc: ''
      op: [es:[]]
      expect: ''

    # ------ These have nothing to do with apply. TODO: Move them out of this grouping.
    it 'diamond', ->
      # TODO: Do this for all combinations.
      diamond
        doc: Array.from 'abcde'
        op1: [ [ 0, { p: 0 } ], [ 1, { d: 0 } ] ]
        op2: [ [ 0, { p: 0 } ], [ 4, { d: 0 } ] ]

    it 'shuffles lists correctly', -> xf
      op1: [ [ 0, { p: 0 } ], [ 1, { d: 0 } ] ]
      op2: [ [ 0, { p: 0 } ], [ 10, { d: 0 } ] ]
      expectLeft: [ [ 1, { d: 0 } ], [ 10, { p: 0 } ] ]
      expectRight: null

    it 'inserts before edits', ->
      xf
        op1: [0, 'x', i:5]
        op2: [0, i:35]
        expect: [1, 'x', i:5]

      xf
        op1: [0, es:[]]
        op2: [0, i:35]
        expect: [1, es:[]]

    it 'duplicates become noops in a list',
      -> xf
        op1: [0,{"p":0,"d":0}]
        op2: [0,{"p":0,"d":0}]
        expectLeft: [0,{"p":0,"d":0}] # This is a bit weird.
        expectRight: null

      -> xf
        op1: [0, r:true, i:'a']
        op2: [0, i:'b']
        expectLeft: [[0, i:'a'], [1, r:true]]
        expectRight: [1, r:true, i:'a']

      -> xf
        op1: [0, r:true, i:5]
        op2: [0, r:true]
        expect: [0, i:5]

    it 'p1 pick descends correctly', ->
      xf
        op1: [2, r:true, 1, es:['hi']]
        op2: [3, 1, r:true]
        expect: [2, r:true]

      xf
        op1: [[2, r:true, 1, es:['hi']], [3, 1, r:true]]
        op2: [3, 2, r:true]
        expect: [[2, r:true], [3, 1, r:true]]

    it 'transforms picks correctly', -> xf
      op1: [1, 1, r:true]
      op2: [0, p:0, d:0]
      expect: [1, 1, r:true]

    it 'pick & drop vs insert after the picked item', -> xf
      op1: [0, p:0,d:0] # Remove / insert works the same.
      op2: [1, i:"hi"]
      expectLeft: [0, p:0,d:0]
      expectRight: [[0, p:0], [1, d:0]]

    it 'pick same item vs shuffle list', -> xf
      op1: [1, ['x', p:0], ['y', d:0]]
      op2: [1, {d:0}, 'x', {p:0}]
      expectLeft: [1, p:0, 'y', d:0]
      expectRight: null

    it 'remove the same item in a list', -> xf
      op1: [ 0, { r: true } ]
      op2: [ 0, { r: true } ]
      expect: null

    it 'rm vs hold item', -> xf
      op1: [ 0, { r: true } ]
      op2: [ 0, { p: 0, d: 0 } ]
      expect: [ 0, { r: true } ]

    it 'moves child elements correctly', -> xf
      doc: ['a', [0,10,20], 'c']
      op1: [ 1, 0, { p: 0, d: 0 } ]
      op2: [ [ 1, { d: 0 } ], [ 2, { p: 0 } ] ]
      expect: [ 2, 0, { d:0, p:0 } ]

    it 'moves list indexes', -> xf
      doc: [[], 'b', 'c']
      op1: [ [ 0, 'hi', { d: 0 } ], [ 1, { p: 0 } ] ]
      op2: [ [ 0, { p: 0 } ], [ 20, { d: 0 } ] ]
      expect: [[0, p:0], [19, 'hi', d:0]]

    it 'insert empty string vs insert null', -> xf
      doc: undefined
      op1: [i:'hi']
      op2: [i:null]
      expectLeft: [r:true, i:'hi']
      expectRight: null

    it 'move vs emplace', -> xf
      doc: ['a', 'b']
      op1: [[0, p:0], [1, d:0]]
      op2: [1, {p:0, d:0}]
      expectLeft: [0, {p:0, d:0}]
      expectRight: [[0, p:0], [1, d:0]]

    it 'rm chases a subdocument that was moved out', -> xf
      doc: [ [ 'aaa' ] ]
      op1: [ 0, { r: true } ]
      op2: [ 0, { d: 0 }, 0, { p: 0 } ] # Valid because lists.
      expect: [[0, r:true], [1, r:true]]

    it 'colliding drops', -> xf
      doc: [ 'a', 'b', {} ]
      op1: [ [ 0, { p: 0 } ], [ 1, 'x', { d: 0 } ] ] # -> ['b', x:'a']
      op2: [ 1, { p: 0 }, 'x', { d: 0 } ] # -> ['a', x:'b']
      expectLeft: [[0, p:0, 'x', d:0], [1, 'x', r:true]]
      expectRight: [0, r:true]

    it 'transform crash', -> xf
      op1: [ [ 'the', { r: true, d: 0 } ], [ 'whiffling', { p: 0 } ] ]
      op2: [ 'the', { p: 0, d: 0 } ]
      expect: [ [ 'the', { d: 0, r: true } ], [ 'whiffling', { p: 0 } ] ]

# ******* Compose *******

  describe 'compose', ->
    compose = ({op1, op2, expect}) ->
      result = type.compose op1, op2
      assert.deepStrictEqual result, expect

    it 'composes empty ops to nothing', -> compose
      op1: null
      op2: null
      expect: null

    describe 'op1 drop', ->
      it 'vs remove', -> compose
        op1: [['x', p:0], ['y', d:0]]
        op2: ['y', r:true]
        expect: ['x', r:true]

      it 'vs remove parent', -> compose
        op1: [['x', p:0], ['y', 0, d:0]]
        op2: ['y', r:true]
        expect: [['x', r:true], ['y', r:true]]

      it 'vs remove child', -> compose
        op1: [['x', p:0], ['y', d:0]]
        op2: ['y', 'a', r:true]
        expect: [['x', p:0, 'a', r:true], ['y', d:0]]

      it 'vs remove and pick child', -> compose
        op1: [['x', p:0], ['y', d:0]]
        op2: [['y', r:true, 'a', p:0], ['z', d:0]]
        expect: [['x', r:true, 'a', p:0], ['z', d:0]]

      it 'vs pick', -> compose
        op1: [['x', p:0], ['y', d:0]]
        op2: [['y', p:0], ['z', d:0]]
        expect: [['x', p:0], ['z', d:0]]

      it 'is transformed by op2 picks', -> compose
        op1: [['x', p:0], ['y', 10, d:0]]
        op2: ['y', 0, r:true]
        expect: [['x', p:0], ['y', [0, r:true], [9, d:0]]]

    describe 'op1 insert', ->
      it 'vs remove', -> compose
        op1: ['x', i:{a:'hi'}]
        op2: ['x', r:true]
        expect: null

      it 'vs remove parent', -> compose
        op1: ['x', 0, i:{a:'hi'}]
        op2: ['x', r:true]
        expect: ['x', r:true]

      it 'vs remove child', -> compose
        op1: ['x', i:{a:'hi', b:'woo'}]
        op2: ['x', 'a', r:true]
        expect: ['x', i:{b:'woo'}]

      it 'vs remove and pick child', -> compose
        op1: ['x', i:{a:'hi', b:'woo'}]
        op2: [['x', r:true, 'a', p:0], ['y', d:0]]
        expect: ['y', i:'hi']

      it 'vs remove an embedded insert', -> compose
        op1: ['x', i:{}, 'y', i:'hi']
        op2: ['x', 'y', r:true]
        expect: ['x', i:{}]

      it 'vs remove from an embedded insert', -> compose
        op1: ['x', i:{}, 'y', i:[1,2,3]]
        op2: ['x', 'y', 1, r:true]
        expect: ['x', i:{}, 'y', i:[1, 3]]

      it 'picks the correct element of an embedded insert', -> compose
        op1: ['x', i:['a', 'b', 'c'], 1, i:'XX']
        op2: [['x', 1, p:0], ['y', d:0]]
        expect: [['x', i:['a', 'b', 'c']], ['y', i:'XX']]

      it 'moves all children', -> compose
        op1: ['x', i:{}, 'y', i:[1,2,3]]
        op2: [['x', p:0], ['z', d:0]]
        expect: ['z', i:{}, 'y', i:[1,2,3]]
      
      it 'removes all children', -> compose
        op1: ['x', i:{}, 'y', i:[1,2,3]]
        op2: ['x', r:true]
        expect: null

      it 'removes all children when removed at the destination', -> compose
        op1: [['x', p:0], ['y', d:0, 0, i:'hi']]
        op2: ['y', r:true]
        expect: ['x', r:true]

      it 'vs op2 insert', -> compose # Inserts aren't folded together.
        op1: [i:{}]
        op2: ['x', i:'hi']
        expect: [i:{}, 'x', i:'hi']
 
    describe 'op1 edit', ->
      it 'removes the edit if the edited object is deleted', -> compose
        op1: ['x', es:['hi']]
        op2: ['x', r:true]
        expect: ['x', r:true]

      it 'removes the edit in an embedded insert 1', -> compose
        op1: ['x', i:'', es:['hi']]
        op2: ['x', r:true]
        expect: null

      it 'removes the edit in an embedded insert 2', -> compose
        op1: ['x', i:[''], 0, es:['hi']]
        op2: ['x', 0, r:true]
        expect: ['x', i:[]]

      it 'composes edits', -> compose
        op1: [es:['hi']]
        op2: [es:[2, ' there']]
        expect: [es:['hi there']]

      it 'transforms and composes edits', -> compose
        op1: ['x', es:['hi']]
        op2: [['x', p:0], ['y', d:0, es:[2, ' there']]]
        expect: [['x', p:0], ['y', d:0, es:['hi there']]]

      it 'preserves inserts with edits', -> compose
        op1: ['x', i:'hi']
        op2: [['x', p:0], ['y', d:0, es:[' there']]]
        expect: ['y', i:'hi', es:[' there']]

      it 'allows a different edit in the same location', -> compose
        op1: ['x', es:['hi']]
        op2: ['x', r:true, i:'yo', es:[2, ' there']]
        expect: ['x', r:true, i:'yo', es:[2, ' there']]

    describe 'op2 pick', ->
      it 'gets untransformed by op1 drops', ->
        op1: [5, i:'hi']
        op2: [6, r:true]
        expect: [5, r:true, i:'hi']

    describe 'op1 insert containing a drop', ->
      it 'vs pick at insert', -> compose
        op1: [['x', p:0], ['y', i:{}, 'x', d:0]]
        op2: [['y', p:0], ['z', d:0]]
        expect: [['x', p:0], ['z', i:{}, 'x', d:0]]


  # *** Old stuff
  describe.skip 'old compose', ->
    compose = ({op1, op2, expect}) ->
      result = type.compose op1, op2
      assert.deepStrictEqual result, expect

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

  describe 'transform', ->
    describe 'op1 pick', ->
      it 'vs delete', -> xf
        op1: [['x', p:0], ['y', d:0]]
        op2: ['x', r:true]
        expect: null
      it 'vs delete parent', -> xf
        op1: [['x', 'a', p:0], ['y', d:0]]
        op2: ['x', r:true]
        expect: null
      it 'vs delete parent 2', -> xf
        op1: ['x', ['a', p:0], ['b', d:0]]
        op2: ['x', r:true]
        expect: null

      it 'vs pick', -> xf
        op1: [['x', p:0], ['z', d:0]]
        op2: [['x', p:0], ['y', d:0]]
        expectLeft: [['y', p:0], ['z', d:0]]
        expectRight: null
      it 'vs pick parent', -> xf
        op1: [['x', 'a', p:0], ['z', d:0]]
        op2: [['x', p:0], ['y', d:0]]
        expect: [['y', 'a', p:0], ['z', d:0]]

      it 'vs pick and pick child', -> xf # regression
        op1: [ # a -> xa, a.c -> xc
          ['a', p:0, 'c', p:1]
          ['xa', d:0]
          ['xc', d:1]
        ]
        op2: [['a', p:0], ['b', d:0]] # a -> b
        expectLeft: [
          ['b', p:0, 'c', p:1]
          ['xa', d:0]
          ['xc', d:1]
        ]
        expectRight: [
          ['b', 'c', p:0]
          ['xc', d:0]
        ]

      it 'vs edit', -> xf
        op1: [['x', p:0], ['z', d:0]]
        op2: ['x', es:['hi']]
        expect: [['x', p:0], ['z', d:0]]

      it 'vs delete, drop', -> xf
        op1: [['x', p:0], ['y', d:0]]
        op2: [['a', p:0], ['x', r:0, d:0]]
        expect: null

      it 'vs delete, insert', -> xf
        op1: [['x', p:0], ['y', d:0]]
        op2: ['x', r:0, i:5]
        expect: null

      it 'vs pick, drop to self',
        -> xf
          op1: [['x', p:0], ['y', d:0]]
          op2: [['x', p:0], ['y', d:0]]
          expect: null

        -> xf
          op1: [['a', 1, p:0], ['y', d:0]]
          op2: [['a', 1, p:0], ['y', d:0]]
          expect: null

      it 'vs pick, drop', -> xf
        op1: [['x', p:0], ['z', d:0]] # x->z
        op2: [['a', p:0], ['x', p:1, d:0], ['y', d:1]] # a->x, x->y
        expectLeft: [['y', p:0], ['z', d:0]]
        expectRight: null

      it 'vs pick, insert', -> xf
        op1: [['x', p:0], ['z', d:0]]
        op2: [['x', p:0, i:5], ['y', d:0]]
        expectLeft: [['y', p:0], ['z', d:0]]
        expectRight: null

      it 'vs pick, edit', ->
        op1: [['x', p:0], ['z', d:0]]
        op2: [['x', es:['hi'], p:0], ['y', d:0]]
        expectLeft: [['y', p:0], ['z', d:0]]
        expectRight: null

    describe 'op1 delete', ->
      it 'vs delete', -> xf
        op1: ['x', r:true]
        op2: ['x', r:true]
        expect: null
      it 'vs delete parent', -> xf
        op1: ['x', 'a', r:true]
        op2: ['x', r:true]
        expect: null

      it 'vs pick', -> xf
        op1: ['x', r:true]
        op2: [['x', p:0], ['y', d:0]]
        expect: ['y', r:true]
      it 'vs pick parent', -> xf
        op1: ['x', 'a', r:true]
        op2: [['x', p:0], ['y', d:0]]
        expect: ['y', 'a', r:true]

      it 'vs pick and drop', -> xf
        op1: ['x', r:true]
        op2: [['a', p:0], ['x', d:0, p:1], ['z', d:1]]
        expect: ['z', r:true]

      describe 'vs pick child', ->
        it 'move in', -> xf
          op1: ['x', r:true]
          op2: [['a', p:0], ['x', 'y', d:0]]
          expect: ['x', r:true]

        it 'move across', -> xf
          op1: ['x', r:true] # delete doc.x
          op2: ['x', ['y', p:0], ['z', d:0]]
          expect: ['x', r:true]

        it 'move out', -> xf
          op1: ['x', r:true]
          op2: [['x', 'y', p:0], ['y', d:0]] # move doc.x.y -> doc.y
          expect: [['x', r:true], ['y', r:true]] # delete doc.x and doc.y

        it 'multiple out', -> xf
          op1: ['x', r:true]
          op2: [['x', 'y', p:0, 'z', p:1], ['y', d:0], ['z', d:1]]
          expect: [['x', r:true], ['y', r:true], ['z', r:true]]

        it 'chain out', -> xf # Not sure if this is a useful test
          op1: ['x', r:true]
          op2: [['x', 'y', p:0], ['y', p:1], ['z', d:0, 'a', d:1]]
          expect: [['x', r:true], ['z', r:true]]

        it 'mess', -> xf
          # yeesh
          op1: [['x', r:true, 'y', 'z', p:0], ['z', d:0]]
          op2: [['x', 'y', p:0], ['y', d:0]]
          expect: [['x', r:true], ['y', r:true, 'z', p:0], ['z', d:0]]

      it 'vs edit', -> xf
        op1: ['x', r:true]
        op2: ['x', es:['hi']]
        expect: ['x', r:true]

    describe 'op1 drop', ->
      it 'vs delete parent', -> xf
        op1: [['x', p:0], ['y', 'a', d:0]]
        op2: ['y', r:true]
        expect: ['x', r:true]

      it 'vs a cancelled parent', -> xf
        op1: [['x', 'y', p:0], ['y', p:1], ['z', d:0, 'a', d:1]]
        op2: ['x', r:true]
        expect: ['y', r:true]

      it 'vs pick parent', -> xf
        op1: [['x', p:0], ['y', 'a', d:0]]
        op2: [['y', p:0], ['z', d:0]]
        expect: [['x', p:0], ['z', 'a', d:0]]

      it 'vs drop', -> xf
        op1: [['x', p:0], ['z', d:0]]
        op2: [['y', p:0], ['z', d:0]]
        expectLeft: [['x', p:0], ['z', r:true, d:0]]
        expectRight: ['x', r:true]

      it 'vs drop (list)', -> xf
        op1: [[0, p:0], [4, d:0]]
        op2: [[5, d:0], [10, p:0]]
        expectLeft: [[0, p:0], [4, d:0]]
        expectRight: [[0, p:0], [5, d:0]]

      it 'vs drop (chained)', -> xf
        op1: [['a', p:1], ['x', p:0], ['z', d:0, 'a', d:1]]
        op2: [['y', p:0], ['z', d:0]]
        expectLeft: [['a', p:1], ['x', p:0], ['z', r:true, d:0, 'a', d:1]]
        expectRight: [['a', r:true], ['x', r:true]]

      it 'vs insert', -> xf
        op1: [['x', p:0], ['z', d:0]]
        op2: ['z', i:5]
        expectLeft: [['x', p:0], ['z', r:true, d:0]]
        expectRight: ['x', r:true]

      it 'vs pick (a->b->c vs b->x)', -> xf
        op1: [['a', p:0], ['b', {p:1, d:0}], ['c', d:1]]
        op2: [['b', p:0], ['x', d:0]]
        expectLeft: [['a', p:0], ['b', d:0], ['c', d:1], ['x', p:1]]
        expectRight: [['a', p:0], ['b', d:0]]

      describe.skip 'vs move inside me', ->
        it 'in objects', -> xf
          op1: [['x', p:0], ['y', 'a', d:0]]
          op2: [['x', 'a', d:0], ['y', p:0]]
          expectLeft: [['x', p:0, 'a', p:1], ['y', d:1, 'x', d:0]]
          expectRight: null

        it 'in lists', -> xf
          op1: [0, p:0, 'x', d:0]
          op2: [[0, 'y', d:0], [1, p:0]]
          expectLeft: [0, {p:0, d:1}, ['x', d:0], ['y', p:1]]
          expectRight: null

        it 'multiple', -> xf
          # a->x.a, b->x.b
          op1: [['a', p:0], ['b', p:1], ['x', 'a', d:0, 'b', d:1]]
          op2: [['a', 'x', d:0], ['x', p:0]] # x->a.x
          expectLeft: [['a', p:0, 'x', p:1], ['b', p:2],
            ['x', d:1, ['a', d:0], ['b', d:2]]]
          expectRight: null

    describe 'op1 insert', ->
      it 'vs delete parent', -> xf
        op1: ['y', 'a', i:5]
        op2: ['y', r:true]
        expect: null

      it 'vs pick parent', -> xf
        op1: ['y', 'a', i:5]
        op2: [['y', p:0], ['z', d:0]]
        expect: ['z', 'a', i:5]

      it 'vs drop', -> xf
        op1: ['z', i:5]
        op2: [['y', p:0], ['z', d:0]]
        expectLeft: ['z', r:true, i:5]
        expectRight: null

      it 'vs insert', -> xf
        op1: ['z', i:5]
        op2: ['z', i:10]
        expectLeft: ['z', r:true, i:5]
        expectRight: null

      it 'vs insert at list position', -> xf
        op1: [5, i:'hi']
        op2: [5, i:'there']
        expectLeft: [5, i:'hi']
        expectRight: [6, i:'hi']

      it 'vs identical insert', -> xf
        op1: ['z', i:5]
        op2: ['z', i:5]
        expect: null

      # This is the new setNull for setting up schemas
      it 'vs embedded inserts', ->
        xf
          op1: ['x', i:{}]
          op2: ['x', i:{}, 'y', i:5]
          expect: null

        xf
          op1: ['x', i:{}, 'y', i:5]
          op2: ['x', i:{}]
          expect: ['x', 'y', i:5]

        xf
          op1: ['x', i:{}, 'y', i:5]
          op2: ['x', i:{}, 'y', i:5]
          expect: null

        xf
          op1: ['x', i:{}, 'y', i:5]
          op2: ['x', i:{}, 'y', i:6]
          expectLeft: ['x', 'y', r:true, i:5]
          expectRight: null

      it 'with embedded edits', -> xf
        op1: [i:'', es:['aaa']]
        op2: [i:'', es:['bbb']]
        expectLeft: [es:['aaa']]
        expectRight: [es:[3, 'aaa']]

    describe 'op1 edit', ->
      it 'vs delete', -> xf
        op1: ['x', es:['hi']]
        op2: ['x', r:true]
        expect: null

      it 'vs delete parent', -> xf
        op1: ['x', 'y', es:['hi']]
        op2: ['x', r:true]
        expect: null

      it 'vs pick', -> xf
        op1: ['x', es:['hi']]
        op2: [['x', p:0], ['y', d:0]]
        expect: ['y', es:['hi']]

      it 'vs edit', -> xf
        op1: ['x', es:['ab']]
        op2: ['x', es:['cd']]
        expectLeft: ['x', es:['ab']]
        expectRight: ['x', es:[2, 'ab']]

      it 'vs move and edit', -> xf
        op1: ['x', es:['ab']]
        op2: [['x', p:0], ['y', d:0, es:['cd']]]
        expectLeft: ['y', es:['ab']]
        expectRight: ['y', es:[2, 'ab']]

    describe 'op2 cancel move', ->
      it 'and insert', -> xf
        op1: ['x', r:true]
        op2: [['x', 'a', p:0], ['y', d:0, 'b', i:5]]
        expect: [['x', r:true], ['y', r:true]]

      it 'and another move', -> xf
        op2: [['q', p:1], ['x', 'a', p:0], ['y', d:0, 'b', d:1]]
        op1: ['x', r:true]
        expect: [['x', r:true], ['y', r:true]]

    describe 'op2 list move an op1 drop', ->
      it 'vs op1 remove', -> xf
        op1: [[0, r:true, 'a', i:'hi'], [5, r:true]]
        op2: [[1, p:0], [4, d:0]]
        expect: [[0, r:true], [3, 'a', i:'hi'], [5, r:true]]

      it 'vs op1 remove 2', -> xf
        op1: [[0, r:true, 'a', i:'hi'], [1, r:true], [2, r:true]]
        op2: [[3, p:0], [4, d:0]]
        expect: [[0, r:true], [1, r:true, 'a', i:'hi'], [2, r:true]]

      it 'vs op1 insert before', -> xf
        op1: [[0, i:'a'], [1, i:'b'], [2, 'a', i:'hi']]
        op2: [[0, p:0], [1, d:0]]
        expect: [[0, i:'a'], [1, i:'b'], [3, 'a', i:'hi']]


      it 'vs op1 insert before and replace', -> xf
        op1: [[0, i:'xx', 'a', r:true], [1, 'a', i:'hi']]
        op2: [[0, p:0], [3, d:0]]
        expect: [[0, i:'xx'], [3, 'a', r:true], [4, 'a', i:'hi']]
        

    describe 'list', ->
      describe 'drop', ->
        it 'transforms by p1 drops', -> xf
          op1: [[5, i:5], [10, i:10]]
          op2: [9, i:9]
          expectLeft: [[5, i:5], [10, i:10]]
          expectRight: [[5, i:5], [11, i:10]]

        it 'transforms by p1 picks'
        it 'transforms by p2 picks'
        it 'transforms by p2 drops'

    describe 'blackhole', ->
      it 'works with objects blackholed', -> xf
        op1: [['x', p:0], ['y', 'a', d:0]]
        op2: [['x', 'a', d:0], ['y', p:0]]
        expect: ['x', r:true]

      it 'blackhole logic does not apply when op2 removes parent', -> xf
        # TODO: Although you wouldn't know it, since this result is very similar.
        op1: [['x', p:0], ['y', 'xx', 'a', d:0]]
        op2: [['x', 'a', d:0], ['y', p:0, 'xx', r:true]]
        expect: ['x', r:true]

      it 'blackhole logic still applies when op2 inserts', -> xf
        op1: [['x', p:0], ['y', 'a', i:{}, 'b', d:0]]
        op2: [['x', 'a', i:{}, 'b', d:0], ['y', p:0]]
        expect: ['x', r:true]

      it 'blackholes items in lists correctly', -> xf
        op1: [1, p:0, 'a', d:0]
        op2: [[1, 'b', d:0], [2, p:0]]
        expect: [1, r:true]

      it.skip 'moves blackholed items into lnf', ->
        xf
          op1: [['x', p:0], ['y', 'a', d:0]]
          op2: [['x', 'a', d:0], ['y', p:0]]
          lnf: ['lnf']
          expect: [['lnf', [0, d:0], [1, d:1]], ['x', p:0], ['y', p:1]]

  describe 'transform-old', ->
    it 'foo', ->
      xf
        op1: [
          ['x', ['a', {p:0}], ['b', {d:0}]],
          ['y', ['a', {p:1}], ['b', {d:1}]]
        ]
        op2: ['x', {r:true}]
        expect: ['y', ['a', {p:0}], ['b', {d:0}]]

    # it 'hard', ->
    #   op1: ['x', [1, r:true], [2, r:true, es:['hi']]] # Edit at index 4 originally.
    #   # move the edited string to .y[4] which
    #   op2: [['x', 4, p:0], ['y', [2, r:true], [4, d:0]]]
    #   expect:

    describe 'object edits', ->
      it 'can reparent with some extra junk', -> xf
        op1: [['x', p:0], ['y', d:0]]
        op2: [
          ['_a', d:1]
          ['_x', d:0]
          ['x', p:0, 'a', p:1]
        ]
        expectLeft: [['_x', p:0], ['y', d:0]]
        expectRight: null # the object was moved fair and square.

    describe 'deletes', ->

      it.skip 'delete parent of a move', -> xf
        # The current logic of transform actually just burns everything (in a
        # consistant way of course). I'm not sure if this is better or worse -
        # basically we'd be saying that if a move could end up in one of two places,
        # put it in the place where it won't be killed forever. But that introduces new
        # complexity, so I'm going to skip this for now.

        # x.a -> a, delete x
        op1: [['x', r:true, 'a', p:0], ['z', d:0]]
        # x.a -> x.b.
        op2: ['x', ['a', p:0], ['b', d:0]]
        expect: [['x', r:true, 'b', p:0], ['z', d:0]] # TODO: It would be better to do this in both cases.
        #expectRight: ['x', r:true]

      it 'awful delete nonsense', ->
        xf
          op1: [['x', r:true], ['y', i:'hi']] # delete doc.x, insert doc.y
          op2: [['x', 'a', p:0], ['y', d:0]] # move doc.x.a -> doc.y
          expect: [['x', r:true], ['y', r:true, i:'hi']] # del doc.x and doc.y, insert doc.y

        xf
          op1: [['x', 'a', p:0], ['y', d:0]] # x.a -> y
          op2: [['x', r:true], ['y', i:'hi']] # delete x, ins y
          expect: null

        xf
          op1: [10, r:true]
          op2: [[5, d:0], [10, 1, p:0]]
          expect: [[5, r:true], [11, r:true]]
        # And how do those indexes interact with pick / drop operations??


    describe 'swap', ->
      swap = [
        ['a', p:0, 'b', p:1]
        ['b', d:1, 'a', d:0]
      ]

      it 'noop vs swap', -> xf
        op1: null
        op2: swap
        expect: null

      it 'can swap two edits', -> xf
        op1: ['a', es:['a edit'], 'b', es:['b edit']]
        op2: swap
        expect: ['b', es:['b edit'], 'a', es:['a edit']]

    describe 'lists', ->
      it 'can rewrite simple list indexes', ->
        xf
          op1: [10, es:['edit']]
          op2: [0, i:'oh hi']
          expect: [11, es:['edit']]

        xf
          op1: [10, r:true]
          op2: [0, i:'oh hi']
          expect: [11, r:true]

        xf
          op1: [10, i:{}]
          op2: [0, i:'oh hi']
          expect: [11, i:{}]

      it 'can change the root from an object to a list', -> xf
        op1: ['a', es:['hi']]
        op2: [{i:[], r:true}, [0, d:0], ['a', p:0]]
        expect: [0, es:['hi']]

      it 'can handle adjacent drops', -> xf
        op1: [[11, i:1], [12, i:2], [13, i:3]]
        op2: [0, r:true]
        expect: [[10, i:1], [11, i:2], [12, i:3]]

      it 'fixes drop indexes correctly 1', -> xf
        op1: [[0, r:true], [1, i:'hi']]
        op2: [1, r:true]
        expect: [0, r:true, i:'hi']

      it 'list drop vs delete uses the correct result index', ->
        xf
          op1: [2, i:'hi']
          op2: [2, r:true]
          expect: [2, i:'hi']

        xf
          op1: [3, i:'hi']
          op2: [2, r:true]
          expect: [2, i:'hi']

      it 'list drop vs drop uses the correct result index', -> xf
        op1: [2, i:'hi']
        op2: [2, i:'other']
        expectLeft: [2, i:'hi']
        expectRight: [3, i:'hi']

      it 'list drop vs delete and drop', ->
        xf
          op1: [2, i:'hi']
          op2: [2, r:true, i:'other']
          expectLeft: [2, i:'hi']
          expectRight: [3, i:'hi']

        xf
          op1: [3, i:'hi']
          op2: [[2, r:true], [3, i:'other']]
          expect: [2, i:'hi']

        xf
          op1: [4, i:'hi']
          op2: [[2, r:true], [3, i:'other']]
          expectLeft: [3, i:'hi']
          expectRight: [4, i:'hi']

      it 'list delete vs drop', ->
        xf
          op1: [1, r:true]
          op2: [2, i:'hi']
          expect: [1, r:true]

        xf
          op1: [2, r:true]
          op2: [2, i:'hi']
          expect: [3, r:true]

        xf
          op1: [3, r:true]
          op2: [2, i:'hi']
          expect: [4, r:true]

      it 'list delete vs delete', ->
        xf
          op1: [1, r:true]
          op2: [1, r:true]
          expect: null # It was already deleted.

      it 'fixes drop indexes correctly 2', -> xf
        op1: [[0, r:true], [1, i:'hi']]
        op2: [2, r:true] # Shouldn't affect the op.
        expect: [[0, r:true], [1, i:'hi']]

      it 'insert vs delete parent', -> xf
        op1: [2, 'x', i:'hi']
        op2: [2, r:true]
        expect: null

      it 'transforms against inserts in my own list', ->
        xf #[0,1,2,3] -> [a,0,b,1,2,3...]
          op1: [[0, i:'a'], [2, i:'b']]
          op2: [1, r:true]
          expect: [[0, i:'a'], [2, i:'b']]

      it 'vs cancelled op2 drop', -> xf
        doc: {x:{a:'x.a'}, y:['a','b','c']}
        op1: [['x', r:true], ['y', 3, i:5]]
        op2: [['x', 'a', p:0], ['y', 2, d:0]]
        expect: [['x', r:true], ['y', [2, r:true], [3, i:5]]]

      it 'vs cancelled op1 drop', -> xf
        op1: [['x', p:0], ['y', [3, d:0], [4, i:5]]]
        op2: ['x', r:true]
        expect: ['y', 3, i:5]

      it 'vs cancelled op1 pick', -> xf
        doc: Array.from 'abcdefg'
        op1: [[1, p:0], [4, r:true, i:4], [6, d:0]]
        op2: [1, r:true]
        expect: [[3, r:true], [4, i:4]]

      it 'xxxxx 1', -> diamond # TODO Regression.
        doc: Array.from('abcdef')
        op1: [[1, {p:0, i:'AAA'}], [3, {i:'BBB'}], [5, {d:0}]]
        op2: [1, {r:true}]

      it 'xxxxx 2', -> diamond
        doc: Array.from('abcdef')
        op1: [[1, {p:0, i:'AAA'}], [3, {d:0}], [5, {i:'CCC'}]]
        op2: [1, {r:true}]


    describe 'edit', ->
      it 'transforms edits by one another', -> xf
        op1: [1, es:[2, 'hi']]
        op2: [1, es:['yo']]
        expect: [1, es:[4, 'hi']]

      it 'copies in ops otherwise', -> xf
        op1: ['x', {e:{position:2, text:'wai'}, et:'simple'}]
        op2: ['y', r:true]
        expect: ['x', {e:{position:2, text:'wai'}, et:'simple'}]

      it 'allows edits at the root', -> xf
        op1: [{e:{position:2, text:'wai'}, et:'simple'}]
        op2: [{e:{position:0, text:'omg'}, et:'simple'}]
        expect: [{e:{position:5, text:'wai'}, et:'simple'}]

      it 'applies edits in the right order', -> xf
        # Edits happen *after* the drop phase.
        op1: [1, es:[2, 'hi']]
        op2: [[1, i:{}], [2, es:['yo']]]
        expect: [2, es:[4, 'hi']]

      it 'an edit on a deleted object goes away', -> xf
        op1: [1, es:[2, 'hi']]
        op2: [1, r:"yo"]
        expect: null

      # TODO Numbers

