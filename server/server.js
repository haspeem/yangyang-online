const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, '..')));

const PORT = process.env.PORT || 3000;

// ========== Room Management ==========
const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

// ========== Game Engine ==========
const DEFAULT_ICONS = ['🐑', '🌹', '🐖', '🍚', '👓', '🐭', '😘', '🍑', '⭐', '💩', '💊', '🎈'];
const OFFSETS = [7, -7, 20, -20, 25, -25, 33, -33, 40, -40];
const ROUNDS = [3, 6, 9, 3, 6, 3, 3, 6, 3];

function randomId(length) {
  return (Math.random() + Date.now()).toString(32).slice(0, length || 6);
}

function generateBoard(config, level) {
  const { base, row, col } = config;
  const icons = DEFAULT_ICONS.slice(0, 2 * level);
  const cards = [];

  for (const icon of icons) {
    const rounds = ROUNDS[Math.floor(Math.random() * ROUNDS.length)];
    for (let k = 0; k < rounds; k++) {
      const offset = OFFSETS[Math.floor(Math.random() * OFFSETS.length)];
      const r = Math.floor(Math.random() * row);
      const c = Math.floor(Math.random() * col);
      cards.push({
        id: randomId(6),
        icon,
        x: Math.max(4, Math.min(col * base - base, c * base + offset)),
        y: Math.max(4, Math.min(row * base - base, r * base + offset)),
        not: true,
        status: 0,
        clear: false,
        display: false
      });
    }
  }

  checkShading(cards, base);
  return cards;
}

function checkShading(cards, base) {
  for (let i = 0; i < cards.length; i++) {
    const cur = cards[i];
    cur.not = true;
    if (cur.status !== 0 || cur.display) continue;
    const x1 = cur.x, y1 = cur.y;
    const x2 = x1 + base, y2 = y1 + base;

    for (let j = i + 1; j < cards.length; j++) {
      const cmp = cards[j];
      if (cmp.status !== 0 || cmp.display) continue;
      const { x, y } = cmp;
      if (!(y + base <= y1 || y >= y2 || x + base <= x1 || x >= x2)) {
        cur.not = false;
        break;
      }
    }
  }
}

function computeSlotPositions(cards, select, base, slotY) {
  let idx = 0;
  for (const icon in select) {
    select[icon].forEach(cardRef => {
      if (!cardRef.display) {
        cardRef.x = idx * base + base / 2 + 4;
        cardRef.y = slotY;
        idx++;
      }
    });
  }
}

function processCardClick(room, socketId, cardIndex) {
  const gs = room.gameState;
  const config = room.config;
  const cards = gs.cards;
  const select = gs.select;
  const { base, maxCount, selectMaxLength, slotY } = config;

  const card = cards[cardIndex];
  if (!card) return { ok: false, reason: 'invalid_card' };
  if (card.status !== 0) return { ok: false, reason: 'already_in_slot' };
  if (card.display) return { ok: false, reason: 'already_cleared' };
  if (card.clear) return { ok: false, reason: 'clearing' };
  if (!card.not) return { ok: false, reason: 'blocked' };

  card.status = 1;

  if (!select[card.icon]) select[card.icon] = [];
  select[card.icon].push(card);

  let eliminated = false;
  let won = false;
  let lost = false;

  if (select[card.icon].length >= maxCount) {
    eliminated = true;
    select[card.icon].forEach(c => { c.clear = true; c.display = true; });
    delete select[card.icon];

    const remaining = cards.filter(c => !c.display).length;
    if (remaining === 0) {
      won = true;
    }
  }

  computeSlotPositions(cards, select, base, slotY);
  checkShading(cards, base);

  const currentSlotLen = Object.values(select).reduce(
    (sum, arr) => sum + arr.filter(c => !c.display).length, 0
  );
  if (currentSlotLen >= selectMaxLength) {
    lost = true;
  }

  return { ok: true, eliminated, won, lost };
}

// ========== Socket.IO ==========
io.on('connection', (socket) => {
  let currentRoomCode = null;

  socket.on('create_room', ({ nickname }) => {
    if (!nickname || !nickname.trim()) {
      socket.emit('error_msg', { message: '请输入昵称' });
      return;
    }

    const code = generateRoomCode();
    const room = {
      code,
      host: socket.id,
      players: new Map(),
      gameState: null,
      currentPlayer: null,
      config: null,
      turnOrder: []
    };

    room.players.set(socket.id, { id: socket.id, nickname: nickname.trim(), isHost: true, ready: false });
    rooms.set(code, room);
    currentRoomCode = code;
    socket.join(code);

    socket.emit('room_created', {
      code,
      players: Array.from(room.players.values())
    });
  });

  socket.on('join_room', ({ code, nickname }) => {
    if (!code || !nickname || !nickname.trim()) {
      socket.emit('error_msg', { message: '请输入房间号和昵称' });
      return;
    }

    const roomCode = code.toUpperCase();
    const room = rooms.get(roomCode);
    if (!room) {
      socket.emit('error_msg', { message: '房间不存在' });
      return;
    }
    if (room.players.size >= 2) {
      socket.emit('error_msg', { message: '房间已满' });
      return;
    }

    room.players.set(socket.id, { id: socket.id, nickname: nickname.trim(), isHost: false, ready: false });
    currentRoomCode = roomCode;
    socket.join(roomCode);

    const players = Array.from(room.players.values());
    socket.emit('player_joined', { players });
    socket.to(roomCode).emit('player_joined', { players });
  });

  socket.on('player_ready', ({ ready }) => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room) return;

    const player = room.players.get(socket.id);
    if (!player) return;
    player.ready = ready;

    const players = Array.from(room.players.values());
    io.to(currentRoomCode).emit('player_ready_update', { players });
  });

  socket.on('start_game', (cfg) => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room) return;

    const host = room.players.get(socket.id);
    if (!host || !host.isHost) return;

    const allReady = room.players.size === 2 && Array.from(room.players.values()).every(p => p.ready);
    if (!allReady) return;

    const base = cfg.base || 48;
    const row = cfg.row || 7;
    const col = cfg.col || 7;
    const roomConfig = {
      base,
      row,
      col,
      maxCount: cfg.maxCount || 3,
      selectMaxLength: cfg.selectMaxLength || 7,
      animationTime: cfg.animationTime || 400,
      maxLevel: cfg.maxLevel || 10,
      slotY: cfg.slotY || (row * base + 16)
    };

    room.config = roomConfig;
    const cards = generateBoard(roomConfig, cfg.level || 1);
    room.gameState = {
      cards,
      select: {},
      level: cfg.level || 1
    };

    const playerIds = Array.from(room.players.keys());
    room.turnOrder = playerIds;
    room.currentPlayer = playerIds[0];

    const players = Array.from(room.players.values());
    io.to(currentRoomCode).emit('game_started', {
      gameState: {
        cards: room.gameState.cards,
        select: room.gameState.select,
        level: room.gameState.level
      },
      players,
      currentPlayer: room.currentPlayer
    });
  });

  socket.on('card_click', ({ cardIndex }) => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room || !room.gameState) return;
    if (room.currentPlayer !== socket.id) return;

    const result = processCardClick(room, socket.id, cardIndex);
    if (!result.ok) {
      socket.emit('error_msg', { message: '非法操作' });
      return;
    }

    if (result.won) {
      const nextLevel = (room.gameState.level || 1) + 1;
      if (nextLevel <= room.config.maxLevel) {
        room.gameState.level = nextLevel;
        room.gameState.cards = generateBoard(room.config, nextLevel);
        room.gameState.select = {};
        room.currentPlayer = room.turnOrder[0];

        io.to(currentRoomCode).emit('level_up', {
          gameState: {
            cards: room.gameState.cards,
            select: room.gameState.select,
            level: room.gameState.level
          },
          currentPlayer: room.currentPlayer,
          nextTurn: room.currentPlayer,
          players: Array.from(room.players.values())
        });
        return;
      }

      const players = Array.from(room.players.values());
      io.to(currentRoomCode).emit('game_over', {
        winner: socket.id,
        winnerNickname: room.players.get(socket.id)?.nickname || '',
        reason: 'all_cleared',
        players
      });
      return;
    }

    if (result.lost) {
      const otherPlayer = room.turnOrder.find(id => id !== socket.id);
      const players = Array.from(room.players.values());
      io.to(currentRoomCode).emit('game_over', {
        winner: otherPlayer,
        winnerNickname: room.players.get(otherPlayer)?.nickname || '',
        reason: 'slot_full',
        players
      });
      return;
    }

    const nextIdx = (room.turnOrder.indexOf(socket.id) + 1) % room.turnOrder.length;
    room.currentPlayer = room.turnOrder[nextIdx];

    const players = Array.from(room.players.values());
    io.to(currentRoomCode).emit('card_clicked', {
      gameState: {
        cards: room.gameState.cards,
        select: room.gameState.select,
        level: room.gameState.level
      },
      nextTurn: room.currentPlayer,
      players
    });
  });

  socket.on('level_continue', () => {
    if (!currentRoomCode) return;
    socket.to(currentRoomCode).emit('level_continue');
  });

  socket.on('level_exit', () => {
    if (!currentRoomCode) return;
    socket.to(currentRoomCode).emit('level_exit');
  });

  socket.on('disconnect', () => {
    if (currentRoomCode) {
      const room = rooms.get(currentRoomCode);
      if (room) {
        room.players.delete(socket.id);
        io.to(currentRoomCode).emit('opponent_disconnected', {
          players: Array.from(room.players.values())
        });

        if (room.players.size === 0) {
          rooms.delete(currentRoomCode);
        }
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`🐑 羊了个羊 联机服务器运行在 http://localhost:${PORT}`);
});
