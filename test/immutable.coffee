assert = require 'assert'
{type} = require '../lib/json1'
log = require '../lib/log'
genOp = require './genOp'
deepClone = require '../lib/deepClone'

# This tests that none of apply / compose / transform / genOp mutate their
# input

describe 'immutable guarantees', ->
  origDoc = {x:"hi", y:'omg', z:[1,'whoa',3]}
  expectDoc = deepClone origDoc
  n = 1000
  this.slow n*10

  it 'apply does not mutate', ->
    for [1..n]
      [op, doc] = genOp origDoc
      assert.deepStrictEqual origDoc, expectDoc

      expectOp = deepClone op
      type.apply origDoc, op

      assert.deepStrictEqual origDoc, expectDoc
      assert.deepStrictEqual op, expectOp

  it 'compose does not mutate', ->
    for [1..n]
      [op1, doc] = genOp origDoc
      [op2, doc] = genOp doc

      expectOp1 = deepClone op1
      expectOp2 = deepClone op2
      type.compose op1, op2

      assert.deepStrictEqual op1, expectOp1
      assert.deepStrictEqual op2, expectOp2

  it 'transform does not mutate', ->
    for [1..n]
      [op1, doc1] = genOp origDoc
      [op2, doc2] = genOp origDoc

      expectOp1 = deepClone op1
      expectOp2 = deepClone op2

      type.transformNoConflict op1, op2, 'left'
      type.transformNoConflict op2, op1, 'right'
      assert.deepStrictEqual op1, expectOp1
      assert.deepStrictEqual op2, expectOp2
