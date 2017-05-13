# run with mocha --compilers coffee:coffee-script/register --reporter spec --check-leaks

assert = require 'assert'
{type} = require './index'

module.exports = run = ->
  fuzzer = require 'ot-fuzzer'
  tracer = require('./tracer')(type, require './genOp')
  fuzzer tracer, tracer.genOp

run() if require.main == module
