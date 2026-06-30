const GameCore = {
  defaultIcons: ['🐑', '🌹', '🐖', '🍚', '👓', '🐭', '😘', '🍑', '⭐', '💩', '💊', '🎈'],
  offsets: [7, -7, 20, -20, 25, -25, 33, -33, 40, -40],
  rounds: [3, 6, 9, 3, 6, 3, 3, 6, 3],

  randomId(length) {
    return (Math.random() + Date.now()).toString(32).slice(0, length || 6)
  },

  getIcons(level) {
    return this.defaultIcons.slice(0, 2 * level)
  },

  generateBoard(config, level) {
    const { base, row, col } = config
    const icons = this.getIcons(level)
    const cards = []

    for (const icon of icons) {
      const rounds = this.rounds[Math.floor(Math.random() * this.rounds.length)]
      for (let k = 0; k < rounds; k++) {
        const offset = this.offsets[Math.floor(Math.random() * this.offsets.length)]
        const r = Math.floor(Math.random() * row)
        const c = Math.floor(Math.random() * col)
        cards.push({
          id: this.randomId(6),
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

    this.checkShading(cards, base)
    return cards
  },

  checkShading(cards, base) {
    for (let i = 0; i < cards.length; i++) {
      const cur = cards[i]
      cur.not = true
      if (cur.status !== 0 || cur.display) continue
      const x1 = cur.x, y1 = cur.y
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
  },

  clickCard(cards, select, index, config) {
    const { base, maxCount, selectMaxLength, slotY } = config
    const card = cards[index]
    if (!card || card.status !== 0 || card.display || !card.not) return { ok: false }

    card.status = 1

    if (!select[card.icon]) select[card.icon] = []
    select[card.icon].push(index)

    let eliminated = false
    if (select[card.icon].length >= maxCount) {
      eliminated = true
      select[card.icon].forEach(idx => { cards[idx].clear = true })
      delete select[card.icon]
    }

    this.recalcSlots(cards, select, base, slotY || 0)
    this.checkShading(cards, base)

    const slotCount = Object.values(select)
      .reduce((sum, arr) => sum + arr.filter(idx => !cards[idx].display).length, 0)
    const won = cards.filter(c => !c.display).length === 0
    const lost = slotCount >= selectMaxLength

    return { ok: true, eliminated, won, lost }
  },

  applyElimination(cards, select) {
    for (const icon in select) {
      const indices = select[icon]
      indices.forEach(idx => { cards[idx].display = true })
    }
    for (const icon in select) {
      if (select[icon].length >= 3) delete select[icon]
    }
  },

  recalcSlots(cards, select, base, slotY) {
    let idx = 0
    for (const icon in select) {
      select[icon].forEach(i => {
        if (!cards[i].display) {
          cards[i].x = idx * base + base / 2
          cards[i].y = slotY
          idx++
        }
      })
    }
  }
}
