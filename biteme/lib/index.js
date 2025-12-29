var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var src_exports = {};
__export(src_exports, {
  Config: () => Config,
  apply: () => apply,
  name: () => name
});
module.exports = __toCommonJS(src_exports);
var import_koishi = require("koishi");
var name = "biteme";
var Config = import_koishi.Schema.object({});
var rooms = /* @__PURE__ */ new Map();
function ensureGroup(session) {
  if (!session.guildId) throw new Error("仅支持在群聊内使用该功能。");
}
__name(ensureGroup, "ensureGroup");
function getRoomByGuild(guildId) {
  return rooms.get(guildId);
}
__name(getRoomByGuild, "getRoomByGuild");
function requireRoom(session) {
  ensureGroup(session);
  const room = getRoomByGuild(session.guildId);
  if (!room) throw new Error("当前群没有进行中的对局，请先使用【咬我】 建房。");
  return room;
}
__name(requireRoom, "requireRoom");
function isHost(session, room) {
  return session.userId === room.hostId;
}
__name(isHost, "isHost");
function formatCardPublic(card) {
  if (!card) return "无";
  if (card.kind === "animal") return `${textOfAnimal(card.power)}`;
  if (card.type === "hunter") return "猎人(9+N)";
  if (card.type === "bacteria") return "细菌(∞)";
  return "未知";
}
__name(formatCardPublic, "formatCardPublic");
function cardPowerForDisplay(card) {
  if (card.kind === "animal") return textOfAnimal(card.power);
  if (card.type === "hunter") return "猎人(9+N)";
  if (card.type === "bacteria") return "细菌(∞)";
  return "未知";
}
__name(cardPowerForDisplay, "cardPowerForDisplay");
function textOfAnimal(power) {
  const mapping = {
    1: "兔(1)",
    2: "蛇(2)",
    3: "狐(3)",
    4: "狼(4)",
    5: "豹(5)",
    6: "狮(6)",
    7: "熊(7)",
    8: "虎(8)"
  };
  return mapping[power];
}
__name(textOfAnimal, "textOfAnimal");
function buildFullDeck() {
  const deck = [];
  const animalPowers = [1, 2, 3, 4, 5, 6, 7, 8];
  for (const p of animalPowers) {
    for (let i = 0; i < 5; i++) deck.push({ kind: "animal", power: p });
  }
  deck.push({ kind: "special", type: "hunter" });
  deck.push({ kind: "special", type: "bacteria" });
  return shuffle(deck);
}
__name(buildFullDeck, "buildFullDeck");
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
__name(shuffle, "shuffle");
function findPlayerBySeat(room, seat) {
  return room.players.find((p) => p.seat === seat);
}
__name(findPlayerBySeat, "findPlayerBySeat");
function currentPlayer(room) {
  return room.players[room.turnIndex];
}
__name(currentPlayer, "currentPlayer");
function deckRemains(room) {
  return `${room.deck.length} / 42`;
}
__name(deckRemains, "deckRemains");
function isPlayerTurn(session, room) {
  return currentPlayer(room).userId === session.userId;
}
__name(isPlayerTurn, "isPlayerTurn");
function advanceTurn(room) {
  room.turnIndex = (room.turnIndex + 1) % room.players.length;
  room.turnDeadlineAt = Date.now() + 3 * 60 * 1e3;
  room.turnPaused = false;
}
__name(advanceTurn, "advanceTurn");
function describeSpecial(card) {
  if (!card) return "无";
  if (card.kind === "animal" && card.power === 3) return "逃跑时可以查看全场的动物牌。";
  if (card.kind === "special") {
    if (card.type === "hunter") return "点数为9+N，其中N为对手的数量；不能参与群殴、不能逃跑。";
    if (card.type === "bacteria") return "点数为∞；不能主动进攻、不能参与群殴。";
  }
  return "无";
}
__name(describeSpecial, "describeSpecial");
function snapshotOfPlayer(p) {
  const trophies = p.trophy.length === 0 && p.escapedCount === 0 ? "无" : `${p.trophy.map(formatCardPublic).join("、")}${p.trophy.length && p.escapedCount ? "、" : ""}${p.escapedCount ? "逃跑".repeat(p.escapedCount) : ""}`;
  return `你的动物：【${formatCardPublic(p.hand)}】
=======
特殊效果：${describeSpecial(p.hand)}
=======
你的猎物区：${trophies}`;
}
__name(snapshotOfPlayer, "snapshotOfPlayer");
function effectiveHunterPower(opponentCount) {
  return 9 + opponentCount;
}
__name(effectiveHunterPower, "effectiveHunterPower");
function compareInDuel(attacker, defender) {
  const aVal = attacker.kind === "special" && attacker.type === "hunter" ? effectiveHunterPower(1) : attacker.kind === "special" && attacker.type === "bacteria" ? 999 : attacker.kind === "animal" ? attacker.power : 0;
  const dVal = defender.kind === "special" && defender.type === "hunter" ? effectiveHunterPower(1) : defender.kind === "special" && defender.type === "bacteria" ? 999 : defender.kind === "animal" ? defender.power : 0;
  if (aVal === dVal) return "attacker";
  return aVal > dVal ? "attacker" : "defender";
}
__name(compareInDuel, "compareInDuel");
async function resolveDuel(ctx, session, room, attackerSeat, defenderSeat) {
  const attacker = findPlayerBySeat(room, attackerSeat);
  const defender = findPlayerBySeat(room, defenderSeat);
  if (!attacker.hand || !defender.hand) return;
  const winner = compareInDuel(attacker.hand, defender.hand);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  let res = `${attacker.seat}号与${defender.seat}号单挑结束。
`;
  if (winner === "attacker") {
    const dead = defender.hand;
    defender.hand = void 0;
    gainTrophy(room, attacker, dead);
    await session.bot.sendPrivateMessage(attacker.userId, `你胜利，获得一只【${formatCardPublic(dead)}】。`);
    await session.bot.sendPrivateMessage(attacker.userId, snapshotOfPlayer(attacker));
    await session.bot.sendPrivateMessage(defender.userId, `你失败，${attacker.seat}号获得你的【${formatCardPublic(dead)}】。
你摸了一张新的动物牌。`);
    await drawOneAndNotify(ctx, session, room, defender);
    res = res + `${attacker.seat}号胜利，获得${defender.seat}号的【${formatCardPublic(dead)}】。`;
  } else {
    const dead = attacker.hand;
    attacker.hand = void 0;
    gainTrophy(room, defender, dead);
    await session.bot.sendPrivateMessage(attacker.userId, `你失败，${defender.seat}号获得你的【${formatCardPublic(dead)}】。
你摸了一张新的动物牌。`);
    await session.bot.sendPrivateMessage(defender.userId, snapshotOfPlayer(defender));
    await session.bot.sendPrivateMessage(defender.userId, `你胜利，获得一只【${formatCardPublic(dead)}】。`);
    await drawOneAndNotify(ctx, session, room, attacker);
    res = res + `${defender.seat}号胜利，获得${attacker.seat}号的【${formatCardPublic(dead)}】。`;
  }
  await session.send(res);
  const prev = attacker.seat;
  advanceTurn(room);
  await session.send(`${prev}号玩家行动结束，请${currentPlayer(room).seat}号玩家 ${import_koishi.segment.at(currentPlayer(room).userId)} 开始行动。
牌堆剩余：${deckRemains(room)}`);
}
__name(resolveDuel, "resolveDuel");
async function resolveBrawl(ctx, session, room, starterSeat, targetSeat, responderSeats) {
  const starter = findPlayerBySeat(room, starterSeat);
  const target = findPlayerBySeat(room, targetSeat);
  const responders = responderSeats.map((s) => findPlayerBySeat(room, s)).filter(Boolean);
  const attackers = [starter, ...responders];
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const openMsg = `群殴：
进攻方：${attackers.map((p) => `${p.seat}号【${formatCardPublic(p.hand)}】`).join("，")}
防守方：${target.seat}号【${formatCardPublic(target.hand)}】`;
  await session.send(openMsg);
  const attackerSum = attackers.reduce((sum, p) => sum + valueForBrawl(p.hand, false), 0);
  const defenderVal = valueForBrawl(target.hand, true, attackers.length);
  const attackWin = attackerSum >= defenderVal;
  if (attackWin) {
    const dead = target.hand;
    target.hand = void 0;
    const owner = chooseTrophyOwner(attackers, dead);
    gainTrophy(room, owner, dead);
    await session.send(`进攻成功，${owner.seat}号获得【${formatCardPublic(dead)}】。`);
    await session.bot.sendPrivateMessage(target.userId, "你摸了一张新的动物牌。");
    await drawOneAndNotify(ctx, session, room, target);
    await session.bot.sendPrivateMessage(owner.userId, snapshotOfPlayer(owner));
  } else {
    for (const atk of attackers) {
      if (!atk.hand) continue;
      const dead = atk.hand;
      atk.hand = void 0;
      gainTrophy(room, target, dead);
      await session.bot.sendPrivateMessage(atk.userId, "你摸了一张新的动物牌。");
      await drawOneAndNotify(ctx, session, room, atk);
      await session.bot.sendPrivateMessage(target.userId, snapshotOfPlayer(target));
    }
    await session.send(`防守成功，防守方获得所有被击杀的进攻者为猎物。`);
  }
  room.turnPaused = false;
  const prev = starter.seat;
  advanceTurn(room);
  await session.send(`${prev}号玩家行动结束，请${currentPlayer(room).seat}号玩家 ${import_koishi.segment.at(currentPlayer(room).userId)} 开始行动。
牌堆剩余：${deckRemains(room)}`);
}
__name(resolveBrawl, "resolveBrawl");
function valueForBrawl(card, isDefender, attackerCount = 0) {
  if (!card) return 0;
  if (card.kind === "animal") return card.power;
  if (card.type === "bacteria") return 999;
  if (card.type === "hunter") return isDefender ? effectiveHunterPower(attackerCount) : 0;
  return 0;
}
__name(valueForBrawl, "valueForBrawl");
function chooseTrophyOwner(attackers, dead) {
  const isHunter = dead.kind === "special" && dead.type === "hunter";
  if (isHunter) {
    let best2 = attackers[0];
    let bestVal2 = valueForBrawl(best2.hand, false);
    for (const p of attackers) {
      const val = valueForBrawl(p.hand, false);
      if (val > bestVal2) {
        best2 = p;
        bestVal2 = val;
      }
    }
    return best2;
  }
  let best = attackers[0];
  let bestVal = valueForBrawl(best.hand, false);
  for (const p of attackers) {
    const val = valueForBrawl(p.hand, false);
    if (val < bestVal) {
      best = p;
      bestVal = val;
    }
  }
  return best;
}
__name(chooseTrophyOwner, "chooseTrophyOwner");
function gainTrophy(room, owner, card) {
  owner.trophy.push(card);
}
__name(gainTrophy, "gainTrophy");
async function drawOneAndNotify(ctx, session, room, p) {
  if (room.deck.length === 0) return;
  p.hand = room.deck.pop();
  await session.bot.sendPrivateMessage(p.userId, snapshotOfPlayer(p));
}
__name(drawOneAndNotify, "drawOneAndNotify");
function checkGameEndByDeck(room) {
  return room.deck.length === 0;
}
__name(checkGameEndByDeck, "checkGameEndByDeck");
async function finishAndScore(ctx, session, room) {
  const scores = room.players.map((p) => ({ seat: p.seat, userId: p.userId, username: p.username, score: calcScore(p) }));
  scores.sort((a, b) => b.score - a.score);
  const lines = scores.map((s, i) => `${i + 1}. ${s.seat}号	 ${s.username}	${s.score}分`).join("\n");
  await session.send(`牌堆已抓完，游戏结束！
本局排名：
${lines}`);
  rooms.delete(room.guildId);
}
__name(finishAndScore, "finishAndScore");
function calcScore(p) {
  let score = 0;
  for (const c of p.trophy) {
    if (c.kind === "animal") score += c.power;
    else if (c.type === "hunter") score += 9;
  }
  score -= p.escapedCount;
  return score;
}
__name(calcScore, "calcScore");
function apply(ctx, config) {
  ctx.command("咬我", "开始一局【你咬我啊】桌游").alias("你咬我啊").action(async ({ session }) => {
    try {
      ensureGroup(session);
      const guildId = session.guildId;
      if (rooms.has(guildId)) return "本群已有进行中的对局。";
      const room = {
        guildId,
        channelId: session.channelId,
        hostId: session.userId,
        started: false,
        deck: [],
        discard: [],
        players: [{
          userId: session.userId,
          username: session.username,
          seat: 1,
          hand: void 0,
          trophy: [],
          escapedCount: 0
        }],
        turnIndex: 0
      };
      rooms.set(guildId, room);
      return import_koishi.segment.at(session.userId) + " 发起了游戏 你咬我啊，报名扣1（回复数字1加入）。\n主持人为1号座位。";
    } catch (e) {
      return e?.message || "建房失败。";
    }
  });
  ctx.middleware(async (session, next) => {
    if (!session.guildId) return next();
    const room = getRoomByGuild(session.guildId);
    if (!room || room.started) return next();
    if (session.content?.trim() !== "1") return next();
    if (room.players.some((p) => p.userId === session.userId)) {
      return session.send("你已在座位表中。");
    }
    if (room.players.length >= 8) {
      return session.send("人数已满，无法加入。");
    }
    const seat = room.players.length + 1;
    room.players.push({ userId: session.userId, username: session.username, seat, hand: void 0, trophy: [], escapedCount: 0 });
    await session.send(`加入成功，你的座位号为${seat}。当前人数：${room.players.length}。`);
    return;
  });
  ctx.command("咬我/开始", "开始游戏（3-8人）").action(async ({ session }) => {
    try {
      const room = requireRoom(session);
      if (!isHost(session, room)) return "仅主持人可开始游戏。";
      if (room.started) return "游戏已开始。";
      if (room.players.length < 3) return "人数不足（需要3-8人）。";
      room.deck = buildFullDeck();
      for (const p of room.players) {
        p.hand = room.deck.pop();
      }
      room.started = true;
      room.turnIndex = 0;
      room.turnDeadlineAt = Date.now() + 3 * 60 * 1e3;
      const seats = room.players.map((p) => `${p.seat}号  ${p.username}`).join("\n");
      await session.send(`游戏开始！
${seats}
请1号玩家开始行动。
牌堆剩余：${deckRemains(room)}`);
      for (const p of room.players) {
        await session.bot.sendPrivateMessage(p.userId, `你的动物：【${formatCardPublic(p.hand)}】
=======
特殊效果：${describeSpecial(p.hand)}
=======
你的猎物区：无`);
      }
      return;
    } catch (e) {
      return e?.message || "开始失败。";
    }
  });
  ctx.command("咬我/结束", "结束当前对局（主持人或管理员）").action(async ({ session }) => {
    try {
      const room = requireRoom(session);
      if (!isHost(session, room) && session.authority < 2) return "需要主持人或Bot管理员结束对局。";
      rooms.delete(room.guildId);
      return "本局已结束。";
    } catch (e) {
      return e?.message || "结束失败。";
    }
  });
  ctx.command("咬我/过").alias("pass").action(async ({ session }) => {
    try {
      const room = requireRoom(session);
      if (!room.started) return "游戏未开始。";
      if (!isPlayerTurn(session, room)) return "当前不是你的回合。";
      const prevSeat = currentPlayer(room).seat;
      advanceTurn(room);
      const nextSeat = currentPlayer(room).seat;
      await session.send(`${prevSeat}号玩家行动结束，请${nextSeat}号玩家 ${import_koishi.segment.at(currentPlayer(room).userId)} 开始行动。
牌堆剩余：${deckRemains(room)}`);
      return;
    } catch (e) {
      return e?.message || "操作失败。";
    }
  });
  ctx.command("咬我/单挑 <seat:number>", "对指定座位发起单挑").alias("咬").action(async ({ session }, seat) => {
    try {
      const room = requireRoom(session);
      if (!room.started) return "游戏未开始。";
      if (!isPlayerTurn(session, room)) return "当前不是你的回合。";
      if (!seat || seat < 1 || seat > room.players.length) return "目标座位无效。";
      if (seat === currentPlayer(room).seat) return "不能对自己发起单挑。";
      const me = currentPlayer(room);
      const target = findPlayerBySeat(room, seat);
      if (me.hand?.kind === "special" && me.hand.type === "bacteria") return "你不能主动进攻。";
      if (!me.hand || !target.hand) return "有玩家没有可用的卡牌。";
      await session.bot.sendPrivateMessage(me.userId, `你对${target.seat}号发起了单挑。
对方的卡牌是：【${cardPowerForDisplay(target.hand)}】`);
      await session.bot.sendPrivateMessage(target.userId, `${me.seat}号对你发起了单挑。
对方的卡牌是：【${cardPowerForDisplay(me.hand)}】`);
      await resolveDuel(ctx, session, room, me.seat, target.seat);
      if (checkGameEndByDeck(room)) {
        await finishAndScore(ctx, session, room);
      }
      return;
    } catch (e) {
      return e?.message || "单挑失败。";
    }
  });
  ctx.command("咬我/群殴 <seat:number>", "对指定座位发起群殴").action(async ({ session }, seat) => {
    try {
      const room = requireRoom(session);
      if (!room.started) return "游戏未开始。";
      if (!isPlayerTurn(session, room)) return "当前不是你的回合。";
      if (room.pendingBrawl) return "已有进行中的群殴。";
      if (!seat || seat < 1 || seat > room.players.length) return "目标座位无效。";
      if (seat === currentPlayer(room).seat) return "不能对自己发起群殴。";
      const starter = currentPlayer(room);
      if (starter.hand && starter.hand.kind === "special" && starter.hand.type === "bacteria") return "细菌不能发起群殴。";
      if (starter.hand && starter.hand.kind === "special" && starter.hand.type === "hunter") return "猎人不能发起群殴。";
      room.turnPaused = true;
      room.pendingBrawl = {
        targetSeat: seat,
        starterSeat: starter.seat,
        responders: /* @__PURE__ */ new Set(),
        declined: /* @__PURE__ */ new Set(),
        deadlineAt: Date.now() + 60 * 1e3,
        selectionRequested: false
      };
      await session.send(`${starter.seat}号对${seat}号发起群殴，是否响应？
请在1分钟内回复【响应/参加】参与，或【不响应/不参加】放弃。`);
      setTimeout(async () => {
        const currentRoom = getRoomByGuild(room.guildId);
        if (!currentRoom || !currentRoom.pendingBrawl) return;
        const pb = currentRoom.pendingBrawl;
        if (pb.starterSeat !== starter.seat || pb.targetSeat !== seat) return;
        const others = currentRoom.players.filter((p) => p.seat !== pb.starterSeat && p.seat !== pb.targetSeat);
        const allDecided = others.every((p) => pb.responders.has(p.seat) || pb.declined.has(p.seat));
        if (!allDecided) {
          for (const p of others) {
            if (!pb.responders.has(p.seat) && !pb.declined.has(p.seat)) {
              pb.declined.add(p.seat);
            }
          }
        }
        await tryResolveBrawlNow(ctx, session, currentRoom);
      }, 60 * 1e3);
      return;
    } catch (e) {
      return e?.message || "群殴失败。";
    }
  });
  ctx.command("咬我/响应").alias("参加").action(async ({ session }) => {
    try {
      const room = requireRoom(session);
      if (!room.started) return "游戏未开始。";
      const pb = room.pendingBrawl;
      if (!pb) return "当前没有可响应的群殴。";
      if (Date.now() > pb.deadlineAt) return "响应已超时。";
      const ps = room.players.find((p) => p.userId === session.userId);
      if (!ps) return "你不在本局对局中。";
      if (ps.seat === pb.starterSeat || ps.seat === pb.targetSeat) return "发起进攻方和防守方不能响应。";
      if (ps.hand && ps.hand.kind === "special" && ps.hand.type === "bacteria") return "细菌不能响应群殴。";
      if (ps.hand && ps.hand.kind === "special" && ps.hand.type === "hunter") return "猎人不能响应群殴。";
      if (pb.responders.has(ps.seat)) return "你已响应。";
      if (pb.declined.has(ps.seat)) pb.declined.delete(ps.seat);
      pb.responders.add(ps.seat);
      await session.send(`${ps.seat}号加入了群殴。`);
      await tryResolveBrawlNow(ctx, session, room);
      return;
    } catch (e) {
      return e?.message || "响应失败。";
    }
  });
  ctx.command("咬我/不响应").alias("不参加").action(async ({ session }) => {
    try {
      const room = requireRoom(session);
      if (!room.started) return "游戏未开始。";
      const pb = room.pendingBrawl;
      if (!pb) return "当前没有可响应的群殴。";
      const ps = room.players.find((p) => p.userId === session.userId);
      if (!ps) return "你不在本局对局中。";
      if (ps.seat === pb.starterSeat || ps.seat === pb.targetSeat) return "发起进攻方和防守方不能放弃。";
      pb.responders.delete(ps.seat);
      pb.declined.add(ps.seat);
      await tryResolveBrawlNow(ctx, session, room);
      return `${ps.seat}号选择了不参加。`;
    } catch (e) {
      return e?.message || "操作失败。";
    }
  });
  ctx.command("咬我/邀请 <s1:number> [s2:number]", "发起者从响应者中点1-2人参与群殴").action(async ({ session }, s1, s2) => {
    try {
      const room = requireRoom(session);
      if (!room.started) return "游戏未开始。";
      const pb = room.pendingBrawl;
      if (!pb) return "当前没有进行中的群殴。";
      const starter = findPlayerBySeat(room, pb.starterSeat);
      if (session.userId !== starter.userId) return "仅发起者可邀请。";
      const choices = [s1, s2].filter(Boolean);
      if (choices.length === 0 || choices.length > 2) return "请邀请1-2位响应者。";
      for (const s of choices) {
        if (!pb.responders.has(s)) return `座位${s}未响应，无法邀请。`;
      }
      room.pendingBrawl = void 0;
      await resolveBrawl(ctx, session, room, pb.starterSeat, pb.targetSeat, choices);
      if (checkGameEndByDeck(room)) await finishAndScore(ctx, session, room);
      return;
    } catch (e) {
      return e?.message || "邀请失败。";
    }
  });
  ctx.command("咬我/逃跑", "将当前动物扣在猎物区，并摸一张新牌").action(async ({ session }) => {
    try {
      const room = requireRoom(session);
      if (!room.started) return "游戏未开始。";
      if (!isPlayerTurn(session, room)) return "当前不是你的回合。";
      const me = currentPlayer(room);
      if (!me.hand) return "你没有可逃跑的卡牌。";
      if (me.hand.kind === "special" && me.hand.type === "hunter") return "猎人不能逃跑。";
      me.escapedCount += 1;
      const escapedCard = me.hand;
      me.hand = void 0;
      if (escapedCard.kind === "animal" && escapedCard.power === 3) {
        await session.send(`狡黠的狐狸脚底抹油，查看了所有玩家的动物牌。`);
        const details = room.players.map((p) => `${p.seat}号：${formatCardPublic(p.hand)}`).join("\n");
        await session.bot.sendPrivateMessage(me.userId, `你发动了狐狸技能：
${details}`);
      }
      if (room.deck.length > 0) {
        me.hand = room.deck.pop();
        await session.bot.sendPrivateMessage(me.userId, snapshotOfPlayer(me));
        if (checkGameEndByDeck(room)) {
          await finishAndScore(ctx, session, room);
          return;
        }
      } else {
        await finishAndScore(ctx, session, room);
        return;
      }
      const prevSeat = me.seat;
      advanceTurn(room);
      await session.send(`${prevSeat}号玩家行动结束，请${currentPlayer(room).seat}号玩家 ${import_koishi.segment.at(currentPlayer(room).userId)} 开始行动。
牌堆剩余：${deckRemains(room)}`);
      return;
    } catch (e) {
      return e?.message || "逃跑失败。";
    }
  });
  ctx.middleware(async (session, next) => {
    if (!session.guildId) return next();
    const room = getRoomByGuild(session.guildId);
    if (!room || !room.started) return next();
    if (!room.turnDeadlineAt) return next();
    if (room.turnPaused) return next();
    if (Date.now() < room.turnDeadlineAt) return next();
    const cur = currentPlayer(room);
    room.turnDeadlineAt = void 0;
    advanceTurn(room);
    await session.send(`玩家${cur.seat}号超时，视为过。请${currentPlayer(room).seat}号玩家 ${import_koishi.segment.at(currentPlayer(room).userId)} 开始行动。
牌堆剩余：${deckRemains(room)}`);
    return next();
  });
  ctx.middleware(async (session, next) => {
    if (!session.guildId) return next();
    const room = getRoomByGuild(session.guildId);
    if (!room || !room.started) return next();
    const pb = room.pendingBrawl;
    if (!pb) return next();
    const others = room.players.filter((p) => p.seat !== pb.starterSeat && p.seat !== pb.targetSeat);
    const allDecided = others.every((p) => pb.responders.has(p.seat) || pb.declined.has(p.seat));
    const timedOut = Date.now() >= pb.deadlineAt;
    if (!allDecided && !timedOut) return next();
    const starter = findPlayerBySeat(room, pb.starterSeat);
    const target = findPlayerBySeat(room, pb.targetSeat);
    if (pb.responders.size === 0) {
      room.pendingBrawl = void 0;
      room.turnPaused = false;
      await session.send(`无人响应，按单挑处理。`);
      await new Promise((resolve) => setTimeout(resolve, 500));
      await session.bot.sendPrivateMessage(starter.userId, `你对${target.seat}号发起了单挑。
对方的卡牌是：【${cardPowerForDisplay(target.hand)}】`);
      await session.bot.sendPrivateMessage(target.userId, `${starter.seat}号对你发起了单挑。
对方的卡牌是：【${cardPowerForDisplay(starter.hand)}】`);
      await resolveDuel(ctx, session, room, starter.seat, target.seat);
      if (checkGameEndByDeck(room)) await finishAndScore(ctx, session, room);
      return next();
    }
    if (pb.responders.size > 1) {
      const list = Array.from(pb.responders.values());
      if (timedOut) {
        room.pendingBrawl = void 0;
        await resolveBrawl(ctx, session, room, starter.seat, target.seat, list.slice(0, 2));
        if (checkGameEndByDeck(room)) await finishAndScore(ctx, session, room);
      } else {
        if (!pb.selectionRequested) {
          pb.selectionRequested = true;
          await session.send(`${starter.seat}号，请选择队友（最多2人）：使用指令【邀请 A B】。可选：${list.join("、")}`);
        }
      }
      return next();
    }
    const responders = Array.from(pb.responders.values());
    room.pendingBrawl = void 0;
    await resolveBrawl(ctx, session, room, starter.seat, target.seat, responders);
    if (checkGameEndByDeck(room)) await finishAndScore(ctx, session, room);
    return next();
  });
  async function tryResolveBrawlNow(ctx2, session, room) {
    const pb = room.pendingBrawl;
    if (!pb) return;
    const starter = findPlayerBySeat(room, pb.starterSeat);
    const target = findPlayerBySeat(room, pb.targetSeat);
    const others = room.players.filter((p) => p.seat !== pb.starterSeat && p.seat !== pb.targetSeat);
    const allDecided = others.every((p) => pb.responders.has(p.seat) || pb.declined.has(p.seat));
    if (!allDecided) return;
    if (pb.responders.size === 0) {
      room.pendingBrawl = void 0;
      room.turnPaused = false;
      await session.send(`无人响应，按单挑处理。`);
      await new Promise((resolve) => setTimeout(resolve, 500));
      await session.bot.sendPrivateMessage(starter.userId, `你对${target.seat}号发起了单挑。
对方的卡牌是：【${cardPowerForDisplay(target.hand)}】`);
      await session.bot.sendPrivateMessage(target.userId, `${starter.seat}号对你发起了单挑。
对方的卡牌是：【${cardPowerForDisplay(starter.hand)}】`);
      await resolveDuel(ctx2, session, room, starter.seat, target.seat);
      if (checkGameEndByDeck(room)) await finishAndScore(ctx2, session, room);
      return;
    }
    if (pb.responders.size > 1) {
      if (!pb.selectionRequested) {
        pb.selectionRequested = true;
        const list = Array.from(pb.responders.values()).join("、");
        await session.send(`${starter.seat}号，请选择队友（最多2人）：使用指令【邀请 A B】。可选：${list}`);
      }
      return;
    }
    const responders = Array.from(pb.responders.values());
    room.pendingBrawl = void 0;
    await resolveBrawl(ctx2, session, room, starter.seat, target.seat, responders);
    if (checkGameEndByDeck(room)) await finishAndScore(ctx2, session, room);
  }
  __name(tryResolveBrawlNow, "tryResolveBrawlNow");
  ctx.command("咬我/你咬我啊规则").alias("你咬我啊说明").alias("咬我规则").alias("咬我说明").action(async ({ session }) => {
    const result = `这是桌游《你咬我啊》的Koishi移植版。

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
（3）狐狸：逃跑时，展示狐狸卡牌，可以看在场所有玩家的动物牌（由机器人私发给逃跑的狐狸玩家）。
` + import_koishi.h.image("https://img14.360buyimg.com/pop/jfs/t1/123887/36/47715/150011/670bec24F38af364c/486485ea36316afa.jpg");
    await session.send(result);
  });
}
__name(apply, "apply");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Config,
  apply,
  name
});
