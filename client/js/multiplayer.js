class Multiplayer {
  constructor(serverUrl) {
    this.serverUrl = serverUrl
    this.socket = null
    this.roomCode = null
    this.isHost = false
    this.nickname = ''
    this._listeners = {}
  }

  connect() {
    this.socket = io(this.serverUrl, { transports: ['websocket', 'polling'] })
    return this.socket
  }

  createRoom(nickname, cb) {
    this.nickname = nickname
    this.isHost = true
    this.socket.emit('create_room', { nickname })
    this.socket.on('room_created', ({ code }) => {
      this.roomCode = code
      cb(null, code)
    })
    this.socket.on('error_msg', ({ message }) => cb(message, null))
  }

  joinRoom(code, nickname, cb) {
    this.nickname = nickname
    this.isHost = false
    this.socket.emit('join_room', { code, nickname })
    this.socket.on('player_joined', ({ players }) => {
      this.roomCode = code.toUpperCase()
      cb(null, players)
    })
    this.socket.on('error_msg', ({ message }) => cb(message, null))
  }

  startGame(config) {
    this.socket.emit('start_game', { config })
  }

  sendAction(cardIndex, config) {
    this.socket.emit('player_action', { cardIndex, config })
  }

  on(event, cb) {
    this.socket.off(event)
    this.socket.on(event, cb)
  }

  off(event) {
    this.socket.off(event)
  }

  disconnect() {
    if (this.socket) this.socket.disconnect()
  }
}
