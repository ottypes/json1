# run with mocha --compilers coffee:coffee-script/register --reporter spec --check-leaks

assert = require 'assert'
{type} = require './index'

describe 'fuzzer', -> it 'runs my sweet!', ->
  fuzzer = require 'ot-fuzzer'
  tracer = require('./tracer')(type, require './genOp')
  fuzzer tracer, tracer.genOp
