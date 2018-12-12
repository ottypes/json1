// This is a simple logging function which prints things a lot prettier than
// console.log in node. The signature is the same.

module.exports = log
log.quiet = true
log.prefix = 0

function log(...args) {
  if (log.quiet) return

  const {inspect} = require('util')

  const f = a => (typeof a === 'string') ?
    a : inspect(a, {depth:10, colors:true})

  const prefix = Array(log.prefix).fill('  ').join('')
  console.log(prefix + args.map(f).join(' '))
}

