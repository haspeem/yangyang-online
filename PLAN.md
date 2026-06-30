# 羊了个羊 · 联机协作版改造方案

## 项目状态：✅ 核心代码已写完，可运行测试

启动方式：
```bash
cd server && node index.js
# 打开 http://localhost:3000
# 开两个浏览器窗口测试联机
```

## 一、项目现状

```
📁 yangyang-online
├── index.html          ← 全部游戏（Vue3 CDN，400行单文件）
├── index.css
├── utils/audio.js      ← 音乐控制
├── static/bgm.mp3
├── static/clickBgm.mp3
└── .github/workflows/
```

纯静态页面，无后端，单机单人。

## 二、改造目标

用房间号 + 轮流点击的方式，让两个人协作通关同一个棋盘。

### 联机流程

```
A 点击"创建房间" → 生成6位码  → 把码发给微信/QQ
B 输入6位码加入  → 双方进入游戏
A 操作翻牌/消除  → 发送给服务器 → 服务器执行并同步给 B
轮到 B 操作      → B 翻牌/消除 → 同理同步给 A
交替进行，共享卡槽，直到通关或失败
```

## 三、架构总览

```
┌──────────────────────────────────────────────┐
│               Cloudflare Tunnel               │
│         xxx.trycloudflare.com                 │
└──────────┬─────────────────────────┬──────────┘
           │                         │
     A 的浏览器                  B 的浏览器
  (手机或电脑)                (手机或电脑)
           │                         │
    ┌──────▼─────────────────────────▼──────┐
    │         Node.js 服务器 (你电脑)         │
    │                                        │
    │  Express → HTTP API                    │
    │  Socket.IO → 实时通信                   │
    │  游戏引擎 → 服务端棋盘状态              │
    └────────────────────────────────────────┘
```

## 四、文件结构设计（改造后）

```
📁 yangyang-online
├── client/                    ← 前端（重构后）
│   ├── index.html             ← 入口
│   ├── css/
│   │   └── style.css          ← 主样式
│   ├── js/
│   │   ├── game-core.js       ★ 游戏引擎（核心）
│   │   │   ├── 生成卡片、判定遮挡
│   │   │   ├── 点击处理、三消判定
│   │   │   ├── 输赢判定
│   │   │   └── 导出为纯函数，不依赖 Vue
│   │   ├── vue-app.js         ← Vue 绑定（渲染 + 事件绑定）
│   │   ├── multiplayer.js     ★ 联机模块
│   │   │   ├── Socket.IO 连接
│   │   │   ├── 创建/加入房间
│   │   │   ├── 发送操作指令
│   │   │   └── 接收并执行对方指令
│   │   └── audio.js           ← 音乐控制
│   └── static/
│       ├── bgm.mp3
│       └── clickBgm.mp3
│
├── server/                    ← 后端
│   ├── package.json
│   ├── index.js               ★ 服务器入口
│   │   ├── Express 静态文件服务
│   │   └── Socket.IO 事件处理
│   └── game-room.js           ★ 房间 + 游戏状态管理
│       ├── 创建房间、加入房间
│       ├── 棋盘状态（服务端权威）
│       └── 轮流控制
│
├── PLAN.md
└── README.md
```

## 五、分阶段实施

### 阶段一：后端搭建（半天-1天）

#### 1.1 初始化 Node.js 项目

```bash
mkdir server && cd server
npm init -y
npm install express socket.io cors
```

#### 1.2 `server/index.js` — 服务器入口（~50行）

```
必要功能：
- Express 托管静态文件（client/ 目录）
- Socket.IO 监听连接
- 事件路由到 game-room.js 处理
```

#### 1.3 `server/game-room.js` — 房间系统（~120行）

数据结构：

```js
// 内存中维护所有房间
rooms = {
  "ABC123": {
    code: "ABC123",
    players: [
      { id: socketId1, nickname: "小王", ready: false, turn: false },
      { id: socketId2, nickname: "小李", ready: false, turn: true }
    ],
    gameState: {
      cards: [...],           // 棋盘卡片数组
      select: Map,             // 卡槽状态
      level: 1,
      maxSlots: 7,
      status: "waiting"       // waiting | playing | finished
    },
    currentPlayerIndex: 0     // 当前轮到谁
  }
}
```

Socket 事件清单：

| 事件名 | 方向 | 说明 |
|--------|------|------|
| `create_room` | 客户端→服务器 | 创建房间，返回6位码 |
| `join_room` | 客户端→服务器 | 输入房间号加入 |
| `player_joined` | 服务器→客户端 | 通知双方有人加入 |
| `start_game` | 客户端→服务器 | 房主点击开始 |
| `game_started` | 服务器→客户端 | 下发初始棋盘给双方 |
| `player_action` | 客户端→服务器 | 玩家点击了一张卡片 |
| `action_applied` | 服务器→客户端 | 服务器执行后广播结果 |
| `game_over` | 服务器→客户端 | 通关或失败 |
| `disconnect` | 自动 | 玩家断线，通知对方 |

### 阶段二：前端重构（1-2天）

#### 2.1 抽取游戏引擎 `client/js/game-core.js`

把 `index.html` 中 `setup()` 内的游戏逻辑拆成**纯函数**：

```js
// game-core.js 导出接口（示例）
export function generateCards(config, level)  // 生成棋盘
export function checkOverlap(cards, base)     // 计算遮挡
export function clickCard(cards, select, index, config)  // 点击处理
export function checkMatch(select, maxCount)  // 三消判定
export function checkWin(cards)               // 是否通关
export function checkLose(select, maxSlots)   // 是否失败
```

**关键原则**：不操作 DOM，不依赖 Vue，只处理数据和状态。

#### 2.2 Vue 绑定层 `client/js/vue-app.js`

原来的 `index.html` 的 `setup()` 里只负责：
- 调用 `game-core.js` 的函数
- 将结果渲染到模板
- 绑定点击事件

#### 2.3 联机模块 `client/js/multiplayer.js`

```js
// multiplayer.js 接口
class Multiplayer {
  connect(serverUrl)              // 连接 WebSocket
  createRoom(callback)             // 创建房间
  joinRoom(code, callback)         // 加入房间
  sendAction(cardId)              // 发送操作
  onGameStateUpdate(callback)     // 接收游戏状态
  onTurnChange(callback)          // 轮到我/对方
  onOpponentAction(callback)      // 对方操作（UI展示）
  disconnect()                    // 断开
}
```

### 阶段三：联机游戏逻辑（1-2天）

#### 3.1 创建房间 → 游戏开始

```
A 创建房间 → 收到房间号 "ABC123"
A 把房间号发给 B
B 输入 "ABC123" → 加入房间
A 点击"开始游戏"
服务器生成棋盘，发给 A 和 B
双方进入游戏界面
```

#### 3.2 轮流操作

```
当前轮到 A
A 点击卡片 → 发 'player_action' {cardIndex: 3}
↓
服务器收到：
  1. 校验是否轮到 A
  2. 执行点击逻辑（模拟）
  3. 更新服务端 gameState
  4. 判断是否通关/失败
  5. 切换 currentPlayerIndex
  6. 广播 'action_applied' 给双方（含完整 gameState）
↓
A 和 B 的客户端都用 gameState 更新界面
轮到 B 操作
```

#### 3.3 同步原理

```
服务器是绝对权威。
客户端只做两件事：
  1. 发送自己的操作
  2. 收到状态后渲染

不依赖"两边各自跑然后对结果"。
```

### 阶段四：部署（半天）

#### 4.1 安装 cloudflared

```bash
# 下载 cloudflared
https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
```

#### 4.2 启动服务器 + 隧道

```bash
# 终端1：启动 Node.js
cd server && node index.js
# 输出：Server running on http://localhost:3000

# 终端2：启动隧道
cloudflared tunnel --url http://localhost:3000
# 输出：https://xxx.trycloudflare.com
```

#### 4.3 把地址发给朋友即可

## 六、谁适合写什么代码

| 模块 | 推荐人选 | 原因 |
|------|----------|------|
| **`game-core.js` 游戏引擎** | ✅ Big Packle | 现在 `index.html` 里都是现成的逻辑，他有手就能搬。不需要懂服务端 |
| **`server/` 后端** | ✅ Big Packle | 就是 Express + Socket.IO 增删改查，Google 五分钟能抄出一份能跑的 |
| **`multiplayer.js` 联机模块** | ✅ Big Packle | Socket.IO 客户端 API 和服务器对着抄就行 |
| **`vue-app.js` UI 绑定** | ✅ Big Packle | 现有代码几乎直接拿来改 |
| **容灾、拆弹、兜底** | ✅ **这个 AI（Nemotron 3 Ultra）** | Big Packle 写不动的、报错卡住的、不知道咋设计的，你来问我，我给你代码 |

**结论：Big Packle 一个人能写完。你给他买个奶茶，他两天能跑通。**

## 七、问题预判

| 问题 | 解法 |
|------|------|
| 两边同时抢着点 | 服务端强制轮流，非当前玩家的点击事件被忽略 |
| 延迟高 | 操作指令极小（就一个 cardIndex），走 WebSocket，毫秒级 |
| 断线重连 | 断开后保持房间 30 秒，重连时恢复 gameState |
| Cloudflare Tunnel 不稳定 | 备用方案：免费部署到 Render.com |
| 手机上字太小 | index.html 已有 viewport meta，Capacitor 打包时再微调 |
