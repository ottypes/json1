const { writeCursor, readCursor } = require('../dist/cursor')
const assert = require('assert')

const data = require('fs')
  .readFileSync(__dirname + '/ops.json', 'utf8')
  .split('\n')
  .filter(x => x !== '')
  .map(JSON.parse)

describe('cursors', function() {
  describe('writeCursor duplicates', function() {
    const test = op => {
      const w = writeCursor()

      const f = l => {
        assert(Array.isArray(l))
        let depth = 0
        for (let c of l) {
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

    return data.map(d => (d => it(`${JSON.stringify(d)}`, () => test(d)))(d))
  })

  describe('copy using read cursors', function() {
    const test = op => {
      const r = readCursor(op)
      const w = writeCursor()
      const path = []
      const f = () => {
        const component = r.getComponent()
        if (component) {
          // console.log 'component', component
          for (let k in component) {
            const v = component[k]
            w.write(k, v)
          }
        }

        assert.deepStrictEqual(r.getPath(), path)
        assert.deepStrictEqual(w.getPath(), path)

        const result = []
        for (let k of r) {
          path.push(k)
          w.descend(k)
          f()
          w.ascend()
          result.push(path.pop())
        }
        return result
      }

      f()

      return assert.deepEqual(op, w.get())
    }
    // console.log op
    // console.log w.get()
    return data.map(d => it(`${JSON.stringify(d)}`, () => test(d)))
  })

  return describe('fuzzer', () =>
    it('cleans up position after mergeTree', () => {
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
  const range = []
  const ascending = left < right
  const end = !inclusive ? right : ascending ? right + 1 : right - 1
  for (let i = left; ascending ? i < end : i > end; ascending ? i++ : i--) {
    range.push(i)
  }
  return range
}
