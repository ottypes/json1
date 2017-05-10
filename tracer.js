// This is a simple little OT library which wraps another OT library, but
// traces all calls so you can work out where everything came from.

const type = require('./lib/json1')
const {inspect} = require('util')
const log = require('./lib/log')

const deps = new Map // map from artifact to [...deps]
const meta = new Map // artifact to user information

const printInfo = (item, prefix = '', depth = 7) => {
  log(prefix + 'Item:', item, meta.get(item))

  if (depth > 0) {
    const ds = deps.get(item)
    if (ds == null) return
    log(prefix + 'args:', ...ds)

    ds.forEach(d => printInfo(d, prefix + '  ', depth - 1))
  }
}

module.exports = (type, genOp) => ({
  create(data) { return type.create(data) },

  apply(snapshot, op) {
    try {
      const result = type.apply(snapshot, op)
      deps.set(result, [snapshot, op])
      meta.set(result, 'apply')

      return result
    } catch (e) {
      console.error('************************************* OOPSIE!')
      console.error(e.stack)
      printInfo(snapshot)
      printInfo(op)
      throw e
    }
  },

  transform(op1, op2, side) {
    try {
      const result = type.transform(op1, op2, side)
      deps.set(result, [op1, op2])
      meta.set(result, {from:'transform', side})
      return result
    } catch (e) {
      console.error('************************************* OOPSIE!')
      console.error(e.stack)
      printInfo(op1)
      printInfo(op2)
      throw e
    }

  },

  genOp(snapshot) {
    try {
      const [op, result] = genOp(snapshot)
      deps.set(op, [snapshot])
      deps.set(result, [snapshot])
      meta.set(op, {from:'genop', result})
      meta.set(result, {from:'genop', op})
      return [op, result]
    } catch (e) {
      console.error('************************************* OOPSIE!')
      console.error(e.stack)
      printInfo(snapshot)
      throw e
    }

  },
})

