import express from "express";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static("public"));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const ALLOWED_ITEM_TYPES = ["hp", "mp", "attack", "defense", "magic", "heal"];

const gameStates = {};

function createNewGameState() {
  return {
    playerName: "",
    playerJob: "",
    turn: 1,
    maxTurn: 50,

    hp: 30,
    maxHp: 30,
    mp: 10,
    maxMp: 10,

    attackBonus: 1,
    healBonus: 1,
    defenseBonus: 1,
    magicBonus: 1,

    gold: 20,

    inventory: [
      {
        name: "체력 포션",
        type: "hp",
        amount: 1,
        effectValue: 15,
        consumable: true,
        equipped: false,
        description: "HP를 회복한다."
      },
      {
        name: "마나 포션",
        type: "mp",
        amount: 1,
        effectValue: 10,
        consumable: true,
        equipped: false,
        description: "MP를 회복한다."
      }
    ],

    shop: {
      active: false,
      items: []
    },

    pendingGoldUses: [],

    history: [],
    lastScene: "",
    lastChoices: [],

    ended: false,

    combat: {
      active: false,
      monsterName: "",
      monsterHp: 0,
      monsterMaxHp: 0,
      monsterAttack: 0
    }
  };
}

function getGameState(sessionId) {
  if (!sessionId) {
    throw new Error("sessionId가 없습니다.");
  }

  if (!gameStates[sessionId]) {
    gameStates[sessionId] = createNewGameState();
  }

  return gameStates[sessionId];
}

function resetGameState(sessionId) {
  if (!sessionId) {
    throw new Error("sessionId가 없습니다.");
  }

  gameStates[sessionId] = createNewGameState();
  return gameStates[sessionId];
}

function parseJson(text, fallback) {
  try {
    const cleaned = text
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    return JSON.parse(cleaned);
  } catch {
    return fallback;
  }
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);

  if (Number.isNaN(number)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, number));
}

function normalizeItem(item) {
  const type = ALLOWED_ITEM_TYPES.includes(item.type) ? item.type : "attack";

  return {
    name: String(item.name || "이름 없는 아이템").trim(),
    type,
    amount: Number(item.amount) > 0 ? Number(item.amount) : 1,
    effectValue: clampNumber(item.effectValue, 1, 30, 1),
    consumable: Boolean(item.consumable),
    equipped: Boolean(item.equipped),
    description: String(item.description || "").trim()
  };
}

function inventoryText(gameState) {
  if (!gameState.inventory || gameState.inventory.length === 0) {
    return "없음";
  }

  return gameState.inventory
    .map((item) => {
      const equippedText = item.equipped ? " 장착됨" : "";
      return `${item.name} x${item.amount}${equippedText}`;
    })
    .join(", ");
}

function addItem(gameState, item) {
  const normalized = normalizeItem(item);

  const existing = gameState.inventory.find((i) => i.name === normalized.name);

  if (existing) {
    existing.amount += normalized.amount;
    return;
  }

  gameState.inventory.push(normalized);
}

function removeItemByName(gameState, name) {
  const item = gameState.inventory.find((i) => i.name === name);

  if (!item || item.amount <= 0) {
    return false;
  }

  item.amount -= 1;

  if (item.amount <= 0) {
    gameState.inventory = gameState.inventory.filter((i) => i.name !== name);
  }

  return true;
}

function findItemFromChoice(gameState, choice) {
  if (!choice.includes(" 사용")) {
    return null;
  }

  const itemName = choice.replace(" 사용", "").trim();

  return gameState.inventory.find((item) => item.name === itemName);
}

function useItem(gameState, choice) {
  const item = findItemFromChoice(gameState, choice);

  if (!item) {
    return {
      success: false,
      text: "사용할 수 있는 아이템이 없다."
    };
  }

  const itemText = `${item.name} ${item.description || ""}`;

  const looksLikeHpRecovery =
    item.type === "hp" ||
    (
      item.consumable &&
      item.type === "heal" &&
      (
        itemText.includes("HP") ||
        itemText.includes("체력") ||
        itemText.includes("회복") ||
        itemText.includes("치유") ||
        itemText.includes("약초") ||
        itemText.includes("허브") ||
        itemText.includes("음식") ||
        itemText.includes("차")
      )
    );

  const looksLikeMpRecovery =
    item.type === "mp" ||
    (
      item.consumable &&
      (
        itemText.includes("MP") ||
        itemText.includes("마나")
      )
    );

  if (looksLikeHpRecovery) {
    if (gameState.hp >= gameState.maxHp) {
      return {
        success: false,
        text: "이미 HP가 가득 차 있어 사용하지 않았다."
      };
    }

    const before = gameState.hp;
    gameState.hp = Math.min(gameState.maxHp, gameState.hp + item.effectValue);
    const healed = gameState.hp - before;

    if (item.consumable) {
      removeItemByName(gameState, item.name);
    }

    return {
      success: true,
      text: `${item.name}을 사용해 HP를 ${healed} 회복했다.`
    };
  }

  if (looksLikeMpRecovery) {
    if (gameState.mp >= gameState.maxMp) {
      return {
        success: false,
        text: "이미 MP가 가득 차 있어 사용하지 않았다."
      };
    }

    const before = gameState.mp;
    gameState.mp = Math.min(gameState.maxMp, gameState.mp + item.effectValue);
    const recovered = gameState.mp - before;

    if (item.consumable) {
      removeItemByName(gameState, item.name);
    }

    return {
      success: true,
      text: `${item.name}을 사용해 MP를 ${recovered} 회복했다.`
    };
  }

  if (!item.consumable && item.equipped) {
    return {
      success: false,
      text: `${item.name}은 이미 사용 중이다.`
    };
  }

  if (item.type === "attack") {
    gameState.attackBonus += item.effectValue;
  } else if (item.type === "defense") {
    gameState.defenseBonus += item.effectValue;
  } else if (item.type === "magic") {
    gameState.magicBonus += item.effectValue;
  } else if (item.type === "heal") {
    gameState.healBonus += item.effectValue;
  } else {
    return {
      success: false,
      text: `${item.name}은 사용할 수 없는 아이템이다.`
    };
  }

  if (item.consumable) {
    removeItemByName(gameState, item.name);
  } else {
    item.equipped = true;
  }

  return {
    success: true,
    text: `${item.name}을 사용했다. ${item.description || "능력치가 변화했다."}`
  };
}

async function generateJobStats(playerJob) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: "너는 중세 판타지 RPG 직업 밸런스 디자이너다. 반드시 JSON만 출력한다."
        },
        {
          role: "user",
          content: `
직업 이름:
${playerJob}

이 직업의 기본 능력치를 정해라.

규칙:
- maxHp는 15~50
- maxMp는 5~40
- attackBonus는 0~8
- healBonus는 0~8
- defenseBonus는 0~8
- magicBonus는 0~8
- 직업 이름의 분위기와 역할을 반영한다.
- 바나나 판매상, 광대, 농부, 왕자, 요리사 같은 비전투 직업도 적당히 해석한다.
- 너무 강하게 만들지 않는다.
- JSON만 출력한다.

형식:
{
  "maxHp": 숫자,
  "maxMp": 숫자,
  "attackBonus": 숫자,
  "healBonus": 숫자,
  "defenseBonus": 숫자,
  "magicBonus": 숫자
}
`
        }
      ]
    });

    const stats = parseJson(response.choices[0].message.content, {});

    return {
      maxHp: clampNumber(stats.maxHp, 15, 50, 30),
      maxMp: clampNumber(stats.maxMp, 5, 40, 10),
      attackBonus: clampNumber(stats.attackBonus, 0, 8, 1),
      healBonus: clampNumber(stats.healBonus, 0, 8, 1),
      defenseBonus: clampNumber(stats.defenseBonus, 0, 8, 1),
      magicBonus: clampNumber(stats.magicBonus, 0, 8, 1)
    };
  } catch {
    return {
      maxHp: 30,
      maxMp: 10,
      attackBonus: 1,
      healBonus: 1,
      defenseBonus: 1,
      magicBonus: 1
    };
  }
}

async function generateMonsterStats(monsterName) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: "너는 중세 판타지 RPG 전투 밸런스 디자이너다. 반드시 JSON만 출력한다."
        },
        {
          role: "user",
          content: `
전투 대상 이름:
${monsterName}

이 대상의 전투 수치를 정해라.

규칙:
- HP는 5~120
- 공격력은 1~20
- 약한 대상은 약하게, 강한 대상은 강하게 만든다.
- 사람, 동물, 괴물, 이상한 생물 모두 가능하다.
- JSON만 출력한다.

형식:
{
  "hp": 숫자,
  "attack": 숫자
}
`
        }
      ]
    });

    const stats = parseJson(response.choices[0].message.content, {});

    return {
      hp: clampNumber(stats.hp, 5, 120, 15),
      attack: clampNumber(stats.attack, 1, 20, 5)
    };
  } catch {
    return {
      hp: 15,
      attack: 5
    };
  }
}

async function generateGoldReward(monsterName, dice) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: "너는 중세 판타지 RPG 보상 밸런스 디자이너다. 반드시 JSON만 출력한다."
        },
        {
          role: "user",
          content: `
쓰러뜨린 대상:
${monsterName}

전투 종료 판정값:
${dice}

골드 보상을 정해라.

규칙:
- 보상은 0~80골드 사이
- 강하거나 부유한 대상은 보상이 높다.
- 평범한 동물이나 가난한 대상은 보상이 낮다.
- JSON만 출력한다.

형식:
{
  "gold": 숫자,
  "reason": "짧은 보상 설명"
}
`
        }
      ]
    });

    const reward = parseJson(response.choices[0].message.content, {});

    return {
      gold: clampNumber(reward.gold, 0, 80, 5),
      reason: reward.reason || "전투 보상"
    };
  } catch {
    return {
      gold: 5,
      reason: "전투 보상"
    };
  }
}

async function startCombat(gameState, monsterName = "적") {
  const monster = await generateMonsterStats(monsterName);

  gameState.shop.active = false;

  gameState.combat = {
    active: true,
    monsterName,
    monsterHp: monster.hp,
    monsterMaxHp: monster.hp,
    monsterAttack: monster.attack
  };
}

async function finishCombat(gameState, dice) {
  const monsterName = gameState.combat.monsterName;
  const reward = await generateGoldReward(monsterName, dice);

  gameState.gold += reward.gold;

  gameState.combat.active = false;
  gameState.combat.monsterHp = 0;

  return {
    monsterName,
    rewardGold: reward.gold,
    rewardReason: reward.reason
  };
}

async function generateShopItems(gameState) {
  const baseItems = [
    {
      name: "체력 포션",
      price: 10,
      type: "hp",
      effectValue: 15,
      consumable: true,
      equipped: false,
      description: "HP를 회복한다."
    },
    {
      name: "마나 포션",
      price: 15,
      type: "mp",
      effectValue: 10,
      consumable: true,
      equipped: false,
      description: "MP를 회복한다."
    }
  ];

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: "너는 중세 판타지 RPG 상점 아이템 디자이너다. 반드시 JSON만 출력한다."
        },
        {
          role: "user",
          content: `
현재 상황:
${gameState.lastScene || "평범한 중세 판타지 마을"}

플레이어:
${gameState.playerJob} ${gameState.playerName}

상점 상품 3개를 만들어라.

규칙:
- 체력 포션과 마나 포션은 기본으로 들어가므로 만들지 않는다.
- 무기, 장신구, 음식, 도구, 부적, 차, 반지, 목걸이 등을 섞는다.
- 가격은 5~80골드.
- effectValue는 1~20.
- type은 반드시 attack, defense, magic, heal, hp, mp 중 하나.
- consumable이 true면 사용 후 사라진다.
- consumable이 false면 장비처럼 사용 후 사라지지 않는다.
- 너무 강한 아이템은 만들지 않는다.
- JSON만 출력한다.

형식:
[
  {
    "name": "아이템 이름",
    "price": 숫자,
    "type": "attack",
    "effectValue": 숫자,
    "consumable": false,
    "description": "짧은 설명"
  }
]
`
        }
      ]
    });

    const aiItems = parseJson(response.choices[0].message.content, []);

    const safeAiItems = aiItems
      .filter((item) => item.name && item.price && item.type && item.effectValue)
      .slice(0, 3)
      .map((item) => ({
        name: String(item.name).trim(),
        price: clampNumber(item.price, 5, 100, 10),
        type: ALLOWED_ITEM_TYPES.includes(item.type) ? item.type : "attack",
        effectValue: clampNumber(item.effectValue, 1, 30, 1),
        consumable: Boolean(item.consumable),
        equipped: false,
        description: String(item.description || "").trim()
      }));

    return [...baseItems, ...safeAiItems];
  } catch {
    return baseItems;
  }
}

async function openShop(gameState) {
  gameState.shop.active = true;
  gameState.shop.items = await generateShopItems(gameState);

  return {
    text: "설명:\n상점이 열렸다. 필요한 물건을 고를 수 있다.",
    choices: [
      ...gameState.shop.items.map((item) => `${item.name} 구매`),
      "상점 나가기"
    ],
    dice: "-",
    turn: gameState.turn,
    state: gameState
  };
}

function handleShop(gameState, choice) {
  if (choice.includes("상점 나가기")) {
    gameState.shop.active = false;

    return {
      text: "설명:\n상점에서 나왔다.",
      choices: ["주변을 살핀다", "길을 떠난다", "다시 상점을 본다"],
      dice: "-",
      turn: gameState.turn,
      state: gameState
    };
  }

  if (!choice.endsWith(" 구매")) {
    return {
      text: "설명:\n상점에서는 구매할 물건을 골라야 한다.",
      choices: [
        ...gameState.shop.items.map((item) => `${item.name} 구매`),
        "상점 나가기"
      ],
      dice: "-",
      turn: gameState.turn,
      state: gameState
    };
  }

  const itemName = choice.replace(" 구매", "").trim();
  const item = gameState.shop.items.find((shopItem) => shopItem.name === itemName);

  if (!item) {
    return {
      text: `설명:\n${itemName}은 이 상점에 없다.`,
      choices: [
        ...gameState.shop.items.map((shopItem) => `${shopItem.name} 구매`),
        "상점 나가기"
      ],
      dice: "-",
      turn: gameState.turn,
      state: gameState
    };
  }

  if (gameState.gold < item.price) {
    return {
      text: `설명:\n골드가 부족하다. ${item.name}을 구매하려면 ${item.price}골드가 필요하다.`,
      choices: [
        ...gameState.shop.items.map((shopItem) => `${shopItem.name} 구매`),
        "상점 나가기"
      ],
      dice: "-",
      turn: gameState.turn,
      state: gameState
    };
  }

  gameState.gold -= item.price;
  addItem(gameState, item);

  return {
    text:
      `설명:\n${item.name}을 구매했다.\n\n` +
      `보유 골드: ${gameState.gold}\n` +
      `인벤토리: ${inventoryText(gameState)}`,
    choices: [
      ...gameState.shop.items.map((shopItem) => `${shopItem.name} 구매`),
      "상점 나가기"
    ],
    dice: "-",
    turn: gameState.turn,
    state: gameState
  };
}
function getCombatChoices(gameState) {
  return [
    "공격한다",
    "방어한다",
    "스킬 공격",
    "스킬 회복",
    "도망간다",
    ...gameState.inventory.map((item) => `${item.name} 사용`)
  ];
}
async function handleCombat(gameState, choice) {
  const combat = gameState.combat;
  const dice = Math.floor(Math.random() * 6) + 1;

  let text = "설명:\n";
  let enemyCanCounter = true;

  if (
    choice.includes("도망") ||
    choice.includes("도주") ||
    choice.includes("후퇴")
  ) {
    const escapeScore = dice + gameState.defenseBonus;

    if (escapeScore >= 5) {
      gameState.combat.active = false;

      return {
        text:
          "설명:\n" +
          `${gameState.playerName}은 틈을 노려 전투에서 벗어났다.\n` +
          `${combat.monsterName}은 뒤쫓으려 했지만, 거리는 이미 벌어진 뒤였다.`,
        choices: ["숨을 고른다", "멀리 이동한다", "주변을 살핀다"],
        dice,
        turn: gameState.turn,
        state: gameState
      };
    }

    const enemyDamage = Math.max(
      1,
      combat.monsterAttack - gameState.defenseBonus
    );

    gameState.hp -= enemyDamage;

    text +=
      `${gameState.playerName}은 전투에서 벗어나려 했지만 실패했다.\n` +
      `${combat.monsterName}의 공격을 허용해 ${enemyDamage} 피해를 입었다.\n`;

    if (gameState.hp <= 0) {
      gameState.hp = 0;
      gameState.ended = true;
      gameState.combat.active = false;

      return {
        text:
          text +
          `\n${gameState.playerName}은 도망치려다 쓰러졌다.\n\n` +
          "엔딩:\n모험은 여기서 끝났다.",
        choices: [],
        dice,
        turn: gameState.turn,
        state: gameState
      };
    }

    return {
      text:
        text +
        `\n현재 상태:\n` +
        `${gameState.playerName} HP: ${gameState.hp}/${gameState.maxHp}\n` +
        `${gameState.playerName} MP: ${gameState.mp}/${gameState.maxMp}\n` +
        `${combat.monsterName} HP: ${combat.monsterHp}/${combat.monsterMaxHp}`,
      choices: getCombatChoices(gameState),
      dice,
      turn: gameState.turn,
      state: gameState
    };
  }

  if (choice.includes(" 사용")) {
    const result = useItem(gameState, choice);
    text += result.text + "\n";

    if (!result.success) {
      enemyCanCounter = false;
    }
  } else if (choice.includes("스킬 공격")) {
    const cost = 5;

    if (gameState.mp < cost) {
      text += "MP가 부족해 스킬 공격을 사용할 수 없었다.\n";
      enemyCanCounter = false;
    } else {
      gameState.mp -= cost;

      const damage = 8 + dice + gameState.magicBonus + gameState.attackBonus;
      combat.monsterHp -= damage;

      text += `${gameState.playerName}은 MP ${cost}를 소모해 스킬 공격을 사용했다.\n`;
      text += `${combat.monsterName}에게 ${damage} 피해를 주었다.\n`;
    }
  } else if (choice.includes("스킬 회복")) {
    const cost = 4;

    if (gameState.mp < cost) {
      text += "MP가 부족해 스킬 회복을 사용할 수 없었다.\n";
      enemyCanCounter = false;
    } else if (gameState.hp >= gameState.maxHp) {
      text += "이미 HP가 가득 차 있어 스킬 회복을 사용하지 않았다.\n";
      enemyCanCounter = false;
    } else {
      gameState.mp -= cost;

      const heal = 10 + dice + gameState.healBonus + gameState.magicBonus;
      const before = gameState.hp;

      gameState.hp = Math.min(gameState.maxHp, gameState.hp + heal);

      const actualHeal = gameState.hp - before;

      text += `${gameState.playerName}은 MP ${cost}를 소모해 회복 스킬을 사용했다.\n`;
      text += `HP를 ${actualHeal} 회복했다.\n`;
    }
  } else if (choice.includes("방어")) {
    const enemyDamage = Math.max(
      0,
      combat.monsterAttack - dice - gameState.defenseBonus
    );

    gameState.hp -= enemyDamage;
    enemyCanCounter = false;

    text += `${gameState.playerName}은 공격에 대비했다.\n`;
    text += `${combat.monsterName}의 공격 피해는 ${enemyDamage}였다.\n`;
  } else {
    const damage = 4 + dice + gameState.attackBonus;
    combat.monsterHp -= damage;

    text += `${gameState.playerName}의 공격이 적중했다.\n`;
    text += `${combat.monsterName}에게 ${damage} 피해를 주었다.\n`;
  }

  if (combat.monsterHp <= 0) {
    const reward = await finishCombat(gameState, dice);

    text += `\n${reward.monsterName}은 쓰러졌다.\n`;
    text += `${reward.rewardReason}으로 ${reward.rewardGold}골드를 얻었다.\n`;

    return {
      text,
      choices: ["전리품을 확인한다", "주변을 조사한다", "다시 길을 떠난다"],
      dice,
      turn: gameState.turn,
      state: gameState
    };
  }

  if (enemyCanCounter) {
    const enemyDamage = Math.max(
      1,
      combat.monsterAttack - gameState.defenseBonus
    );

    gameState.hp -= enemyDamage;

    text += `${combat.monsterName}의 반격으로 ${enemyDamage} 피해를 입었다.\n`;
  }

  if (gameState.hp <= 0) {
    gameState.hp = 0;
    gameState.ended = true;
    gameState.combat.active = false;

    return {
      text:
        text +
        `\n${gameState.playerName}은 전투 끝에 쓰러졌다.\n\n` +
        "엔딩:\n모험은 여기서 끝났다.",
      choices: [],
      dice,
      turn: gameState.turn,
      state: gameState
    };
  }

  return {
    text:
      text +
      `\n현재 상태:\n` +
      `${gameState.playerName} HP: ${gameState.hp}/${gameState.maxHp}\n` +
      `${gameState.playerName} MP: ${gameState.mp}/${gameState.maxMp}\n` +
      `${combat.monsterName} HP: ${combat.monsterHp}/${combat.monsterMaxHp}`,
    choices: getCombatChoices(gameState),
    dice,
    turn: gameState.turn,
    state: gameState
  };
}

async function judgeCombatScene(aiText, playerChoice) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: "너는 RPG 장면 판정기다. 반드시 JSON만 출력한다."
        },
        {
          role: "user",
          content: `
아래 장면이 실제 전투로 전환되어야 하는지 판정해라.

플레이어 행동:
${playerChoice}

장면:
${aiText}

전투로 판단하는 경우:
- 누군가가 실제로 공격을 시작했다.
- 무기, 발톱, 이빨, 마법 등으로 피해를 주고받기 시작했다.
- 플레이어가 즉시 공격/방어/회복을 선택해야 한다.
- 플레이어가 명확히 공격 의사를 보였다.

전투로 판단하지 않는 경우:
- 말싸움, 위협, 경계, 긴장감만 있다.
- 싸울 가능성만 암시됐다.
- 전투 준비만 하고 아직 교전하지 않았다.

형식:
{
  "combat": true 또는 false,
  "target": "전투 대상 이름"
}
`
        }
      ]
    });

    const result = parseJson(response.choices[0].message.content, {
      combat: false,
      target: ""
    });

    return {
      combat: Boolean(result.combat),
      target: result.target || "적"
    };
  } catch {
    return {
      combat: false,
      target: ""
    };
  }
}

function handleGoldUse(gameState, choice) {
  const goldUse = gameState.pendingGoldUses.find((use) =>
    choice.includes(use.name)
  );

  if (!goldUse) {
    return null;
  }

  if (gameState.gold < goldUse.cost) {
    return {
      text: `설명:\n골드가 부족하다. ${goldUse.name}에는 ${goldUse.cost}골드가 필요하다.`,
      choices: ["다른 방법을 찾는다", "상점을 찾는다", "그만둔다"],
      dice: "-",
      turn: gameState.turn,
      state: gameState
    };
  }

  gameState.gold -= goldUse.cost;

  return {
    text:
      `설명:\n${goldUse.name}에 ${goldUse.cost}골드를 사용했다.\n` +
      `${goldUse.effect || "상황이 조금 유리해졌다."}`,
    choices: ["계속 진행한다", "주변을 살핀다", "다른 선택을 한다"],
    dice: "-",
    turn: gameState.turn,
    state: gameState
  };
}

function parseGoldUses(gameState, aiText) {
  const matches = [...aiText.matchAll(/\[골드사용:(.+?):(\d+):(.+?)\]/g)];

  gameState.pendingGoldUses = matches.map((match) => ({
    name: match[1].trim(),
    cost: Number(match[2]),
    effect: match[3].trim()
  }));

  return aiText.replace(/\[골드사용:.+?:\d+:.+?\]/g, "").trim();
}

function applyStoryRewards(gameState, aiText) {
  const messages = [];

  const goldGainMatches = [...aiText.matchAll(/\[골드획득:(\d+):(.+?)\]/g)];

  goldGainMatches.forEach((match) => {
    const amount = Number(match[1]);
    const reason = match[2].trim();

    if (amount > 0) {
      gameState.gold += amount;
      messages.push(`${reason}으로 ${amount}골드를 얻었다.`);
    }
  });

  aiText = aiText.replace(/\[골드획득:\d+:.+?\]/g, "").trim();

  const goldLossMatches = [...aiText.matchAll(/\[골드손실:(\d+):(.+?)\]/g)];

  goldLossMatches.forEach((match) => {
    const amount = Number(match[1]);
    const reason = match[2].trim();
    const actualLoss = Math.min(gameState.gold, amount);

    if (actualLoss > 0) {
      gameState.gold -= actualLoss;
      messages.push(`${reason}으로 ${actualLoss}골드를 잃었다.`);
    }
  });

  aiText = aiText.replace(/\[골드손실:\d+:.+?\]/g, "").trim();

  const itemGainMatches = [
    ...aiText.matchAll(/\[아이템획득:([^:\]]+):([^:\]]+):(\d+):(true|false):([^\]]+)\]/g)
  ];

  itemGainMatches.forEach((match) => {
    const name = match[1].trim();
    const rawType = match[2].trim();
    const effectValue = Number(match[3]);
    const consumable = match[4] === "true";
    const description = match[5].trim();

    const type = ALLOWED_ITEM_TYPES.includes(rawType) ? rawType : "attack";

    addItem(gameState, {
      name,
      type,
      amount: 1,
      effectValue: Math.max(1, Math.min(30, effectValue)),
      consumable,
      equipped: false,
      description
    });

    messages.push(`${name}을 얻었다.`);
  });

  aiText = aiText
    .replace(/\[아이템획득:[^:\]]+:[^:\]]+:\d+:(true|false):[^\]]+\]/g, "")
    .trim();

  const itemLossMatches = [...aiText.matchAll(/\[아이템손실:([^\]]+)\]/g)];

  itemLossMatches.forEach((match) => {
    const name = match[1].trim();
    const removed = removeItemByName(gameState, name);

    if (removed) {
      messages.push(`${name}을 잃었다.`);
    }
  });

  aiText = aiText.replace(/\[아이템손실:[^\]]+\]/g, "").trim();

  return {
    text: aiText,
    messages
  };
}

app.post("/start", async (req, res) => {
  try {
    const { playerName, playerJob, sessionId } = req.body;

    const gameState = resetGameState(sessionId);

    gameState.playerName = playerName || "이름 없는 자";
    gameState.playerJob = playerJob || "모험가";

    const jobStats = await generateJobStats(gameState.playerJob);

    gameState.maxHp = jobStats.maxHp;
    gameState.hp = jobStats.maxHp;
    gameState.maxMp = jobStats.maxMp;
    gameState.mp = jobStats.maxMp;

    gameState.attackBonus = jobStats.attackBonus;
    gameState.healBonus = jobStats.healBonus;
    gameState.defenseBonus = jobStats.defenseBonus;
    gameState.magicBonus = jobStats.magicBonus;

    return res.json({
      message: "게임 시작",
      state: gameState
    });
  } catch (error) {
    return res.status(400).json({
      text: "에러 발생: " + error.message,
      choices: [],
      dice: "-",
      turn: 1,
      state: createNewGameState()
    });
  }
});

app.post("/reset", (req, res) => {
  try {
    const { sessionId } = req.body;
    const gameState = resetGameState(sessionId);

    return res.json({
      message: "새 게임 시작",
      state: gameState
    });
  } catch (error) {
    return res.status(400).json({
      text: "에러 발생: " + error.message,
      choices: [],
      dice: "-",
      turn: 1,
      state: createNewGameState()
    });
  }
});

app.post("/next", async (req, res) => {
  try {
    const { choice, sessionId } = req.body;
    const gameState = getGameState(sessionId);
    const playerChoice = choice || "주변을 살핀다";

    if (playerChoice.startsWith("/dev turn ")) {
      const targetTurn = Number(playerChoice.replace("/dev turn ", ""));

      if (!Number.isNaN(targetTurn) && targetTurn >= 1 && targetTurn <= gameState.maxTurn) {
        gameState.turn = targetTurn;
        gameState.ended = false;

        return res.json({
          text: `${targetTurn}턴으로 이동했습니다.`,
          choices: [],
          dice: "-",
          turn: gameState.turn,
          state: gameState
        });
      }
    }

    if (gameState.ended) {
      return res.json({
        text: "이미 엔딩에 도달했다.",
        choices: [],
        dice: "-",
        turn: gameState.turn,
        state: gameState
      });
    }

    if (playerChoice.startsWith("/dev monster ")) {
      const monsterName = playerChoice.replace("/dev monster ", "").trim() || "적";

      await startCombat(gameState, monsterName);

      return res.json({
        text:
          `설명:\n${monsterName}이 나타났다.\n\n` +
          `현재 상태:\n` +
          `${gameState.playerName} HP: ${gameState.hp}/${gameState.maxHp}\n` +
          `${gameState.playerName} MP: ${gameState.mp}/${gameState.maxMp}\n` +
          `${monsterName} HP: ${gameState.combat.monsterHp}/${gameState.combat.monsterMaxHp}`,
        choices: getCombatChoices(gameState),
        dice: "-",
        turn: gameState.turn,
        state: gameState
      });
    }

    if (gameState.combat.active) {
      const combatResult = await handleCombat(gameState, playerChoice);
      return res.json(combatResult);
    }

    if (gameState.shop.active) {
      return res.json(handleShop(gameState, playerChoice));
    }

    if (playerChoice.includes(" 사용")) {
      const result = useItem(gameState, playerChoice);

      return res.json({
        text: "설명:\n" + result.text,
        choices: ["주변을 살핀다", "길을 떠난다", "상점을 찾는다"],
        dice: "-",
        turn: gameState.turn,
        state: gameState
      });
    }

    const hostileToMerchant =
      playerChoice.includes("훔치") ||
      playerChoice.includes("훔쳐") ||
      playerChoice.includes("뺏") ||
      playerChoice.includes("빼앗") ||
      playerChoice.includes("강탈") ||
      playerChoice.includes("협박") ||
      playerChoice.includes("공격") ||
      playerChoice.includes("죽") ||
      playerChoice.includes("털");

    const wantsShop =
      playerChoice.includes("상점") ||
      playerChoice.includes("상점을") ||
      playerChoice.includes("상점 찾") ||
      playerChoice.includes("상인과 거래") ||
      playerChoice.includes("상인에게 물건") ||
      playerChoice.includes("상인에게 구매") ||
      playerChoice.includes("구매한다");

    if (wantsShop && !hostileToMerchant) {
      return res.json(await openShop(gameState));
    }

    const goldUseResult = handleGoldUse(gameState, playerChoice);
    if (goldUseResult) {
      return res.json(goldUseResult);
    }

    const diceNeeded = Math.random() < 0.25;
    const dice = diceNeeded ? Math.floor(Math.random() * 6) + 1 : null;

    const diceText =
      dice === null
        ? ""
        : `
이번 턴에는 내부 판정이 있었다.

내부 판정값:
${dice}

판정 규칙:
- 1이면 매우 불리한 결과로 반영한다.
- 2~3이면 약간 불리한 결과로 반영한다.
- 4~5이면 약간 유리한 결과로 반영한다.
- 6이면 매우 유리한 결과로 반영한다.
- 출력문에는 판정값 숫자를 직접 쓰지 않는다.
- 주사위, 판정값, 굴림 같은 표현을 쓰지 않는다.
`;

    const storyPhase =
      gameState.turn <= 10 ? "기" :
      gameState.turn <= 25 ? "승" :
      gameState.turn <= 40 ? "전" :
      "결";

    const prompt = `
세계관:
- 중세 판타지 RPG
- 현대 무기 없음
- 부활 없음
- 죽음은 되돌릴 수 없음

스토리 구조:
- 1~10턴: 기
- 11~25턴: 승
- 26~40턴: 전
- 41~50턴: 결

현재 단계:
${storyPhase}

플레이어:
이름: ${gameState.playerName}
직업: ${gameState.playerJob}
HP: ${gameState.hp}/${gameState.maxHp}
MP: ${gameState.mp}/${gameState.maxMp}
골드: ${gameState.gold}
인벤토리: ${inventoryText(gameState)}

현재 턴:
${gameState.turn}/${gameState.maxTurn}

플레이어 행동:
${playerChoice}

직전 장면:
${gameState.lastScene || "게임 시작"}

${diceText}

규칙:
- 플레이어 선택을 최우선으로 따른다.
- 플레이어 행동을 무시하거나 온건하게 바꾸지 않는다.
- 마왕 토벌을 강요하지 않는다.
- 설명은 6~10문장.
- 분위기와 대사를 섞는다.
- 선택지는 반드시 3개.
- 상인이나 상점이 등장하면 상황에 맞는 물건을 살 수 있다.
- 상황상 돈을 쓸 수 있으면 [골드사용:이름:비용:효과] 형식을 한 줄로 추가할 수 있다.
- 플레이어가 돈을 얻는 행동에 성공하면 [골드획득:금액:이유] 형식을 한 줄로 추가한다.
- 플레이어가 돈을 잃으면 [골드손실:금액:이유] 형식을 한 줄로 추가한다.
- 플레이어가 아이템을 얻으면 [아이템획득:이름:type:effectValue:consumable:설명] 형식을 한 줄로 추가한다.
- type은 hp, mp, attack, defense, magic, heal 중 하나만 쓴다.
- consumable은 true 또는 false만 쓴다.
- 플레이어가 아이템을 잃으면 [아이템손실:이름] 형식을 한 줄로 추가한다.
- NPC가 선물하거나, 플레이어가 훔치거나, 빼앗거나, 보상으로 받거나, 주워도 실제 획득으로 처리한다.
- 상인을 공격하거나 협박하거나 훔치려는 행동을 상점 이용으로 바꾸지 않는다.
- 훔치기나 강탈은 성공할 수도 실패할 수도 있으며, 실패하면 전투, 골드 손실, 평판 악화로 이어질 수 있다.
- 실제 물리적 전투가 시작되는 장면이라면 마지막 줄에 [전투발생:전투대상이름]을 출력할 수 있다.
- 전투 수치 계산은 코드가 하므로 AI는 전투 데미지와 HP 계산을 하지 않는다.
- 일반 장면에서는 주사위를 언급하지 않는다.
- 50턴이 되기 전에는 엔딩을 내지 않는다.
- 50턴에서는 선택지를 만들지 말고 최종 엔딩 지문만 작성한다.

출력 형식:

설명:
(설명)

선택지:
1. (선택지)
2. (선택지)
3. (선택지)
`;

    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: "너는 중세 판타지 RPG 게임 마스터다."
        },
        {
          role: "user",
          content: prompt
        }
      ]
    });

    let aiText = response.choices[0].message.content;

    aiText = parseGoldUses(gameState, aiText);

    const storyRewardResult = applyStoryRewards(gameState, aiText);
    aiText = storyRewardResult.text;

    if (storyRewardResult.messages.length > 0) {
      aiText +=
        "\n\n획득/변동:\n" +
        storyRewardResult.messages.map((message) => `- ${message}`).join("\n");
    }

    const explicitCombatMatch = aiText.match(/\[전투발생:(.+?)\]/);
    let combatJudgement = { combat: false, target: "" };

    if (explicitCombatMatch) {
      combatJudgement = {
        combat: true,
        target: explicitCombatMatch[1].trim() || "적"
      };
    } else {
      combatJudgement = await judgeCombatScene(aiText, playerChoice);
    }

    if (combatJudgement.combat) {
      const monsterName = combatJudgement.target || "적";

      await startCombat(gameState, monsterName);

      aiText = aiText.replace(/\[전투발생:.+?\]/, "").trim();
      aiText = aiText.replace(/선택지:[\s\S]*/g, "").trim();

      return res.json({
        text:
          aiText +
          `\n\n전투 시작:\n` +
          `${monsterName}이 전투 태세를 갖췄다.\n\n` +
          `현재 상태:\n` +
          `${gameState.playerName} HP: ${gameState.hp}/${gameState.maxHp}\n` +
          `${gameState.playerName} MP: ${gameState.mp}/${gameState.maxMp}\n` +
          `${monsterName} HP: ${gameState.combat.monsterHp}/${gameState.combat.monsterMaxHp}`,
        choices: getCombatChoices(gameState),
        dice: "-",
        turn: gameState.turn,
        state: gameState
      });
    }

    gameState.history.push(`${gameState.turn}턴: ${playerChoice}`);

        if (gameState.turn >= gameState.maxTurn) {
      gameState.ended = true;

      const endingResponse = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content: "너는 중세 판타지 RPG 엔딩 작가다."
          },
          {
            role: "user",
            content: `
플레이어:
${gameState.playerJob} ${gameState.playerName}

지금까지의 기록:
${gameState.history.join("\n")}

마지막 장면:
${aiText}

최종 엔딩만 출력해라.
선택지는 출력하지 않는다.
급전개처럼 보이지 않게 마무리한다.
플레이어 선택 방향을 반영한다.
`
          }
        ]
      });

      const endingText = endingResponse.choices[0].message.content;

      return res.json({
        text: endingText,
        choices: [],
        dice: "-",
        turn: gameState.turn,
        state: gameState
      });
    }

    const choiceMatches = [...aiText.matchAll(/\d\.\s*(.+)/g)];
    const choices = choiceMatches.map((match) => match[1]);

    if (gameState.pendingGoldUses.length > 0) {
      gameState.pendingGoldUses.forEach((use) => {
        choices.push(`${use.name} (${use.cost}골드)`);
      });
    }

    gameState.lastScene = aiText;
    gameState.lastChoices = choices;
    gameState.turn += 1;

    return res.json({
      text: aiText,
      choices,
      dice: dice === null ? "-" : dice,
      turn: gameState.turn,
      state: gameState
    });
  } catch (error) {
    return res.json({
      text: "에러 발생: " + error.message,
      choices: [],
      dice: "-",
      turn: 1,
      state: createNewGameState()
    });
  }
});

app.listen(port, () => {
  console.log(`서버 실행중: http://localhost:${port}`);
});