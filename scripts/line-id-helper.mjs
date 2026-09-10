import { createHmac, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'

const port = Number(process.env.LINE_WEBHOOK_PORT || 8787)
const channelSecret = process.env.LINE_CHANNEL_SECRET || ''

if (!channelSecret) {
  console.error('Missing LINE_CHANNEL_SECRET environment variable')
  process.exit(1)
}

function validSignature(body, signature) {
  const expected = createHmac('sha256', channelSecret).update(body).digest('base64')
  const left = Buffer.from(expected)
  const right = Buffer.from(signature || '')
  return left.length === right.length && timingSafeEqual(left, right)
}

createServer((request, response) => {
  if (request.method !== 'POST' || request.url !== '/line-webhook') {
    response.writeHead(404).end('Not found')
    return
  }
  const chunks = []
  request.on('data', (chunk) => chunks.push(chunk))
  request.on('end', () => {
    const body = Buffer.concat(chunks)
    if (!validSignature(body, request.headers['x-line-signature'])) {
      response.writeHead(401).end('Invalid signature')
      console.error('Rejected webhook: invalid LINE signature')
      return
    }
    const payload = JSON.parse(body.toString('utf8'))
    for (const event of payload.events || []) {
      console.log(JSON.stringify({ type: event.source?.type, userId: event.source?.userId, groupId: event.source?.groupId, roomId: event.source?.roomId }, null, 2))
    }
    response.writeHead(200, { 'Content-Type': 'text/plain' }).end('OK')
  })
}).listen(port, '127.0.0.1', () => {
  console.log(`LINE ID helper listening at http://127.0.0.1:${port}/line-webhook`)
  console.log('Expose this endpoint through a trusted HTTPS tunnel, then set it as the LINE webhook URL.')
})
