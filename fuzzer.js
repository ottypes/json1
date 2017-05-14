const assert = require('assert')
const {type} = require('./index')

const run = module.exports = () => {
  require('./lib/log').quiet = true
  const fuzzer = require('ot-fuzzer')
  const tracer = require('./tracer')(type, require('./genOp'))
  fuzzer(tracer, tracer.genOp, 100000)
}

if (require.main === module) run()
