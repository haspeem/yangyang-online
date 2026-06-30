const express = require('express')
const http = require('http')
const { Server } = require('socket.io')
const cors = require('cors')
const path = require('path')
const {
  createRoom, joinRoom, getRoomByPlayerId,
  getOpponent, initGameState, processAction, removeRoom, setReady
} = require('./game-room')

const app = express()
const server = http.createServer(app)
const io = new Server(server, { cors: { origin: '*' } })

app.use(cors())
app.use(express.static(path.join(__dirname, '..', 'client')))

io.on('connection', (socket) => {
  console.log(`[connect] ${socket.id}`)

  socket.on('create_room', ({ nickname }) => {
    const code = createRoom(socket.id, nickname || '玩家')
    socket.join(code)
    socket.emit('room_created', { code })
    console.log(`[room] ${socket.id} created ${code}`)
  })

  socket.on('join_room', ({ code, nickname }) => {
    const codeUpper = code.toUpperCase()
    const result = joinRoom(codeUpper, socket.id, nickname || '玩家')
    if (result.error) {
      socket.emit('error_msg', { message: result.error })
      return
    }
    socket.join(codeUpper)
    const room = getRoomByPlayerId(socket.id)
    io.to(codeUpper).emit('player_joined', { players: room.players })
    console.log(`[room] ${socket.id} joined ${codeUpper}`)
  })

  socket.on('player_ready', ({ ready }) => {
    const room = getRoomByPlayerId(socket.id)
    if (!room) return
    const result = setReady(socket.id, ready)
    if (result) {
      io.to(room.code).emit('player_ready_update', { players: result.players })
    }
  })

  socket.on('start_game', ({ config }) => {
    const room = getRoomByPlayerId(socket.id)
    if (!room || !room.players.find(p => p.id === socket.id && p.isHost)) return

    const slotY = (config.row || 7) * config.base + 16
    const gameState = initGameState({ ...config, slotY })
    room.gameState = gameState
    room.currentPlayerIndex = 0
    room.status = 'playing'

    io.to(room.code).emit('game_started', {
      gameState: sanitizeState(gameState),
      currentPlayer: room.players[0].id,
      players: room.players
    })
    console.log(`[game] ${room.code} started`)
  })

  socket.on('player_action', ({ cardIndex, config }) => {
    const room = getRoomByPlayerId(socket.id)
    if (!room || room.status !== 'playing') return

    const playerIdx = room.players.findIndex(p => p.id === socket.id)
    if (playerIdx !== room.currentPlayerIndex) {
      socket.emit('error_msg', { message: '还没轮到你' })
      return
    }

    const base = config?.base || 48
    const maxCount = config?.maxCount || 3
    const maxSlots = config?.selectMaxLength || 7
    const slotY = config?.slotY || (base * 7 + 16)
    const result = processAction(room.gameState, cardIndex, base, maxCount, maxSlots, slotY)

    if (!result.ok) return

    const selector = room.players[room.currentPlayerIndex]

    if (result.won) {
      room.status = 'finished'
      io.to(room.code).emit('game_over', {
        winner: selector.id,
        winnerNickname: selector.nickname,
        reason: 'win'
      })
      return
    }

    if (result.lost) {
      room.status = 'finished'
      io.to(room.code).emit('game_over', {
        winner: getOpponent(room, selector.id).id,
        winnerNickname: getOpponent(room, selector.id).nickname,
        reason: 'lose'
      })
      return
    }

    room.currentPlayerIndex = room.currentPlayerIndex === 0 ? 1 : 0
    const nextPlayer = room.players[room.currentPlayerIndex]

    io.to(room.code).emit('action_applied', {
      gameState: sanitizeState(room.gameState),
      actionBy: socket.id,
      nextTurn: nextPlayer.id,
      eliminated: result.eliminated
    })
  })

  socket.on('disconnect', () => {
    const room = getRoomByPlayerId(socket.id)
    if (room) {
      const other = getOpponent(room, socket.id)
      if (other) {
        io.to(room.code).emit('opponent_disconnected', { playerId: socket.id })
      }
      removeRoom(room.code)
      console.log(`[room] ${room.code} closed`)
    }
    console.log(`[disconnect] ${socket.id}`)
  })
})

function sanitizeState(gs) {
  if (!gs) return null
  return {
    cards: gs.cards.map(c => ({ ...c })),
    select: { ...gs.select },
    pendingClear: gs.pendingClear ? gs.pendingClear.map(pc => ({ ...pc, indices: [...pc.indices] })) : [],
    level: gs.level,
    status: gs.status
  }
}

const PORT = process.env.PORT || 3000
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
