// @ts-nocheck
import { Context, Schema, Session, segment, h } from 'koishi'

// 插件元信息
export const name = 'biteme'

export interface Config {}
export const Config: Schema<Config> = Schema.object({})

// 基础类型定义
type CardAnimal = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 // 兔1、蛇2、狐3、狼4、豹5、狮6、熊7、虎8
type SpecialCard = 'hunter' | 'bacteria'
type Card = { kind: 'animal', power: CardAnimal } | { kind: 'special', type: SpecialCard }

interface PlayerState {
  userId: string
  username: string
  seat: number
  hand?: Card // 当前可控的那张牌
  trophy: Card[] // 猎物区（含逃跑路标记用特殊卡表示）
  escapedCount: number // 逃跑标记数量（简单计数表示）
}

interface PendingBrawl {
  targetSeat: number
  starterSeat: number
  responders: Set<number>
  declined: Set<number>
  deadlineAt: number // 时间戳，用于30秒响应
  selectionRequested?: boolean // 是否已提示发起者邀请
  pendingTrophySelection?: { dead: Card, attackers: PlayerState[] } // 待指定战利品归属
}

interface RoomState {
  guildId: string // 群ID
  channelId: string // 频道ID（群）
  hostId: string // 主持人userId
  started: boolean
  deck: Card[] // 牌堆（顶在末尾 pop）
  discard: Card[] // 弃牌堆（暂未使用，但预留）
  players: PlayerState[] // 按座位排序（seat 从1开始）
  turnIndex: number // 当前行动玩家在 players 的下标
  turnDeadlineAt?: number // 本回合3分钟超时时间戳
  turnPaused?: boolean // 回合是否因群殴而暂停
  pendingBrawl?: PendingBrawl // 进行中的群殴
}

// 简单的房间内存表：每个群仅允许一局
const rooms = new Map<string, RoomState>()

function ensureGroup(session: Session) {
  if (!session.guildId) throw new Error('仅支持在群聊内使用该功能。')
}

function getRoomByGuild(guildId: string) {
  return rooms.get(guildId)
}

function requireRoom(session: Session): RoomState {
  ensureGroup(session)
  const room = getRoomByGuild(session.guildId!)
  if (!room) throw new Error('当前群没有进行中的对局，请先使用【咬我】 建房。')
  return room
}

function isHost(session: Session, room: RoomState) {
  return session.userId === room.hostId
}

function formatCardPublic(card?: Card) {
  if (!card) return '无'
  if (card.kind === 'animal') return `${textOfAnimal(card.power)}`
  if (card.type === 'hunter') return '猎人(9+N)'
  if (card.type === 'bacteria') return '细菌(∞)'
  return '未知'
}

function cardPowerForDisplay(card: Card): string {
  if (card.kind === 'animal') return textOfAnimal(card.power)
  if (card.type === 'hunter') return '猎人(9+N)'
  if (card.type === 'bacteria') return '细菌(∞)'
  return '未知'
}

function textOfAnimal(power: CardAnimal): string {
  const mapping: Record<number, string> = {
    1: '兔(1)',
    2: '蛇(2)',
    3: '狐(3)',
    4: '狼(4)',
    5: '豹(5)',
    6: '狮(6)',
    7: '熊(7)',
    8: '虎(8)',
  }
  return mapping[power]
}

function buildFullDeck(): Card[] {
  const deck: Card[] = []
  const animalPowers: CardAnimal[] = [1, 2, 3, 4, 5, 6, 7, 8]
  for (const p of animalPowers) {
    for (let i = 0; i < 5; i++) deck.push({ kind: 'animal', power: p })
  }
  deck.push({ kind: 'special', type: 'hunter' })
  deck.push({ kind: 'special', type: 'bacteria' })
  return shuffle(deck)
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function findPlayerBySeat(room: RoomState, seat: number) {
  return room.players.find(p => p.seat === seat)
}

function currentPlayer(room: RoomState) {
  return room.players[room.turnIndex]
}

function deckRemains(room: RoomState) {
  return `${room.deck.length} / 42`
}

function isPlayerTurn(session: Session, room: RoomState) {
  return currentPlayer(room).userId === session.userId
}

function advanceTurn(room: RoomState) {
  room.turnIndex = (room.turnIndex + 1) % room.players.length
  room.turnDeadlineAt = Date.now() + 3 * 60 * 1000
  room.turnPaused = false
}

function describeSpecial(card?: Card) {
  if (!card) return '无'
  if (card.kind === 'animal' && card.power === 3) return '逃跑时可以查看全场的动物牌。'
  if (card.kind === 'special') {
    if (card.type === 'hunter') return '点数为9+N，其中N为对手的数量；不能参与群殴、不能逃跑。'
    if (card.type === 'bacteria') return '点数为∞；不能主动进攻、不能参与群殴。'
  }
  return '无'
}

function snapshotOfPlayer(p: PlayerState) {
  const trophies = p.trophy.length === 0 && p.escapedCount === 0
    ? '无'
    : `${p.trophy.map(formatCardPublic).join('、')}${p.trophy.length && p.escapedCount ? '、' : ''}${p.escapedCount ? '逃跑'.repeat(p.escapedCount) : ''}`
  return `你的动物：【${formatCardPublic(p.hand)}】\n=======\n特殊效果：${describeSpecial(p.hand)}\n=======\n你的猎物区：${trophies}`
}

function effectiveHunterPower(opponentCount: number) {
  return 9 + opponentCount
}

function compareInDuel(attacker: Card, defender: Card): 'attacker' | 'defender' {
  // 数值比较：细菌=999；猎人(单挑)=9+1
  const aVal = attacker.kind === 'special' && attacker.type === 'hunter'
    ? effectiveHunterPower(1)
    : attacker.kind === 'special' && attacker.type === 'bacteria'
      ? 999
      : attacker.kind === 'animal'
        ? attacker.power
        : 0
  const dVal = defender.kind === 'special' && defender.type === 'hunter'
    ? effectiveHunterPower(1)
    : defender.kind === 'special' && defender.type === 'bacteria'
      ? 999
      : defender.kind === 'animal'
        ? defender.power
        : 0
  if (aVal === dVal) return 'attacker'
  return aVal > dVal ? 'attacker' : 'defender'
}

async function resolveDuel(ctx: Context, session: Session, room: RoomState, attackerSeat: number, defenderSeat: number) {
  const attacker = findPlayerBySeat(room, attackerSeat)!
  const defender = findPlayerBySeat(room, defenderSeat)!
  if (!attacker.hand || !defender.hand) return
  // 正常比较
  const winner = compareInDuel(attacker.hand, defender.hand)  
  await new Promise(resolve => setTimeout(resolve, 1500))   // 延迟3秒再开始单挑结算
  let res = `${attacker.seat}号与${defender.seat}号单挑结束。\n`
  if (winner === 'attacker') {
    const dead = defender.hand
    defender.hand = undefined
    gainTrophy(room, attacker, dead)
    await session.bot.sendPrivateMessage(attacker.userId, `你胜利，获得一只【${formatCardPublic(dead)}】。`)
    await session.bot.sendPrivateMessage(attacker.userId, snapshotOfPlayer(attacker))
    await session.bot.sendPrivateMessage(defender.userId, `你失败，${attacker.seat}号获得你的【${formatCardPublic(dead)}】。\n你摸了一张新的动物牌。`)
    await drawOneAndNotify(ctx, session, room, defender)
    res = res + `${attacker.seat}号胜利，获得${defender.seat}号的【${formatCardPublic(dead)}】。`
  } else {
    const dead = attacker.hand
    attacker.hand = undefined
    gainTrophy(room, defender, dead)
    await session.bot.sendPrivateMessage(attacker.userId, `你失败，${defender.seat}号获得你的【${formatCardPublic(dead)}】。\n你摸了一张新的动物牌。`)
    await session.bot.sendPrivateMessage(defender.userId, snapshotOfPlayer(defender))
    await session.bot.sendPrivateMessage(defender.userId, `你胜利，获得一只【${formatCardPublic(dead)}】。`)
    await drawOneAndNotify(ctx, session, room, attacker)
    res = res + `${defender.seat}号胜利，获得${attacker.seat}号的【${formatCardPublic(dead)}】。`
  }
  // 公告与回合推进
  await session.send(res)
  const prev = attacker.seat
  advanceTurn(room)
  await session.send(`${prev}号玩家行动结束，请${currentPlayer(room).seat}号玩家 ${segment.at(currentPlayer(room).userId)} 开始行动。\n牌堆剩余：${deckRemains(room)}`)
}

async function resolveBrawl(ctx: Context, session: Session, room: RoomState, starterSeat: number, targetSeat: number, responderSeats: number[]) {
  const starter = findPlayerBySeat(room, starterSeat)!
  const target = findPlayerBySeat(room, targetSeat)!
  const responders = responderSeats.map(s => findPlayerBySeat(room, s)!).filter(Boolean)
  const attackers = [starter, ...responders]
  await new Promise(resolve => setTimeout(resolve, 1500))   // 延迟1.5秒再开始群殴结算
  // 公开卡面
  const openMsg = `群殴：\n进攻方：${attackers.map(p => `${p.seat}号【${formatCardPublic(p.hand)}】`).join('，')}\n防守方：${target.seat}号【${formatCardPublic(target.hand)}】`
  await session.send(openMsg)
  // 细菌按数值999处理，无需特殊分支
  // 计算力量
  const attackerSum = attackers.reduce((sum, p) => sum + valueForBrawl(p.hand, false), 0)
  const defenderVal = valueForBrawl(target.hand, true, attackers.length)
  const attackWin = attackerSum >= defenderVal
  if (attackWin) {
    // 战利品归属：正常为进攻方点数最小者；若目标是猎人，则归进攻方点数最大者
    const dead = target.hand!
    target.hand = undefined
    const owner = chooseTrophyOwner(attackers, dead)
    gainTrophy(room, owner, dead)
    await session.send(`进攻成功，${owner.seat}号获得【${formatCardPublic(dead)}】。`)
    // 群殴失败方（此处只有防守方）先提示摸牌再补牌
    await session.bot.sendPrivateMessage(target.userId, '你摸了一张新的动物牌。')
    await drawOneAndNotify(ctx, session, room, target)
    await session.bot.sendPrivateMessage(owner.userId, snapshotOfPlayer(owner))
  } else {
    // 防守成功：所有进攻者死亡，各自摸一张
    for (const atk of attackers) {
      if (!atk.hand) continue
      const dead = atk.hand
      atk.hand = undefined
      gainTrophy(room, target, dead)
      await session.bot.sendPrivateMessage(atk.userId, '你摸了一张新的动物牌。')
      await drawOneAndNotify(ctx, session, room, atk)
      await session.bot.sendPrivateMessage(target.userId, snapshotOfPlayer(target))
    }
    await session.send(`防守成功，防守方获得所有被击杀的进攻者为猎物。`)
  }
  // 群殴结束，恢复回合计时并推进回合
  room.turnPaused = false
  const prev = starter.seat
  advanceTurn(room)
  await session.send(`${prev}号玩家行动结束，请${currentPlayer(room).seat}号玩家 ${segment.at(currentPlayer(room).userId)} 开始行动。\n牌堆剩余：${deckRemains(room)}`)
}

function valueForBrawl(card: Card | undefined, isDefender: boolean, attackerCount = 0): number {
  if (!card) return 0
  if (card.kind === 'animal') return card.power
  if (card.type === 'bacteria') return 999
  if (card.type === 'hunter') return isDefender ? effectiveHunterPower(attackerCount) : 0 // 猎人不能作为进攻方
  return 0
}

function chooseTrophyOwner(attackers: PlayerState[], dead: Card): PlayerState {
  const isHunter = dead.kind === 'special' && dead.type === 'hunter'
  if (isHunter) {
    // 特例：猎人被群殴时，点数最大者获得
    let best = attackers[0]
    let bestVal = valueForBrawl(best.hand, false)
    for (const p of attackers) {
      const val = valueForBrawl(p.hand, false)
      if (val > bestVal) { best = p; bestVal = val }
    }
    return best
  }
  // 正常：点数最小者
  let best = attackers[0]
  let bestVal = valueForBrawl(best.hand, false)
  for (const p of attackers) {
    const val = valueForBrawl(p.hand, false)
    if (val < bestVal) { best = p; bestVal = val }
  }
  return best
}

function gainTrophy(room: RoomState, owner: PlayerState, card: Card) {
  // 细菌永不进入他人猎物区；但本函数只在胜者获得败者时使用，规则里细菌不会作为猎物
  owner.trophy.push(card)
}

async function drawOneAndNotify(ctx: Context, session: Session, room: RoomState, p: PlayerState) {
  if (room.deck.length === 0) return
  p.hand = room.deck.pop()!
  await session.bot.sendPrivateMessage(p.userId, snapshotOfPlayer(p))
}

function checkGameEndByDeck(room: RoomState) {
  return room.deck.length === 0
}

async function finishAndScore(ctx: Context, session: Session, room: RoomState) {
  const scores = room.players.map(p => ({ seat: p.seat, userId: p.userId, username: p.username, score: calcScore(p) }))
  scores.sort((a, b) => b.score - a.score)
  const lines = scores.map((s, i) => `${i + 1}. ${s.seat}号\t ${s.username}\t${s.score}分`).join('\n')
  await session.send(`牌堆已抓完，游戏结束！\n本局排名：\n${lines}`)
  rooms.delete(room.guildId)
}

function calcScore(p: PlayerState): number {
  let score = 0
  for (const c of p.trophy) {
    if (c.kind === 'animal') score += c.power
    else if (c.type === 'hunter') score += 9
    // 细菌不会进入猎物区
  }
  score -= p.escapedCount
  return score
}

export function apply(ctx: Context, config: Config) {
  // 咬我 建房
  ctx.command('咬我', '开始一局【你咬我啊】桌游').alias('你咬我啊')
    .action(async ({ session }) => {
      try {
        ensureGroup(session!)
        const guildId = session!.guildId!
        if (rooms.has(guildId)) return '本群已有进行中的对局。'
        const room: RoomState = {
          guildId,
          channelId: session!.channelId!,
          hostId: session!.userId!,
          started: false,
          deck: [],
          discard: [],
          players: [{
            userId: session!.userId!,
            username: session!.username!,
            seat: 1,
            hand: undefined,
            trophy: [],
            escapedCount: 0,
          }],
          turnIndex: 0,
        }
        rooms.set(guildId, room)
        return segment.at(session!.userId!) + ' 发起了游戏 你咬我啊，报名扣1（回复数字1加入）。\n主持人为1号座位。'
      } catch (e: any) {
        return e?.message || '建房失败。'
      }
    })

  // 报名：回复“1”加入
  ctx.middleware(async (session, next) => {
    if (!session.guildId) return next()
    const room = getRoomByGuild(session.guildId)
    if (!room || room.started) return next()
    if (session.content?.trim() !== '1') return next()
    // 已满或重复
    if (room.players.some(p => p.userId === session.userId)) {
      return session.send('你已在座位表中。')
    }
    if (room.players.length >= 8) {
      return session.send('人数已满，无法加入。')
    }
    const seat = room.players.length + 1
    room.players.push({ userId: session.userId!, username: session.username!, seat, hand: undefined, trophy: [], escapedCount: 0 })
    await session.send(`加入成功，你的座位号为${seat}。当前人数：${room.players.length}。`)
    return
  })

  // 咬我 开始
  ctx.command('咬我/开始', '开始游戏（3-8人）')
    .action(async ({ session }) => {
      try {
        const room = requireRoom(session!)
        if (!isHost(session!, room)) return '仅主持人可开始游戏。'
        if (room.started) return '游戏已开始。'
        if (room.players.length < 3) return '人数不足（需要3-8人）。'
        // 初始化牌堆并发初始牌
        room.deck = buildFullDeck()
        for (const p of room.players) {
          p.hand = room.deck.pop()
        }
        room.started = true
        room.turnIndex = 0
        room.turnDeadlineAt = Date.now() + 3 * 60 * 1000 // 3分钟
        const seats = room.players.map(p => `${p.seat}号  ${p.username}`).join('\n')
        await session!.send(`游戏开始！\n${seats}\n请1号玩家开始行动。\n牌堆剩余：${deckRemains(room)}`)
        // 私发初始手牌
        for (const p of room.players) {
          await session!.bot.sendPrivateMessage(p.userId, `你的动物：【${formatCardPublic(p.hand)}】\n=======\n特殊效果：${describeSpecial(p.hand)}\n=======\n你的猎物区：无`)
        }
        return
      } catch (e: any) {
        return e?.message || '开始失败。'
      }
    })

  // 咬我 结束（主持人/authority=2）
  ctx.command('咬我/结束', '结束当前对局（主持人或管理员）')
    .action(async ({ session }) => {
      try {
        const room = requireRoom(session!)
        if (!isHost(session!, room) && session!.authority! < 2) return '需要主持人或Bot管理员结束对局。'
        rooms.delete(room.guildId)
        return '本局已结束。'
      } catch (e: any) {
        return e?.message || '结束失败。'
      }
    })

  // 过 / pass
  ctx.command('咬我/过').alias('pass').action(async ({ session }) => {
    try {
      const room = requireRoom(session!)
      if (!room.started) return '游戏未开始。'
      if (!isPlayerTurn(session!, room)) return '当前不是你的回合。'
      // 占位：直接进入下一位
      const prevSeat = currentPlayer(room).seat
      advanceTurn(room)
      const nextSeat = currentPlayer(room).seat
      await session!.send(`${prevSeat}号玩家行动结束，请${nextSeat}号玩家 ${segment.at(currentPlayer(room).userId)} 开始行动。\n牌堆剩余：${deckRemains(room)}`)
      return
    } catch (e: any) {
      return e?.message || '操作失败。'
    }
  })

  // 单挑 <座位号>
  ctx.command('咬我/单挑 <seat:number>', '对指定座位发起单挑').alias('咬').action(async ({ session }, seat) => {
    try {
      const room = requireRoom(session!)
      if (!room.started) return '游戏未开始。'
      if (!isPlayerTurn(session!, room)) return '当前不是你的回合。'
      if (!seat || seat < 1 || seat > room.players.length) return '目标座位无效。'
      if (seat === currentPlayer(room).seat) return '不能对自己发起单挑。'
      const me = currentPlayer(room)
      const target = findPlayerBySeat(room, seat)!
      // 细菌或猎人等限制校验
      if (me.hand?.kind === 'special' && me.hand.type === 'bacteria') return '你不能主动进攻。'
      if (!me.hand || !target.hand) return '有玩家没有可用的卡牌。'
      await session!.bot.sendPrivateMessage(me.userId, `你对${target.seat}号发起了单挑。\n对方的卡牌是：【${cardPowerForDisplay(target.hand)}】`)
      await session!.bot.sendPrivateMessage(target.userId, `${me.seat}号对你发起了单挑。\n对方的卡牌是：【${cardPowerForDisplay(me.hand)}】`)
      // 结算
      await resolveDuel(ctx, session!, room, me.seat, target.seat)
      if (checkGameEndByDeck(room)) {
        await finishAndScore(ctx, session!, room)
      }
      return
    } catch (e: any) {
      return e?.message || '单挑失败。'
    }
  })

  // 群殴 <座位号>
  ctx.command('咬我/群殴 <seat:number>', '对指定座位发起群殴').action(async ({ session }, seat) => {
    try {
      const room = requireRoom(session!)
      if (!room.started) return '游戏未开始。'
      if (!isPlayerTurn(session!, room)) return '当前不是你的回合。'
      if (room.pendingBrawl) return '已有进行中的群殴。'
      if (!seat || seat < 1 || seat > room.players.length) return '目标座位无效。'
      if (seat === currentPlayer(room).seat) return '不能对自己发起群殴。'
      const starter = currentPlayer(room)
      if (starter.hand && starter.hand.kind === 'special' && starter.hand.type === 'bacteria') return '细菌不能发起群殴。'
      if (starter.hand && starter.hand.kind === 'special' && starter.hand.type === 'hunter') return '猎人不能发起群殴。'
      // 暂停回合计时
      room.turnPaused = true
      room.pendingBrawl = {
        targetSeat: seat,
        starterSeat: starter.seat,
        responders: new Set<number>(),
        declined: new Set<number>(),
        deadlineAt: Date.now() + 60 * 1000,
        selectionRequested: false,
      }
      await session!.send(`${starter.seat}号对${seat}号发起群殴，是否响应？\n请在1分钟内回复【响应/参加】参与，或【不响应/不参加】放弃。`)
      
      // 设置超时自动结算
      setTimeout(async () => {
        const currentRoom = getRoomByGuild(room.guildId)
        if (!currentRoom || !currentRoom.pendingBrawl) return
        const pb = currentRoom.pendingBrawl
        if (pb.starterSeat !== starter.seat || pb.targetSeat !== seat) return // 确保是同一个群殴
        
        // 超时自动结算
        const others = currentRoom.players.filter(p => p.seat !== pb.starterSeat && p.seat !== pb.targetSeat)
        const allDecided = others.every(p => pb.responders.has(p.seat) || pb.declined.has(p.seat))
        if (!allDecided) {
          // 还有玩家未表态，自动标记为不参加
          for (const p of others) {
            if (!pb.responders.has(p.seat) && !pb.declined.has(p.seat)) {
              pb.declined.add(p.seat)
            }
          }
        }
        
        // 执行群殴结算
        await tryResolveBrawlNow(ctx, session!, currentRoom)
      }, 60 * 1000) // 1分钟后执行
      
      return
    } catch (e: any) {
      return e?.message || '群殴失败。'
    }
  })

  // 响应 / 参加
  ctx.command('咬我/响应').alias('参加').action(async ({ session }) => {
    try {
      const room = requireRoom(session!)
      if (!room.started) return '游戏未开始。'
      const pb = room.pendingBrawl
      if (!pb) return '当前没有可响应的群殴。'
      if (Date.now() > pb.deadlineAt) return '响应已超时。'
      const ps = room.players.find(p => p.userId === session!.userId)
      if (!ps) return '你不在本局对局中。'
      if (ps.seat === pb.starterSeat || ps.seat === pb.targetSeat) return '发起进攻方和防守方不能响应。'
      if (ps.hand && ps.hand.kind === 'special' && ps.hand.type === 'bacteria') return '细菌不能响应群殴。'
      if (ps.hand && ps.hand.kind === 'special' && ps.hand.type === 'hunter') return '猎人不能响应群殴。'
      if (pb.responders.has(ps.seat)) return '你已响应。'
      if (pb.declined.has(ps.seat)) pb.declined.delete(ps.seat)
      pb.responders.add(ps.seat)
      // 即时结算检查
      await session!.send(`${ps.seat}号加入了群殴。`)
      await tryResolveBrawlNow(ctx, session!, room)
      return 
    } catch (e: any) {
      return e?.message || '响应失败。'
    }
  })

  // 不响应 / 不参加
  ctx.command('咬我/不响应').alias('不参加').action(async ({ session }) => {
    try {
      const room = requireRoom(session!)
      if (!room.started) return '游戏未开始。'
      const pb = room.pendingBrawl
      if (!pb) return '当前没有可响应的群殴。'
      const ps = room.players.find(p => p.userId === session!.userId)
      if (!ps) return '你不在本局对局中。'
      if (ps.seat === pb.starterSeat || ps.seat === pb.targetSeat) return '发起进攻方和防守方不能放弃。'
      pb.responders.delete(ps.seat)
      pb.declined.add(ps.seat)
      // 即时结算检查
      await tryResolveBrawlNow(ctx, session!, room)
      return `${ps.seat}号选择了不参加。`
    } catch (e: any) {
      return e?.message || '操作失败。'
    }
  })

  // 邀请
  ctx.command('咬我/邀请 <s1:number> [s2:number]', '发起者从响应者中点1-2人参与群殴').action(async ({ session }, s1, s2) => {
    try {
      const room = requireRoom(session!)
      if (!room.started) return '游戏未开始。'
      const pb = room.pendingBrawl
      if (!pb) return '当前没有进行中的群殴。'
      const starter = findPlayerBySeat(room, pb.starterSeat)!
      if (session!.userId !== starter.userId) return '仅发起者可邀请。'
      const choices = [s1, s2].filter(Boolean)
      if (choices.length === 0 || choices.length > 2) return '请邀请1-2位响应者。'
      for (const s of choices) {
        if (!pb.responders.has(s)) return `座位${s}未响应，无法邀请。`
      }
      // 结算指定的2人（或1人）
      room.pendingBrawl = undefined
      await resolveBrawl(ctx, session!, room, pb.starterSeat, pb.targetSeat, choices as number[])
      if (checkGameEndByDeck(room)) await finishAndScore(ctx, session!, room)
      return
    } catch (e: any) {
      return e?.message || '邀请失败。'
    }
  })

  // 逃跑
  ctx.command('咬我/逃跑', '将当前动物扣在猎物区，并摸一张新牌').action(async ({ session }) => {
    try {
      const room = requireRoom(session!)
      if (!room.started) return '游戏未开始。'
      if (!isPlayerTurn(session!, room)) return '当前不是你的回合。'
      const me = currentPlayer(room)
      if (!me.hand) return '你没有可逃跑的卡牌。'
      if (me.hand.kind === 'special' && me.hand.type === 'hunter') return '猎人不能逃跑。'
      // 扣置逃跑
      me.escapedCount += 1
      const escapedCard = me.hand
      me.hand = undefined
      // 狐(3)逃跑技能：查看在场所有玩家当前动物（仅私聊给逃跑者）
      if (escapedCard.kind === 'animal' && escapedCard.power === 3) {
        await session.send(`狡黠的狐狸脚底抹油，查看了所有玩家的动物牌。`)
        const details = room.players.map(p => `${p.seat}号：${formatCardPublic(p.hand)}`).join('\n')
        await session!.bot.sendPrivateMessage(me.userId, `你发动了狐狸技能：\n${details}`)
      }
      // 摸牌
      if (room.deck.length > 0) {
        me.hand = room.deck.pop()!
        await session!.bot.sendPrivateMessage(me.userId, snapshotOfPlayer(me))
        if (checkGameEndByDeck(room)) {
          await finishAndScore(ctx, session!, room)
          return
        }
      } else {
        await finishAndScore(ctx, session!, room)
        return
      }
      // 结束回合
      const prevSeat = me.seat
      advanceTurn(room)
      await session!.send(`${prevSeat}号玩家行动结束，请${currentPlayer(room).seat}号玩家 ${segment.at(currentPlayer(room).userId)} 开始行动。\n牌堆剩余：${deckRemains(room)}`)
      return
    } catch (e: any) {
      return e?.message || '逃跑失败。'
    }
  })

  ctx.middleware(async (session, next) => {
    if (!session.guildId) return next()
    const room = getRoomByGuild(session.guildId)
    if (!room || !room.started) return next()
    if (!room.turnDeadlineAt) return next()
    if (room.turnPaused) return next() // 回合暂停时不检查超时
    if (Date.now() < room.turnDeadlineAt) return next()
    // 超时自动pass
    const cur = currentPlayer(room)
    room.turnDeadlineAt = undefined
    advanceTurn(room)
    await session.send(`玩家${cur.seat}号超时，视为过。请${currentPlayer(room).seat}号玩家 ${segment.at(currentPlayer(room).userId)} 开始行动。\n牌堆剩余：${deckRemains(room)}`)
    return next()
  })

  // 群殴响应窗口轮询处理（到期自动结算或按单挑处理）
  ctx.middleware(async (session, next) => {
    if (!session.guildId) return next()
    const room = getRoomByGuild(session.guildId)
    if (!room || !room.started) return next()
    const pb = room.pendingBrawl
    if (!pb) return next()
    // 如果所有其他玩家均已表态（响应或不参加），或超时，进入邀请或结算逻辑
    const others = room.players.filter(p => p.seat !== pb.starterSeat && p.seat !== pb.targetSeat)
    const allDecided = others.every(p => pb.responders.has(p.seat) || pb.declined.has(p.seat))
    const timedOut = Date.now() >= pb.deadlineAt
    if (!allDecided && !timedOut) return next()
    // 截止或已全部表态
    const starter = findPlayerBySeat(room, pb.starterSeat)!
    const target = findPlayerBySeat(room, pb.targetSeat)!
    if (pb.responders.size === 0) {
      // 无人响应，按单挑
      room.pendingBrawl = undefined
      room.turnPaused = false // 恢复回合计时
      await session.send(`无人响应，按单挑处理。`)
      await new Promise(resolve => setTimeout(resolve, 500))

      await session!.bot.sendPrivateMessage(starter.userId, `你对${target.seat}号发起了单挑。\n对方的卡牌是：【${cardPowerForDisplay(target.hand)}】`)
      await session!.bot.sendPrivateMessage(target.userId, `${starter.seat}号对你发起了单挑。\n对方的卡牌是：【${cardPowerForDisplay(starter.hand)}】`)
      await resolveDuel(ctx, session, room, starter.seat, target.seat)
      if (checkGameEndByDeck(room)) await finishAndScore(ctx, session, room)
      return next()
    }
    // 响应超过1人
    if (pb.responders.size > 1) {
      const list = Array.from(pb.responders.values())
      if (timedOut) {
        // 超时自动取前两位
        room.pendingBrawl = undefined
        await resolveBrawl(ctx, session, room, starter.seat, target.seat, list.slice(0, 2))
        if (checkGameEndByDeck(room)) await finishAndScore(ctx, session, room)
      } else {
        if (!pb.selectionRequested) {
          pb.selectionRequested = true
          await session.send(`${starter.seat}号，请选择队友（最多2人）：使用指令【邀请 A B】。可选：${list.join('、')}`)
        }
      }
      return next()
    }
    // 响应1人则直接结算群殴
    const responders = Array.from(pb.responders.values())
    room.pendingBrawl = undefined
    await resolveBrawl(ctx, session, room, starter.seat, target.seat, responders)
    if (checkGameEndByDeck(room)) await finishAndScore(ctx, session, room)
    return next()
  })

  // 辅助：即时尝试结算群殴（在 响应/不响应 后调用）
  async function tryResolveBrawlNow(ctx: Context, session: Session, room: RoomState) {
    const pb = room.pendingBrawl
    if (!pb) return
    const starter = findPlayerBySeat(room, pb.starterSeat)!
    const target = findPlayerBySeat(room, pb.targetSeat)!
    const others = room.players.filter(p => p.seat !== pb.starterSeat && p.seat !== pb.targetSeat)
    const allDecided = others.every(p => pb.responders.has(p.seat) || pb.declined.has(p.seat))
    if (!allDecided) return
    if (pb.responders.size === 0) {
      // 无人响应，按单挑
      room.pendingBrawl = undefined
      room.turnPaused = false // 恢复回合计时
      await session.send(`无人响应，按单挑处理。`)
      await new Promise(resolve => setTimeout(resolve, 500))

      await session!.bot.sendPrivateMessage(starter.userId, `你对${target.seat}号发起了单挑。\n对方的卡牌是：【${cardPowerForDisplay(target.hand)}】`)
      await session!.bot.sendPrivateMessage(target.userId, `${starter.seat}号对你发起了单挑。\n对方的卡牌是：【${cardPowerForDisplay(starter.hand)}】`)
      await resolveDuel(ctx, session, room, starter.seat, target.seat)
      if (checkGameEndByDeck(room)) await finishAndScore(ctx, session, room)
      return
    }
    if (pb.responders.size > 1) {
      if (!pb.selectionRequested) {
        pb.selectionRequested = true
        const list = Array.from(pb.responders.values()).join('、')
        await session.send(`${starter.seat}号，请选择队友（最多2人）：使用指令【邀请 A B】。可选：${list}`)
      }
      return
    }
    // 1人，直接结算
    const responders = Array.from(pb.responders.values())
    room.pendingBrawl = undefined
    await resolveBrawl(ctx, session, room, starter.seat, target.seat, responders)
    if (checkGameEndByDeck(room)) await finishAndScore(ctx, session, room)
  }

  ctx.command('咬我/你咬我啊规则').alias('你咬我啊说明').alias('咬我规则').alias('咬我说明')
    .action(async ({ session }) => {
      const result = 
        `这是桌游《你咬我啊》的Koishi移植版。

【重要的事情说三遍】游戏开始前，请确认已添加Bot好友！
游戏开始前，请确认已添加Bot好友！
游戏开始前，请确认已添加Bot好友！

游戏参与人数为3-8人。一共有42张卡牌，其中有8种动物，每种5张。每种动物有战斗力点数，分别是兔(1)、蛇(2)、狐(3)、狼(4)、豹(5)、狮(6)、熊(7)、虎(8)。动物卡牌一共有5*8=40张。另外还有两张特殊牌，分别是猎人(9+N)、细菌(∞)。

游戏规则类似斗兽棋，简单来说就是大吃小。比如虎能吃兔，兔不能吃虎。
每个玩家面前有两个区域，一个是自己的动物，还有一个猎物区。战胜的对手和己方逃跑的动物都放在猎物区，用于最后计分。
游戏开始时，每人抽一张卡牌，作为自己的动物，只有自己能看到。

每个玩家的回合，可以进行四选一的行动：
（1）过/pass。
（2）单挑（大吃小）。A对B使用指令“单挑 B”，双方交换卡牌查看。点数大的动物胜利，如果点数相同，进攻方胜利。单挑胜利方将打到的猎物公开展示。
单挑失败的玩家摸一张新的动物牌。
（3）群殴（小吃大）。A对B使用指令“群殴 B”，询问在场除A、B外的所有玩家，是否响应群殴。响应时间为半分钟，除发起者和被攻击者，其他玩家发送“响应/参加”或“不响应/不参加”决定是否加入群殴。超时视为不响应。
最多有1-2个其他玩家参与响应，如果超过1个玩家响应，由发起者A邀请某几个玩家参与（指令是“邀请 C D”）。群殴的发起者、被攻击者、参与者翻开自己的动物牌（和单挑不同，这里全场都能看到他们的动物）。如果进攻方点数总和≥防守方点数，进攻方胜利，否则防守方胜利。
进攻方胜利，进攻方点数最小的获得猎物。如果多个玩家都是点数最小的进攻方，由群殴的发起者指定谁获得猎物。
防守方胜利，获得所有进攻的动物作为猎物。
群殴失败的玩家摸一张新的动物牌。
（4）逃跑。将你的动物扣置在猎物区，最终计分的时候-1分。并摸一张新的动物牌。

当牌堆中最后一张牌被摸走后，游戏立刻结束。所有玩家统计猎物区的分数。猎物区的每个动物按1~8得分。如果有己方逃跑的动物，每个逃跑的-1分。注意，被摸完最后一张牌的时候，此时手里控制的那张动物是不算分的。

特殊规则：
（1）猎人：猎人的点数是9+N，N为他的对手数（单挑是1，群殴是2或3）。猎人单挑可以胜所有动物，但他不能参与群殴、不能逃跑。当有动物群殴打死猎人的时候，改为由点数最大的获得。（比如1个虎带2个狼群殴猎人，把猎人打死了，虎获得猎人）。猎人在猎物区计分为9分。
（2）细菌：细菌的点数是∞，所有动物（包括猎人）无论是单挑还是群殴，碰到了都会死。但是细菌不能主动进攻，不能参与群殴。
（3）狐狸：逃跑时，展示狐狸卡牌，可以看在场所有玩家的动物牌（由机器人私发给逃跑的狐狸玩家）。\n` + h.image('https://img14.360buyimg.com/pop/jfs/t1/123887/36/47715/150011/670bec24F38af364c/486485ea36316afa.jpg')
      await session.send(result)
    })


}
