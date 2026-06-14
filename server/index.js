const express = require('express')
const { createServer } = require('http')
const { Server } = require('socket.io')
const { v4: uuidv4 } = require('uuid')

const app = express()
const httpServer = createServer(app)

const io = new Server(httpServer, {
  cors: {
    // in prod, lock this down to your actual frontend URL
    origin: '*',
    methods: ['GET', 'POST']
  }
})

const PORT = process.env.PORT || 3001

// basic health check so Render knows the service is alive
app.get('/', (req, res) => res.send('PeerDrop signaling server is running'))

io.on('connection', (socket) => {
  console.log('socket connected:', socket.id)

  // sender drops a file → we create a room and hand them an ID
  socket.on('create-room', () => {
    const roomId = uuidv4()
    socket.join(roomId)
    socket.emit('room-created', { roomId })
    console.log('room created:', roomId)
  })

  // receiver opens the share link → joins the room
  socket.on('join-room', ({ roomId }) => {
    const room = io.sockets.adapter.rooms.get(roomId)

    if (!room) {
      socket.emit('room-error', { message: 'Room not found — the link may have expired.' })
      return
    }

    if (room.size >= 2) {
      socket.emit('room-error', { message: 'Room is full — only 1-to-1 transfers supported.' })
      return
    }

    socket.join(roomId)
    socket.emit('joined-room', { roomId })

    // tell the sender their peer has arrived
    socket.to(roomId).emit('peer-joined')
    console.log('peer joined room:', roomId)
  })

  // relay WebRTC signals between peers
  // this server NEVER reads signal content — it just forwards it
  socket.on('signal', ({ roomId, signal }) => {
    socket.to(roomId).emit('signal', { signal })
  })

  // when a socket disconnects, tell the other person in their room
  socket.on('disconnecting', () => {
    socket.rooms.forEach((roomId) => {
      if (roomId !== socket.id) {
        socket.to(roomId).emit('peer-left')
        console.log('peer left room:', roomId)
      }
    })
  })
})

httpServer.listen(PORT, () => {
  console.log(`signaling server running on port ${PORT}`)
})
