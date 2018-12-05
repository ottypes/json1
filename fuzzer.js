const assert = require('assert')
const {type} = require('./index')

const run = module.exports = () => {
  // require('./lib/log').quiet = true
  // type.debug = true
  const fuzzer = require('ot-fuzzer')
  const genOp = require('./genOp')

  const _t = type.typeAllowingConflictsPred(() => true)

  const tracer = require('./tracer')(_t, genOp)
  //fuzzer(tracer, tracer.genOp, 100000)
  fuzzer(_t, genOp, 100000)
}

if (require.main === module) run()
