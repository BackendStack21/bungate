const serverId = process.env.SERVER_ID || 'unknown'
const port = parseInt(process.env.SERVER_PORT || '8080')

let requestCount = 0
let startTime = Date.now()

const server = Bun.serve({
  port,
  fetch(req) {
    requestCount++
    const url = new URL(req.url)
    const now = Date.now()

    // Health endpoint
    if (url.pathname === '/health') {
      return new Response('OK', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      })
    }

    // Echo endpoint with server info
    const response = {
      server_id: serverId,
      request_count: requestCount,
      uptime_ms: now - startTime,
      timestamp: now,
      method: req.method,
      url: req.url,
      headers: Object.fromEntries(req.headers.entries()),
      remote_addr: req.headers.get('x-forwarded-for') || 'unknown',
    }

    return new Response(JSON.stringify(response, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        Server: `echo-server-${serverId}`,
        'X-Request-Count': requestCount.toString(),
        'X-Server-Id': serverId,
      },
    })
  },
})

console.log(`Echo server ${serverId} running on http://localhost:${port}`)

// Graceful shutdown
process.on('SIGINT', () => {
  console.log(`\nShutting down echo server ${serverId}...`)
  console.log(`Total requests handled: ${requestCount}`)
  console.log(`Uptime: ${(Date.now() - startTime) / 1000}s`)
  server.stop()
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.log(`\nShutting down echo server ${serverId}...`)
  console.log(`Total requests handled: ${requestCount}`)
  console.log(`Uptime: ${(Date.now() - startTime) / 1000}s`)
  server.stop()
  process.exit(0)
})
