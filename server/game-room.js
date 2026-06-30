const rooms = {}

function generateCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase()
}

function createRoom(playerId, nickname) {
  let code
  do { code = generateCode() } while (rooms[code])

  rooms[code] = {
    code,
    players: [
      { id: playerId, nickname, ready: false, isHost: true }
    ],
    gameState: null,
    currentPlayerIndex: 0,
    status: 'waiting'
  }
  return code
}

function joinRoom(code, playerId, nickname) {
  const room = rooms[code]
  if (!room) return { error: '房间不存在' }
  if (room.players.length >= 2) return { error: '房间已满' }
  if (room.status !== 'waiting') return { error: '游戏已开始' }

  room.players.push({ id: playerId, nickname, ready: false, isHost: false })
  return { ok: true }
}

function setReady(playerId, ready) {
  for (const code in rooms) {
    const room = rooms[code]
    const player = room.players.find(p => p.id === playerId)
    if (player) {
      player.ready = ready
      return { players: room.players }
    }
  }
  return null
}

function getRoomByPlayerId(playerId) {
  for (const code in rooms) {
    const room = rooms[code]
    if (room.players.some(p => p.id === playerId)) return room
  }
  return null
}

function getOpponent(room, playerId) {
  return room.players.find(p => p.id !== playerId)
}

function initGameState(config) {
  const { icons, row, col, base, maxCount, maxSlots, level, slotY } = config
  const cards = []
  const defaultRounds = [3, 6, 9, 3, 6, 3, 3, 6, 3]
  const offsets = [7, -7, 20, -20, 25, -25, 33, -33, 40, -40]

  for (const icon of icons) {
    const rounds = defaultRounds[Math.floor(Math.random() * defaultRounds.length)]
    for (let k = 0; k < rounds; k++) {
      const offset = offsets[Math.floor(Math.random() * offsets.length)]
      const r = Math.floor(Math.random() * row)
      const c = Math.floor(Math.random() * col)
      cards.push({
        id: Math.random().toString(36).slice(2, 8),
        icon,
        x: c * base + offset,
        y: r * base + offset,
        not: true,
        status: 0,
        clear: false,
        display: false
      })
    }
  }

  return { cards, select: {}, pendingClear: [], level, status: 'playing', slotY: slotY || 0 }
}

function checkOverlap(cards, base) {
  for (let i = 0; i < cards.length; i++) {
    const cur = cards[i]
    cur.not = true
    if (cur.status !== 0 || cur.display) continue
    const { x: x1, y: y1 } = cur
    const x2 = x1 + base, y2 = y1 + base
    for (let j = i + 1; j < cards.length; j++) {
      const cmp = cards[j]
      if (cmp.status !== 0 || cmp.display) continue
      const { x, y } = cmp
      if (!(y + base <= y1 || y >= y2 || x + base <= x1 || x >= x2)) {
        cur.not = false
        break
      }
    }
  }
}

function processAction(gameState, cardIndex, base, maxCount, maxSlots, slotY) {
  // 1) Apply any pending eliminations from previous turn
  applyPendingClear(gameState, base, slotY)

  const cards = gameState.cards
  const card = cards[cardIndex]
  if (!card || card.status !== 0 || card.display || !card.not) {
    return { ok: false, reason: 'invalid' }
  }

  card.status = 1

  const selectMap = gameState.select
  const icon = card.icon
  if (!selectMap[icon]) selectMap[icon] = []
  selectMap[icon].push(cardIndex)

  let eliminated = false
  if (selectMap[icon].length >= maxCount) {
    eliminated = true
    const indices = selectMap[icon]
    indices.forEach(idx => { cards[idx].clear = true })
    // Queue elimination — will be applied at start of next turn
    gameState.pendingClear.push({ icon, indices: [...indices] })
    delete selectMap[icon]
  }

  recalcSlotPositions(gameState, base, slotY)
  checkOverlap(cards, base)

  const remaining = cards.filter(c => !c.display)
  const won = remaining.length === 0
  const slotCount = Object.values(selectMap).reduce((sum, arr) => sum + arr.filter(idx => !cards[idx].display).length, 0)
  const lost = slotCount >= maxSlots

  return { ok: true, eliminated, won, lost }
}

function applyPendingClear(gameState, base, slotY) {
  if (!gameState.pendingClear || gameState.pendingClear.length === 0) return
  for (const pc of gameState.pendingClear) {
    pc.indices.forEach(idx => {
      gameState.cards[idx].display = true
    })
  }
  gameState.pendingClear = []
  recalcSlotPositions(gameState, base, slotY)
}

function recalcSlotPositions(gameState, base, slotY) {
  const cards = gameState.cards
  let index = 0
  const sy = slotY || gameState.slotY || 0
  for (const icon in gameState.select) {
    const indices = gameState.select[icon]
    indices.forEach(idx => {
      if (!cards[idx].display) {
        cards[idx].x = index * base + base / 2
        cards[idx].y = sy
        index++
      }
    })
  }
}

function removeRoom(code) {
  delete rooms[code]
}

module.exports = {
  rooms, createRoom, joinRoom, getRoomByPlayerId,
  getOpponent, initGameState, processAction, removeRoom, setReady
}
