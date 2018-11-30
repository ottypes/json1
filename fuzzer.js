const assert = require('assert')
const {type} = require('./index')

const run = module.exports = () => {
  // require('./lib/log').quiet = true
  type.debug = true
  const fuzzer = require('ot-fuzzer')
  const genOp = require('./genOp')
  const tracer = require('./tracer')(type, genOp)
  //fuzzer(tracer, tracer.genOp, 100000)
  fuzzer(type, genOp, 100000)
}

if (require.main === module) run()
