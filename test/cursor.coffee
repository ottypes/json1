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
        assert.deepStrictEqual w.getPath(), path

        for k from r
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

  describe 'fuzzer', ->

    it 'cleans up position after mergeTree', ->
      a = [ 1, 'c', { d: 1 } ]
      w = writeCursor(a)

      w.descend(0)
        
      w.descend('a')
      w.write('p', 1)
      w.ascend()
      w.ascend()

      w.descend(1)
      w.mergeTree([{r:true}])
      w.descend('b')
      w.write('p', 0) # Crash!
      w.ascend()
      w.ascend()
