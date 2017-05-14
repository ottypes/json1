const assert = require('assert')
const {type} = require('./index')

const run = module.exports = () => {
  const fuzzer = require('ot-fuzzer')
  const tracer = require('./tracer')(type, require('./genOp'))
  fuzzer(tracer, tracer.genOp, 10000)
}

if (require.main === module) run()
