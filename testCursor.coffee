{writeCursor, makeCursor} = require './json1'
assert = require 'assert'

data = require('fs').readFileSync('ops.json', 'utf8').split('\n').filter((x) -> x != '').map(JSON.parse)

describe 'cursors', ->
  describe 'writeCursor duplicates', ->
    test = (op) ->
      {ascend, descend, write, get} = writeCursor()

      f = (l) ->
        assert Array.isArray l
        depth = 0
        for c in l
          if typeof c in ['string', 'number']
            depth++
            descend c
          else if Array.isArray c
            f c
          else if typeof c is 'object'
            for k, v of c
              write k, v

        ascend() for [0...depth]

      f op if op != null
      assert.deepEqual op, get()

    for d in data
      do (d) -> it "#{JSON.stringify d}", -> test d

  describe 'copy using read cursors', ->
    test = (op) ->
      c = makeCursor op
      w = writeCursor()
      do f = ->
        if component = c.getComponent()
          # console.log 'component', component
          w.write k, v for k, v of component

        # console.log 'down'
        return if !c.hasChildren()
        c.descendFirst()
        loop
          # console.log "key: #{c.getKey()}"
          w.descend c.getKey()
          f c
          w.ascend()
          break unless c.nextSibling()
        c.ascend()
        # console.log 'up'

      assert.deepEqual op, w.get()
        # console.log op
        # console.log w.get()
    for d in data
      do (d) -> it "#{JSON.stringify d}", -> test d
