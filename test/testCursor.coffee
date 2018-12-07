{writeCursor, readCursor} = require '../lib/cursor'
assert = require 'assert'

data = require('fs').readFileSync(__dirname + '/ops.json', 'utf8').split('\n').filter((x) -> x != '').map(JSON.parse)

describe 'cursors', ->
  describe 'writeCursor duplicates', ->
    test = (op) ->
      w = writeCursor()

      f = (l) ->
        assert Array.isArray l
        depth = 0
        for c in l
          if typeof c in ['string', 'number']
            depth++
            w.descend c
          else if Array.isArray c
            f c
          else if typeof c is 'object'
            for k, v of c
              w.write k, v

        w.ascend() for [0...depth]

      f op if op != null
      assert.deepEqual op, w.get()

    for d in data
      do (d) -> it "#{JSON.stringify d}", -> test d

  describe 'copy using read cursors', ->
    test = (op) ->
      r = readCursor op
      w = writeCursor()
      path = []
      do f = ->
        if component = r.getComponent()
          # console.log 'component', component
          w.write k, v for k, v of component

        assert.deepStrictEqual r.getPath(), path

        for k from r.children()
          path.push k
          w.descend k
          f()
          w.ascend()
          path.pop()

      assert.deepEqual op, w.get()
        # console.log op
        # console.log w.get()
    for d in data
      do (d) -> it "#{JSON.stringify d}", -> test d

  describe 'write clone', ->
    it 'works if you descend then clone', ->
      w = writeCursor()
      w.descendPath ['a', 'b', 'c']
      w2 = w.clone()
      w.ascend() for [0...3]
      w2.write('i', 5)

      assert.deepStrictEqual w.get(), ['a', 'b', 'c', i:5]

    it 'works if you clone then descend', ->
      w = writeCursor()
      w.descendPath ['a', 'b', 'c']
      w.write('i', 5)
      w.ascend()

      w2 = w.clone()
      w2.descend('x')
      w2.write('r', true)
      w2.ascend()
      
      w.ascend()
      w.ascend()

      assert.deepStrictEqual w.get(), ['a', 'b', ['c', i:5], ['x', r:true]]

    it 'merges into an empty writer', ->
      w = writeCursor()
      w2 = w.clone()
      w2.write('r', true)
      assert.deepStrictEqual w.get(), [{r:true}]

