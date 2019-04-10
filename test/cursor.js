/*
 * decaffeinate suggestions:
 * DS101: Remove unnecessary use of Array.from
 * DS102: Remove unnecessary code created because of implicit returns
 * DS205: Consider reworking code to avoid use of IIFEs
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
const { writeCursor, readCursor } = require('../lib/cursor')
const assert = require('assert')

const data = require('fs')
  .readFileSync(__dirname + '/ops.json', 'utf8')
  .split('\n')
  .filter(x => x !== '')
  .map(JSON.parse)

describe('cursors', function() {
  describe('writeCursor duplicates', function() {
    const test = function(op) {
      const w = writeCursor()

      var f = function(l) {
        assert(Array.isArray(l))
        let depth = 0
        for (let c of Array.from(l)) {
          if (['string', 'number'].includes(typeof c)) {
            depth++
            w.descend(c)
          } else if (Array.isArray(c)) {
            f(c)
          } else if (typeof c === 'object') {
            for (let k in c) {
              const v = c[k]
              w.write(k, v)
            }
          }
        }

        return __range__(0, depth, false).map(i => w.ascend())
      }

      if (op !== null) {
        f(op)
      }
      return assert.deepEqual(op, w.get())
    }

    return Array.from(data).map(d =>
      (d => it(`${JSON.stringify(d)}`, () => test(d)))(d)
    )
  })

  describe('copy using read cursors', function() {
    const test = function(op) {
      let f
      const r = readCursor(op)
      const w = writeCursor()
      const path = []
      ;(f = function() {
        let component, k
        if ((component = r.getComponent())) {
          // console.log 'component', component
          for (k in component) {
            const v = component[k]
            w.write(k, v)
          }
        }

        assert.deepStrictEqual(r.getPath(), path)
        assert.deepStrictEqual(w.getPath(), path)

        return (() => {
          const result = []
          for (k of r) {
            path.push(k)
            w.descend(k)
            f()
            w.ascend()
            result.push(path.pop())
          }
          return result
        })()
      })()

      return assert.deepEqual(op, w.get())
    }
    // console.log op
    // console.log w.get()
    return Array.from(data).map(d =>
      (d => it(`${JSON.stringify(d)}`, () => test(d)))(d)
    )
  })

  return describe('fuzzer', () =>
    it('cleans up position after mergeTree', function() {
      const a = [1, 'c', { d: 1 }]
      const w = writeCursor(a)

      w.descend(0)

      w.descend('a')
      w.write('p', 1)
      w.ascend()
      w.ascend()

      w.descend(1)
      w.mergeTree([{ r: true }])
      w.descend('b')
      w.write('p', 0) // Crash!
      w.ascend()
      return w.ascend()
    }))
})

function __range__(left, right, inclusive) {
  let range = []
  let ascending = left < right
  let end = !inclusive ? right : ascending ? right + 1 : right - 1
  for (let i = left; ascending ? i < end : i > end; ascending ? i++ : i--) {
    range.push(i)
  }
  return range
}
