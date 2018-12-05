// This is a simple little OT library which wraps another OT library, but
// traces all calls so you can work out where everything came from.

const type = require('./lib/json1')
const {inspect} = require('util')
const log = require('./lib/log')

const deps = new Map // map from artifact to [...deps]
const meta = new Map // artifact to user information

const printInfo = (item, prefix = '', depth = 5) => {
  const m = meta.get(item)
  if (m == null) return log(prefix + 'NO DATA', item)
  log(prefix + m.fn + ' ->', item, m)

  if (depth > 0) {
    const ds = deps.get(item)
    if (ds == null) return
    log(prefix + 'deps:', ...ds)

    ds.forEach(d => printInfo(d, prefix + '  ', depth - 1))
  }
}

module.exports = (type, genOp) => ({
  ...type,
  
  create(data) { return type.create(data) },

  apply(snapshot, op) {
    try {
      const result = type.apply(snapshot, op)
      if (result !== snapshot) {
        deps.set(result, [snapshot, op])
        meta.set(result, {fn:'apply'})
      }

      return result
    } catch (e) {
      console.error('************************************* APPLY FAILED!')
      console.error(e.stack)
      log.quiet = false
      printInfo(snapshot)
      printInfo(op)
      throw e
    }
  },

  transform(op1, op2, side) {
    try {
      const result = type.transform(op1, op2, side)
      if (result !== op1) {
        deps.set(result, [op1, op2])
        meta.set(result, {fn:'transform', side})
      }

      return result
    } catch (e) {
      console.error('************************************* TRANSFORM FAILED!')
      console.error(e.stack)
      log.quiet = false
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
      meta.set(op, {fn:'genop', result})
      meta.set(result, {fn:'genop', op})
      return [op, result]
    } catch (e) {
      console.error('************************************* OOPSIE!')
      console.error(e.stack)
      printInfo(snapshot)
      throw e
    }

  },
})

