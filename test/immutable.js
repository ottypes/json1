const assert = require('assert')
const { type } = require('../dist/json1.release')
const log = require('../dist/log').default
const genOp = require('./genOp')
const deepClone = require('../dist/deepClone').default

// This tests that none of apply / compose / transform / genOp mutate their input
describe('immutable guarantees', function() {
  const origDoc = { x: 'hi', y: 'omg', z: [1, 'whoa', 3] }
  const expectDoc = deepClone(origDoc)
  const n = 1000
  // These tests are only slow in debug mode. In release mode they're pretty snappy.
  this.slow(n * 5)
  this.timeout(n * 10)

  it('apply does not mutate', () => {
    const result = []
    for (let i = 0; i < n; i++) {
      const [op, doc] = genOp(origDoc)
      assert.deepStrictEqual(origDoc, expectDoc)

      const expectOp = deepClone(op)
      try {
        type.apply(origDoc, op)
      } catch (e) {
        console.log(
          [
            'Apply failed! Repro ',
            `apply( ${JSON.stringify(origDoc)}, ${JSON.stringify(op)} )`
          ].join('')
        )
        throw e
      }

      assert.deepStrictEqual(origDoc, expectDoc)
      result.push(assert.deepStrictEqual(op, expectOp))
    }
    return result
  })

  it('compose does not mutate', () => {
    for (let i = 0; i < n; i++) {
      let op2
      let [op1, doc] = genOp(origDoc)
      ;[op2, doc] = genOp(doc)

      const expectOp1 = deepClone(op1)
      const expectOp2 = deepClone(op2)
      type.compose(
        op1,
        op2
      )

      assert.deepStrictEqual(op1, expectOp1)
      assert.deepStrictEqual(op2, expectOp2)
    }
  })

  it('transform does not mutate', () => {
    for (let i = 0; i < n; i++) {
      const [op1, doc1] = genOp(origDoc)
      const [op2, doc2] = genOp(origDoc)

      const expectOp1 = deepClone(op1)
      const expectOp2 = deepClone(op2)

      type.transformNoConflict(op1, op2, 'left')
      type.transformNoConflict(op2, op1, 'right')
      assert.deepStrictEqual(op1, expectOp1)
      assert.deepStrictEqual(op2, expectOp2)
    }
  })
})
