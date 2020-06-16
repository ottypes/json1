// This is a simple logging function which prints things a lot prettier than
// console.log in node. The signature is the same.

export default function log(...args: any) {
  if (log.quiet) return

  const {inspect} = require('util')

  const f = (a: any) => (typeof a === 'string') ?
    a : inspect(a, {depth:10, colors:true})

  const prefix = Array(log.prefix).fill('  ').join('')
  console.log(prefix + args.map(f).join(' '))
}

log.quiet = true
log.prefix = 0
