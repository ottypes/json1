// This was stolen from ot-text-unicode 's sourcecode. Its copied in full here
// because it won't change much, and because the npm module doesn't export this
// file. TODO: export this from the npm module and delete this.
const {randomInt, randomWord} = require('ot-fuzzer')
const {type} = require('ot-text-unicode')

const emoji = '😅🤖👻🤟💃'

const strToList = s => {
  const list = []
  let i = 0

  while (i < s.length) {
    const code = s.charCodeAt(i)

    if (code >= 0xd800) {
      list.push(s[i] + s[i+1])
      i += 2
    } else list.push(s[i++])
  }

  return list
}


module.exports = function genOp(docStr) {
  docStr = strToList(docStr)
  const initialLen = docStr.length

  const op = []
  let expectedDoc = ''

  const consume = len => {
    expectedDoc += docStr.slice(0, len).join('')
    docStr = docStr.slice(len)
  }

  const addInsert = () => {
    // Insert a random word from the list somewhere in the document
    let word
    const skip = randomInt(Math.min(docStr.length, 5))

    if (randomInt(5)) { // Usually just use normal ascii characters
      word = randomWord() + ' '
    } else {
      const p = randomInt(emoji.length/2)
      word = emoji.slice(p*2, (p*2) + 2)
    }

    op.push(skip)
    consume(skip)

    op.push(word)
    expectedDoc += word
  }

  const addDelete = function() {
    const skip = randomInt(Math.min(docStr.length, 5))

    op.push(skip)
    consume(skip)

    const length = randomInt(Math.min(docStr.length, 10))
    op.push({d:length})
    return docStr = docStr.slice(length)
  }

  while (docStr.length > 0) {
    // If the document is long, we'll bias it toward deletes
    const chance = initialLen > 100 ? 3 : 2
    switch (randomInt(chance)) {
      case 0: addInsert(); break
      case 1: case 2: addDelete(); break
    }
    
    if (randomInt(7) === 0) break
  }

  // The code above will never insert at the end of the document. Its important to do that
  // sometimes.
  if (randomInt(docStr.length === 0 ? 2 : 10) === 0) addInsert()

  expectedDoc += docStr.join('')
  return [type.normalize(op), expectedDoc]
}