// This is a simple logging function which prints things a lot prettier than
// console.log in node. The signature is the same.

module.exports = log
log.quiet = false

function log(...args) {
  if (log.quiet) return

  const {inspect} = require('util')

  const f = a => (typeof a === 'string') ?
    a : inspect(a, {depth:5, colors:true})

  console.log(args.map(f).join(' '))
}

