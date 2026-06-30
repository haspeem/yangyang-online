(function () {
  'use strict';

  var socket = null;
  var vm = null;
  var isActive = false;
  var isHost = false;
  var roomCode = '';
  var myNickname = '';
  var oppNickname = '';
  var players = [];
  var isMyTurn = false;
  var gameActive = false;
  var iAmReady = false;
  var gameConfig = null;
  var originalHeader = null;

  function getVm() {
    var el = document.querySelector('#app');
    if (!el || !el.__vue_app__) return null;
    return el.__vue_app__._instance.proxy;
  }

  function init() {
    var check = setInterval(function () {
      vm = getVm();
      if (vm) {
        clearInterval(check);
        injectMultiplayerButton();
      }
    }, 100);
  }

  function getServerUrl() {
    var loc = window.location;
    if (loc.hostname === 'localhost' || loc.hostname === '127.0.0.1') {
      return 'http://localhost:3000';
    }
    return loc.origin;
  }

  // ========== UI Injection ==========

  function injectMultiplayerButton() {
    var header = document.querySelector('#app header');
    if (!header) return;
    var btn = document.createElement('span');
    btn.className = 'btn';
    btn.textContent = '联机模式';
    btn.onclick = showRoomDialog;
    header.appendChild(btn);
  }

  function injectGameStatusBar() {
    var appEl = document.querySelector('#app');
    if (!appEl) return;
    var existing = document.getElementById('mp-status-bar');
    if (existing) existing.remove();

    var bar = document.createElement('div');
    bar.id = 'mp-status-bar';
    bar.className = 'mp-status-bar';
    bar.innerHTML =
      '<div class="mp-bar-left">' +
        '<span class="mp-dot mp-dot-me"></span>' +
        '<span class="mp-name" id="mp-me-name"></span>' +
        '<span class="mp-turn-badge" id="mp-turn-badge">回合</span>' +
      '</div>' +
      '<div class="mp-bar-center" id="mp-room-code"></div>' +
      '<div class="mp-bar-right">' +
        '<span class="mp-dot mp-dot-opp"></span>' +
        '<span class="mp-name" id="mp-opp-name"></span>' +
        '<span class="mp-level-badge" id="mp-level-badge">第1关</span>' +
      '</div>';

    var h1 = appEl.querySelector('h1');
    if (h1) {
      appEl.insertBefore(bar, h1);
    } else {
      appEl.insertBefore(bar, appEl.firstChild);
    }
  }

  function updateStatusBar() {
    document.getElementById('mp-me-name').textContent = myNickname;
    document.getElementById('mp-opp-name').textContent = oppNickname || '等待中';
    document.getElementById('mp-room-code').textContent = roomCode;
    var badge = document.getElementById('mp-turn-badge');
    badge.textContent = isMyTurn ? '回合' : '等待';
    badge.className = 'mp-turn-badge' + (isMyTurn ? '' : ' mp-wait');
    if (vm) {
      document.getElementById('mp-level-badge').textContent = '第' + (vm.level || 1) + '关';
    }
  }

  function hideOriginalHeader(hide) {
    var header = document.querySelector('#app header');
    if (!header) return;
    if (hide) {
      originalHeader = originalHeader || header.style.display;
      header.style.display = 'none';
    } else {
      header.style.display = originalHeader || '';
      originalHeader = null;
    }
  }

  function showH1(show) {
    var h1 = document.querySelector('#app h1');
    if (h1) h1.style.display = show ? '' : 'none';
  }

  // ========== Dialog ==========

  var dialogEl = null;

  function getDialog() {
    if (!dialogEl) {
      dialogEl = document.getElementById('mp-dialog');
      if (!dialogEl) {
        dialogEl = document.createElement('div');
        dialogEl.id = 'mp-dialog';
        dialogEl.className = 'mp-overlay';
        dialogEl.style.display = 'none';
        document.body.appendChild(dialogEl);
      }
    }
    return dialogEl;
  }

  function showRoomDialog() {
    var d = getDialog();
    d.style.display = 'flex';
    d.innerHTML =
      '<div class="mp-dialog-box">' +
        '<div class="mp-dialog-title">🐑 联机模式</div>' +
        '<div class="mp-dialog-body" id="mp-dialog-body">' +
          '<div class="mp-form-group">' +
            '<label>昵称</label>' +
            '<input class="mp-input" id="mp-nickname" placeholder="输入昵称" maxlength="8">' +
          '</div>' +
          '<button class="mp-btn mp-btn-primary" onclick="MultiplayerUI.createRoom()">创建房间</button>' +
          '<div class="mp-divider">或</div>' +
          '<div class="mp-form-group">' +
            '<label>房间号</label>' +
            '<input class="mp-input mp-code-input" id="mp-join-code" placeholder="输入6位房间号" maxlength="6">' +
          '</div>' +
          '<button class="mp-btn mp-btn-secondary" onclick="MultiplayerUI.joinRoom()">加入房间</button>' +
        '</div>' +
        '<button class="mp-btn mp-btn-text" onclick="MultiplayerUI.hide()">取消</button>' +
      '</div>';
  }

  function showWaitingRoom(code) {
    var d = getDialog();
    d.style.display = 'flex';
    roomCode = code;
    renderWaitingRoom();
  }

  function renderWaitingRoom() {
    var d = getDialog();
    if (!d) return;
    d.style.display = 'flex';
    var playersHtml = '';
    for (var i = 0; i < players.length; i++) {
      var p = players[i];
      playersHtml +=
        '<div class="mp-player-card' + (p.ready ? ' mp-ready' : '') + '">' +
          '<div class="mp-avatar">' + (p.isHost ? '🐺' : '🐑') + '</div>' +
          '<div class="mp-player-name">' + p.nickname + '</div>' +
          '<div class="mp-player-role">' + (p.isHost ? '房主' : '玩家') + '</div>' +
          '<div class="mp-ready-badge' + (p.ready ? '' : ' mp-idle') + '">' +
            (p.ready ? '✅ 已准备' : '⏳ 未准备') +
          '</div>' +
        '</div>';
    }

    var readyBtnHtml = iAmReady
      ? '<button class="mp-btn mp-btn-danger" onclick="MultiplayerUI.toggleReady()">取消准备</button>'
      : '<button class="mp-btn mp-btn-primary" onclick="MultiplayerUI.toggleReady()">准备</button>';

    var startBtnHtml = '';
    if (isHost) {
      var allReady = players.length === 2 && players.every(function (p) { return p.ready; });
      if (allReady) {
        startBtnHtml = '<button class="mp-btn mp-btn-success" onclick="MultiplayerUI.startGame()">开始游戏</button>';
      }
    }

    d.innerHTML =
      '<div class="mp-dialog-box">' +
        '<div class="mp-dialog-title">房间 ' + code + '</div>' +
        '<div class="mp-dialog-body">' +
          '<div class="mp-players-row">' + playersHtml + '</div>' +
          '<div class="mp-hint">' +
            (players.length < 2 ? '等待好友加入...<br>将房间号发给好友' :
              isHost ? '双方已准备，可以开始了' : '等待房主开始游戏') +
          '</div>' +
          readyBtnHtml +
          startBtnHtml +
        '</div>' +
        '<button class="mp-btn mp-btn-text" onclick="MultiplayerUI.leaveRoom()">退出房间</button>' +
      '</div>';
  }

  function hideDialog() {
    var d = getDialog();
    if (d) d.style.display = 'none';
  }

  // ========== Socket ==========

  function connect(cb) {
    if (socket && socket.connected) {
      if (cb) cb();
      return;
    }
    socket = io(getServerUrl(), { transports: ['websocket', 'polling'] });
    socket.on('connect', function () {
      if (cb) cb();
    });
    socket.on('disconnect', function () {
      alert('与服务器断开连接');
      resetGame();
    });
    socket.on('error_msg', function (data) {
      alert(data.message);
    });
  }

  function setupGameListeners() {
    socket.on('game_started', function (data) {
      gameActive = true;
      isMyTurn = data.currentPlayer === socket.id;
      players = data.players;
      oppNickname = (data.players.find(function (p) { return p.id !== socket.id; }) || {}).nickname || '';
      myNickname = (data.players.find(function (p) { return p.id === socket.id; }) || {}).nickname || '';
      gameConfig = data.gameState.config || gameConfig;

      hideDialog();
      applyGameState(data.gameState);
      hideOriginalHeader(true);
      showH1(false);
      injectGameStatusBar();
      updateStatusBar();
      setupClickInterceptor();
    });

    socket.on('card_clicked', function (data) {
      applyGameState(data.gameState);
      isMyTurn = data.nextTurn === socket.id;
      players = data.players;
      if (data.players) {
        oppNickname = (data.players.find(function (p) { return p.id !== socket.id; }) || {}).nickname || '';
      }
      updateStatusBar();
    });

    socket.on('game_over', function (data) {
      gameActive = false;
      var iWon = data.winner === socket.id;
      var msg = iWon ? '🎉 协作通关！' : '😢 ' + data.winnerNickname + ' 操作失误';
      alert(msg);
      resetGame();
    });

    socket.on('opponent_disconnected', function () {
      alert('对方已断开连接');
      resetGame();
    });
  }

  // ========== Game State ==========

  var eliminationTimers = [];
  var animatingIndices = [];

  function applyGameState(gameState) {
    if (!vm) return;
    if (!gameState || !gameState.cards) return;

    eliminationTimers.forEach(function (t) { clearTimeout(t); });
    eliminationTimers = [];

    var eliminatedIndices = [];

    gameState.cards.forEach(function (sc, i) {
      if (i < vm.cards.length) {
        var lc = vm.cards[i];
        if (!lc.display && sc.display && animatingIndices.indexOf(i) === -1) {
          eliminatedIndices.push(i);
        }
        lc.id = sc.id;
        lc.icon = sc.icon;
        lc.x = sc.x;
        lc.y = sc.y;
        lc.not = sc.not;
        lc.status = sc.status;
        lc.clear = sc.clear;
        lc.display = sc.display;
      } else {
        vm.cards.push({
          id: sc.id, icon: sc.icon, x: sc.x, y: sc.y,
          not: sc.not, status: sc.status, clear: sc.clear, display: sc.display
        });
      }
    });

    while (vm.cards.length > gameState.cards.length) {
      vm.cards.pop();
    }

    eliminatedIndices.forEach(function (idx) {
      if (vm.cards[idx]) {
        vm.cards[idx].clear = true;
        vm.cards[idx].display = false;
        if (animatingIndices.indexOf(idx) === -1) {
          animatingIndices.push(idx);
        }
      }
    });

    if (eliminatedIndices.length > 0) {
      var t = setTimeout(function () {
        eliminatedIndices.forEach(function (idx) {
          if (vm.cards[idx]) {
            vm.cards[idx].display = true;
          }
          var pi = animatingIndices.indexOf(idx);
          if (pi !== -1) animatingIndices.splice(pi, 1);
        });
      }, 400);
      eliminationTimers.push(t);
    }

    vm.select.clear();
    if (gameState.select) {
      for (var icon in gameState.select) {
        var arr = [];
        gameState.select[icon].forEach(function (ref) {
          arr.push(ref);
        });
        vm.select.set(icon, arr);
      }
    }

    if (gameState.level) vm.level = gameState.level;
  }

  // ========== Click Interception ==========

  var interceptorActive = false;
  var clickHandler = null;

  function setupClickInterceptor() {
    if (interceptorActive) return;
    interceptorActive = true;

    if (clickHandler) {
      document.removeEventListener('click', clickHandler, true);
    }

    clickHandler = function (e) {
      if (!gameActive || !isMyTurn) return;

      var cardEl = e.target.closest('.card-wrap');
      if (!cardEl) return;

      var container = cardEl.closest('.container');
      if (!container) return;

      var index = Array.prototype.indexOf.call(container.children, cardEl);
      if (index === -1) return;

      e.stopPropagation();

      if (socket) {
        socket.emit('card_click', { cardIndex: index });
      }
    };

    document.addEventListener('click', clickHandler, true);
  }

  // ========== Reset ==========

  function resetGame() {
    gameActive = false;
    isActive = false;
    isHost = false;
    roomCode = '';
    myNickname = '';
    oppNickname = '';
    players = [];
    isMyTurn = false;
    iAmReady = false;
    interceptorActive = false;
    if (clickHandler) {
      document.removeEventListener('click', clickHandler, true);
      clickHandler = null;
    }
    eliminationTimers.forEach(function (t) { clearTimeout(t); });
    eliminationTimers = [];
    animatingIndices = [];

    hideDialog();
    hideOriginalHeader(false);
    showH1(true);
    var bar = document.getElementById('mp-status-bar');
    if (bar) bar.remove();

    if (socket) {
      socket.off('game_started');
      socket.off('card_clicked');
      socket.off('game_over');
      socket.off('opponent_disconnected');
    }
  }

  // ========== Exposed UI Methods ==========

  window.MultiplayerUI = {
    hide: function () {
      if (socket) {
        socket.off('player_joined');
        socket.off('player_ready_update');
        socket.off('game_started');
        socket.off('card_clicked');
        socket.off('game_over');
        socket.off('opponent_disconnected');
        socket.disconnect();
        socket = null;
      }
      hideDialog();
    },

    createRoom: function () {
      var nickname = document.getElementById('mp-nickname');
      if (!nickname || !nickname.value.trim()) {
        alert('请输入昵称');
        return;
      }
      var n = nickname.value.trim();

      connect(function () {
        isActive = true;
        isHost = true;
        myNickname = n;

        socket.emit('create_room', { nickname: n });

        socket.on('room_created', function (data) {
          roomCode = data.code;
          players = data.players;
          setupGameListeners();
          showWaitingRoom(data.code);

          socket.on('player_joined', function (data2) {
            players = data2.players;
            oppNickname = (data2.players.find(function (p) { return p.id !== socket.id; }) || {}).nickname || '';
            renderWaitingRoom();
          });
        });
      });
    },

    joinRoom: function () {
      var codeEl = document.getElementById('mp-join-code');
      var nicknameEl = document.getElementById('mp-nickname');
      if (!codeEl || !codeEl.value.trim()) {
        alert('请输入房间号');
        return;
      }
      if (!nicknameEl || !nicknameEl.value.trim()) {
        alert('请输入昵称');
        return;
      }
      var code = codeEl.value.trim().toUpperCase();
      var n = nicknameEl.value.trim();

      connect(function () {
        isActive = true;
        isHost = false;
        myNickname = n;

        socket.emit('join_room', { code: code, nickname: n });

        socket.on('player_joined', function (data) {
          players = data.players;
          roomCode = code;
          oppNickname = (data.players.find(function (p) { return p.id !== socket.id; }) || {}).nickname || '';
          setupGameListeners();
          showWaitingRoom(code);

          socket.on('player_joined', function (data2) {
            players = data2.players;
            renderWaitingRoom();
          });
        });
      });
    },

    toggleReady: function () {
      iAmReady = !iAmReady;
      if (socket) {
        socket.emit('player_ready', { ready: iAmReady });
      }
    },

    startGame: function () {
      if (!socket) return;
      var lv = 1;
      if (vm) lv = vm.level;
      socket.emit('start_game', {
        level: lv,
        base: 40,
        row: 8,
        col: 8,
        maxCount: 3,
        selectMaxLength: 7,
        animationTime: 400,
        slotY: 8 * 40 + 20
      });
    },

    leaveRoom: function () {
      if (socket) {
        socket.disconnect();
        socket = null;
      }
      resetGame();
    }
  };

  // ========== Start ==========

  init();
})();
