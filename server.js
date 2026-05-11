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
worldSetting: "이곳은 흔히 아는 몬스터가 나타나는 판타지 RPG의 세계이며, 당신은 중대한 목표를 가지고 있습니다.",
playerPersonality: "특별히 정해지지 않은 성격",
playerGoal: "아직 정하지 못한 중대한 목표",
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

inn: {
  active: false,
  price: 12
},

pendingGoldUses: [],

    history: [],
    lastScene: "",
lastChoices: [],

lastIntent: "",
sameIntentCount: 0,
sceneStallCount: 0,

activeSceneGoal: "",
lastSceneSummary: "",
sceneGoalStallCount: 0,

recentEventSeeds: [],
lastPlayerChoice: "",
sameChoiceTextCount: 0,

storyMemory: {
  mainGoal: "",
  goalStatus: "진행 중",
  currentObjective: "",

  canonFacts: [],
  activeThreads: [],
  completedThreads: [],
  characterFacts: [],
  itemFacts: [],
  relationshipFacts: [],
  promisesAndContracts: [],
  contradictionRules: []
},

keeper: {
  mainGoalLockedUntilTurn: 35,
  finaleStartTurn: 41,
  recentEventTypes: [],
  currentEventType: "",
  currentChapterGoal: "",
  goalProgressStage: "도입",
  earlyGoalResolutionCount: 0,
  majorObstacles: [],
  revealedTruths: []
},

ended: false,

recentEventSeeds: [],
lastPlayerChoice: "",
sameChoiceTextCount: 0,

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
function uniqueList(list, max = 12) {
  return [...new Set(
    (Array.isArray(list) ? list : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean)
  )].slice(-max);
}

function createEmptyStoryMemory() {
  return {
    mainGoal: "",
    goalStatus: "진행 중",
    currentObjective: "",

    canonFacts: [],
    activeThreads: [],
    completedThreads: [],
    characterFacts: [],
    itemFacts: [],
    relationshipFacts: [],
    promisesAndContracts: [],
    contradictionRules: []
  };
}

function ensureStoryMemory(gameState) {
  if (!gameState.storyMemory) {
    gameState.storyMemory = createEmptyStoryMemory();
  }

  const memory = gameState.storyMemory;
  const empty = createEmptyStoryMemory();

  Object.keys(empty).forEach((key) => {
    if (memory[key] === undefined) {
      memory[key] = empty[key];
    }
  });

  return memory;
}

function storyMemoryText(gameState) {
  const memory = ensureStoryMemory(gameState);

  return `
장기 기억:
- 주 목표: ${memory.mainGoal || gameState.playerGoal || "미정"}
- 목표 상태: ${memory.goalStatus || "진행 중"}
- 현재 목적: ${memory.currentObjective || "미정"}

확정된 사실:
${uniqueList(memory.canonFacts, 25).map((fact) => `  - ${fact}`).join("\n") || "  - 없음"}

진행 중인 사건:
${uniqueList(memory.activeThreads, 20).map((fact) => `  - ${fact}`).join("\n") || "  - 없음"}

완료된 사건:
${uniqueList(memory.completedThreads, 20).map((fact) => `  - ${fact}`).join("\n") || "  - 없음"}

인물 관련 사실:
${uniqueList(memory.characterFacts, 25).map((fact) => `  - ${fact}`).join("\n") || "  - 없음"}

아이템/장소/조건 관련 사실:
${uniqueList(memory.itemFacts, 25).map((fact) => `  - ${fact}`).join("\n") || "  - 없음"}

관계 관련 사실:
${uniqueList(memory.relationshipFacts, 25).map((fact) => `  - ${fact}`).join("\n") || "  - 없음"}

약속/계약/거래:
${uniqueList(memory.promisesAndContracts, 20).map((fact) => `  - ${fact}`).join("\n") || "  - 없음"}

모순 방지 규칙:
${uniqueList(memory.contradictionRules, 25).map((fact) => `  - ${fact}`).join("\n") || "  - 없음"}
`;
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

async function generateMonsterStats(monsterName, gameState) {
  const turn = gameState?.turn || 1;

  let hpMin = 6;
  let hpMax = 24;
  let attackMin = 1;
  let attackMax = 5;

  if (turn >= 11 && turn <= 25) {
    hpMin = 12;
    hpMax = 40;
    attackMin = 2;
    attackMax = 7;
  }

  if (turn >= 26 && turn <= 40) {
    hpMin = 20;
    hpMax = 60;
    attackMin = 3;
    attackMax = 9;
  }

  if (turn >= 41) {
    hpMin = 30;
    hpMax = 85;
    attackMin = 4;
    attackMax = 12;
  }

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

현재 턴:
${turn}

이 대상의 전투 수치를 정해라.

규칙:
- 현재 턴에 맞는 난이도로 만든다.
- 초반에는 플레이어가 2~4턴 안에 죽지 않게 한다.
- 일반 몬스터는 너무 강하게 만들지 않는다.
- 보스급이라고 명시되지 않았다면 HP와 공격력을 낮게 잡는다.
- 사람, 동물, 괴물, 이상한 생물 모두 가능하다.
- JSON만 출력한다.

허용 범위:
- HP는 ${hpMin}~${hpMax}
- 공격력은 ${attackMin}~${attackMax}

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
      hp: clampNumber(stats.hp, hpMin, hpMax, Math.floor((hpMin + hpMax) / 2)),
      attack: clampNumber(stats.attack, attackMin, attackMax, Math.floor((attackMin + attackMax) / 2))
    };
  } catch {
    return {
      hp: Math.floor((hpMin + hpMax) / 2),
      attack: Math.floor((attackMin + attackMax) / 2)
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
  const monster = await generateMonsterStats(monsterName, gameState);

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
    if (dice <= 2) {
      const enemyDamage = Math.max(
        1,
        combat.monsterAttack - gameState.defenseBonus
      );

      gameState.hp -= enemyDamage;

      text +=
        `${gameState.playerName}은 전투에서 벗어나려 했지만 실패했다.\n` +
        `도망칠 틈을 잡지 못했고, ${combat.monsterName}의 공격으로 ${enemyDamage} 피해를 입었다.\n`;

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

    if (dice <= 4) {
      const enemyDamage = Math.max(
        0,
        Math.floor(combat.monsterAttack / 2) - gameState.defenseBonus
      );

      gameState.hp -= enemyDamage;
      gameState.combat.active = false;

      let escapeText =
        "설명:\n" +
        `${gameState.playerName}은 아슬아슬하게 전투에서 벗어났다.\n`;

      if (enemyDamage > 0) {
        escapeText +=
          `하지만 완전히 피하지는 못해 ${combat.monsterName}의 공격으로 ${enemyDamage} 피해를 입었다.\n`;
      } else {
        escapeText +=
          `${combat.monsterName}의 공격이 스쳤지만, 큰 피해 없이 거리를 벌렸다.\n`;
      }

      if (gameState.hp <= 0) {
        gameState.hp = 0;
        gameState.ended = true;

        return {
          text:
            escapeText +
            `\n${gameState.playerName}은 도망에는 성공했지만, 상처를 버티지 못하고 쓰러졌다.\n\n` +
            "엔딩:\n모험은 여기서 끝났다.",
          choices: [],
          dice,
          turn: gameState.turn,
          state: gameState
        };
      }

      return {
        text: escapeText,
        choices: ["숨을 고른다", "멀리 이동한다", "주변을 살핀다"],
        dice,
        turn: gameState.turn,
        state: gameState
      };
    }

    gameState.combat.active = false;

    return {
      text:
        "설명:\n" +
        `${gameState.playerName}은 완벽한 틈을 잡아 전투에서 벗어났다.\n` +
        `${combat.monsterName}은 뒤쫓으려 했지만, 이미 거리는 벌어진 뒤였다.`,
      choices: ["숨을 고른다", "멀리 이동한다", "주변을 살핀다"],
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

  gameState.lastScene =
    `${reward.monsterName}과의 전투는 끝났다. ` +
    `${reward.monsterName}은 쓰러졌고, 플레이어는 전투 이후의 다음 국면으로 넘어간다.`;

  gameState.activeSceneGoal = "";
  gameState.lastSceneSummary = gameState.lastScene;
  gameState.sceneGoalStallCount = 0;

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
  Math.ceil(combat.monsterAttack * 0.75) - gameState.defenseBonus
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
function hasDirectCombatIntent(choice) {
  const text = String(choice || "");

  const combatWords = [
    "공격",
    "싸움",
    "싸운",
    "때린",
    "때리",
    "죽",
    "살해",
    "처치",
    "베",
    "찌르",
    "참수",
    "불태우",
    "쏜다",
    "쏘",
    "박살",
    "전투",
    "덤빈",
    "덤벼",
    "싸움을 건"
  ];

  const softWords = [
    "공격할까",
    "싸울까",
    "죽일까",
    "위협만",
    "겁만",
    "흉내",
    "농담"
  ];

  if (softWords.some((word) => text.includes(word))) {
    return false;
  }

  return combatWords.some((word) => text.includes(word));
}

function inferCombatTargetFromChoice(choice) {
  const text = String(choice || "");

  const targetPatterns = [
    /(.+?)을 공격/,
    /(.+?)를 공격/,
    /(.+?)에게 싸움/,
    /(.+?)와 싸/,
    /(.+?)과 싸/,
    /(.+?)을 때/,
    /(.+?)를 때/,
    /(.+?)을 죽/,
    /(.+?)를 죽/,
    /(.+?)을 처치/,
    /(.+?)를 처치/
  ];

  for (const pattern of targetPatterns) {
    const match = text.match(pattern);

    if (match && match[1]) {
      const target = match[1]
        .replace("나는", "")
        .replace("내가", "")
        .replace("그", "")
        .trim();

      if (target.length >= 1 && target.length <= 20) {
        return target;
      }
    }
  }

  return "상대";
}
function getActionIntent(choice) {
  const text = String(choice || "");

  if (
    text.includes("떠나") ||
    text.includes("벗어나") ||
    text.includes("도망") ||
    text.includes("이동") ||
    text.includes("나간") ||
    text.includes("빠져나")
  ) {
    return "leave";
  }

  if (
    text.includes("공격") ||
    text.includes("죽") ||
    text.includes("처치") ||
    text.includes("베") ||
    text.includes("찌르") ||
    text.includes("일격") ||
    text.includes("불태우") ||
    text.includes("싸운")
  ) {
    return "attack";
  }

  if (
    text.includes("훔치") ||
    text.includes("뺏") ||
    text.includes("빼앗") ||
    text.includes("강탈") ||
    text.includes("털")
  ) {
    return "steal";
  }

  if (
    text.includes("설득") ||
    text.includes("말") ||
    text.includes("대화") ||
    text.includes("협상") ||
    text.includes("사과")
  ) {
    return "talk";
  }

  if (
    text.includes("마법") ||
    text.includes("주문") ||
    text.includes("재우") ||
    text.includes("불") ||
    text.includes("환각")
  ) {
    return "magic";
  }

  return "other";
}

function buildAntiLoopDirective(gameState, playerChoice) {
  const currentIntent = getActionIntent(playerChoice);

  if (gameState.lastIntent === currentIntent) {
    gameState.sameIntentCount += 1;
  } else {
    gameState.sameIntentCount = 0;
  }

  gameState.lastIntent = currentIntent;

  if (gameState.sameIntentCount >= 2) {
    return `
반복 방지 지시:
- 플레이어가 같은 의도의 행동을 여러 번 반복하고 있다.
- 이번 턴에는 반드시 이 행동의 결과를 확정한다.
- 도망치거나 떠나려는 행동이면 성공 또는 실패를 명확히 판정하고, 실패해도 같은 자리에서 무한히 붙잡아두지 않는다.
- 공격하거나 처치하려는 행동이면 죽음, 부상, 항복, 도주, 전투 전환 중 하나로 상황을 확정한다.
- 훔치거나 빼앗으려는 행동이면 성공, 실패, 발각, 추격, 전투 전환 중 하나로 상황을 확정한다.
- “사람들이 싸운다”, “상황이 혼란스럽다”, “무엇을 할까”처럼 결론 없는 문장으로 끝내지 않는다.
- 같은 갈등을 다음 턴으로 그대로 미루지 않는다.
`;
  }

  return "";
}
function includesAny(text, words) {
  return words.some((word) => text.includes(word));
}

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function extractPlayerKeywords(choice) {
  const text = String(choice || "");

  const fixedKeywords = [
    "봉인", "의식", "결계", "마법진", "해제", "파괴",
    "도둑", "훔치", "강탈", "골드", "보수", "임금",
    "수호자", "상인", "여관", "상점", "마을", "던전",
    "공격", "처치", "도망", "탈출", "설득", "협상",
    "마법", "불", "잠", "기", "제물", "문", "열쇠"
  ].filter((keyword) => text.includes(keyword));

  const stopWords = [
    "그리고", "하지만", "그러나", "그래서", "나는", "내가",
    "한다", "했다", "간다", "본다", "한다면", "이제",
    "다시", "계속", "그냥", "일단", "주변", "상황"
  ];

  const words = text
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2)
    .filter((word) => !stopWords.includes(word));

  return [...new Set([...fixedKeywords, ...words])].slice(0, 8);
}

function rememberEventSeed(gameState, seed) {
  if (!gameState.recentEventSeeds) {
    gameState.recentEventSeeds = [];
  }

  gameState.recentEventSeeds.push(seed);
  gameState.recentEventSeeds = gameState.recentEventSeeds.slice(-6);
}

function buildKeywordEventDirective(gameState, playerChoice) {
  const text = String(playerChoice || "").trim();
  const keywords = extractPlayerKeywords(text);

  if (gameState.lastPlayerChoice === text) {
    gameState.sameChoiceTextCount += 1;
  } else {
    gameState.sameChoiceTextCount = 0;
  }

  gameState.lastPlayerChoice = text;

  const eventSeeds = [];

  if (includesAny(text, ["봉인", "의식", "결계", "마법진", "해제", "파괴", "기"])) {
    eventSeeds.push(
      "봉인 대상 내부에서 예상하지 못한 목소리가 들려온다",
      "의식에 필요한 마지막 조건이 구체적으로 드러난다",
      "봉인하려던 힘이 주변 사물 하나를 변질시킨다",
      "의식을 방해하는 제 3자가 난입한다",
      "봉인의 대가로 잃어야 할 것이 분명히 제시된다",
      "기운이 모이는 대신 균열이 열리며 다른 선택지가 생긴다"
    );
  }

  if (includesAny(text, ["훔치", "강탈", "뺏", "빼앗", "도둑", "털"])) {
    eventSeeds.push(
      "도난 대상에게 숨겨진 표식이나 추적 장치가 있다",
      "훔친 물건 때문에 새로운 추격자가 붙는다",
      "주변 목격자가 거래를 제안한다",
      "훔친 물건 안에서 예상 밖의 단서가 나온다",
      "피해자가 단순한 민간인이 아니라 다른 세력과 연결되어 있다"
    );
  }

  if (includesAny(text, ["보수", "임금", "일당", "골드", "돈", "대금"])) {
    eventSeeds.push(
      "보수를 미루던 의뢰인이 대신 위험한 정보를 건넨다",
      "보수 지급 현장에서 다른 채권자가 끼어든다",
      "약속된 금액보다 적은 돈을 주려는 사기가 드러난다",
      "정당한 보수를 받는 대신 추가 의뢰가 열린다",
      "돈을 받는 순간 그 돈의 출처가 문제를 일으킨다"
    );
  }

  if (includesAny(text, ["수호자", "합심", "동맹", "협력", "도움"])) {
    eventSeeds.push(
      "수호자가 협력 조건으로 즉시 해결 가능한 시험을 건다",
      "수호자의 적이 먼저 협상장을 습격한다",
      "수호자가 숨기던 약점이 드러난다",
      "협력 대신 서로의 목적이 충돌한다",
      "수호자가 플레이어의 성격을 시험하는 선택을 던진다"
    );
  }

  if (includesAny(text, ["떠나", "이동", "나간", "도망", "탈출", "길"])) {
    eventSeeds.push(
      "이동한 장소에서 이전 상황과 다른 새 인물이 기다린다",
      "길목이 막혀 우회로와 위험한 지름길 중 하나를 골라야 한다",
      "도망친 뒤에도 따라오는 흔적이 발견된다",
      "새 장소에서 목표와 관련된 단서가 바로 나타난다",
      "이동 중 예상치 못한 거래나 구조 요청을 마주친다"
    );
  }

  if (includesAny(text, ["말", "대화", "설득", "협상", "묻", "질문"])) {
    eventSeeds.push(
      "상대가 대답하는 대신 숨기던 조건을 제시한다",
      "대화 도중 거짓말을 알아챌 단서가 나온다",
      "협상 상대가 제 3자의 이름을 꺼낸다",
      "말 한마디 때문에 주변 인물의 태도가 갈라진다",
      "상대가 정보를 주는 대신 즉시 행동을 요구한다"
    );
  }

  if (includesAny(text, ["공격", "처치", "죽", "베", "찌르", "일격", "불태우"])) {
    eventSeeds.push(
      "공격의 결과로 적이 쓰러지거나 도망치며 상황이 끝난다",
      "공격이 성공하지만 그 대가로 주변 환경이 위험해진다",
      "적이 반격 대신 항복 조건을 내민다",
      "강한 공격이 새로운 적의 주의를 끈다",
      "쓰러진 대상에게서 목표와 관련된 단서가 나온다"
    );
  }

  if (eventSeeds.length === 0) {
    eventSeeds.push(
      "새로운 인물이 등장해 플레이어의 목표와 연결된 정보를 준다",
      "장소가 바뀌거나 상황이 강제로 다음 국면으로 넘어간다",
      "작은 보상이나 손실이 발생해 상태가 실제로 변한다",
      "목표와 관련된 단서가 하나 드러난다",
      "위험한 시간제한이 생긴다",
      "선택지 중 하나가 명확한 대가를 요구한다"
    );
  }

  const recent = gameState.recentEventSeeds || [];
  const candidates = eventSeeds.filter((seed) => !recent.includes(seed));
  const selectedEvent = pickRandom(candidates.length > 0 ? candidates : eventSeeds);

  rememberEventSeed(gameState, selectedEvent);

  return `
새 사건 생성 지시:
- 이번 턴의 핵심 단어: ${keywords.length > 0 ? keywords.join(", ") : "없음"}
- 이번 턴에 반드시 반영할 새 사건: ${selectedEvent}
- 플레이어가 직접 입력한 행동의 핵심 단어를 중심으로 장면을 전개한다.
- 이전 장면과 같은 장소, 같은 대치, 같은 대사, 같은 준비 상태를 반복하지 않는다.
- 플레이어가 쓴 문장을 주인공이 그대로 다시 외치게 하지 말고, 그 행동의 결과와 주변 반응을 보여준다.
- 같은 말을 두 턴 연속 반복하지 않는다.
- 이번 턴에는 새 인물, 새 단서, 새 장애물, 새 보상, 새 손실, 새 장소, 새 위협 중 최소 하나를 반드시 넣는다.
- 사건이 커지더라도 플레이어의 원래 행동 키워드와 연결되어야 한다.
${gameState.sameChoiceTextCount >= 1 ? "- 플레이어가 비슷한 행동을 반복했으므로, 이번에는 반드시 결과를 확정하고 다음 국면으로 넘긴다." : ""}
`;
}

function textTokenSet(text) {
  const stopWords = [
    "설명", "선택지", "그리고", "하지만", "그러나", "이번",
    "상황", "플레이어", "무엇", "한다", "있다", "없다",
    "된다", "했다", "한다면", "그는", "그녀는", "주변"
  ];

  return new Set(
    String(text || "")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .map((word) => word.trim())
      .filter((word) => word.length >= 2)
      .filter((word) => !stopWords.includes(word))
  );
}

function sceneSimilarity(a, b) {
  const setA = textTokenSet(a);
  const setB = textTokenSet(b);

  if (setA.size === 0 || setB.size === 0) {
    return 0;
  }

  let intersection = 0;

  for (const word of setA) {
    if (setB.has(word)) {
      intersection += 1;
    }
  }

  const union = new Set([...setA, ...setB]).size;

  return intersection / union;
}

function isSceneTooSimilar(gameState, aiText) {
  if (!gameState.lastScene) {
    return false;
  }

  const score = sceneSimilarity(gameState.lastScene, aiText);

  if (score >= 0.42) {
    return true;
  }

  if (score >= 0.32 && gameState.sameIntentCount >= 1) {
    return true;
  }

  return false;
}

async function rewriteTooSimilarScene(gameState, playerChoice, aiText) {
  try {
    const keywordDirective = buildKeywordEventDirective(gameState, playerChoice);

    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: "너는 반복되는 RPG 장면을 새 사건 중심으로 다시 쓰는 편집자다."
        },
        {
          role: "user",
          content: `
아래 장면은 직전 장면과 너무 비슷하다.
반드시 새 사건을 넣어서 다시 써라.

플레이어:
이름: ${gameState.playerName}
직업: ${gameState.playerJob}
캐릭터 설정: ${gameState.playerPersonality}
목표: ${gameState.playerGoal}

플레이어 행동:
${playerChoice}

직전 장면:
${gameState.lastScene || "없음"}

반복된 이번 장면:
${aiText}

${keywordDirective}

수정 규칙:
- 주인공이 같은 대사를 다시 외치게 하지 않는다.
- 같은 장소에서 같은 준비만 반복하지 않는다.
- 플레이어 행동 키워드를 중심으로 새 인물, 새 장소, 새 단서, 새 장애물, 새 대가 중 하나를 넣는다.
- 이번 장면 안에서 반드시 상황이 전진해야 한다.
- 봉인/의식/기 모으기 상황이면 성공, 실패, 일부 성공, 대가, 조건 공개, 전투 발생 중 하나로 넘긴다.
- 전투가 필요하면 마지막 줄에 [전투발생:전투대상이름]을 붙인다.
- 골드나 아이템 변화가 있으면 기존 태그 형식을 사용한다.
- 선택지는 3개만 만든다.

출력 형식:

설명:
(새 사건이 들어간 설명)

선택지:
1. (선택지)
2. (선택지)
3. (선택지)
`
        }
      ]
    });

    return response.choices[0].message.content;
  } catch {
    return aiText;
  }
}
function ensureKeeper(gameState) {
  if (!gameState.keeper) {
    gameState.keeper = {
      mainGoalLockedUntilTurn: 35,
      finaleStartTurn: 41,
      recentEventTypes: [],
      currentEventType: "",
      currentChapterGoal: "",
      goalProgressStage: "도입",
      earlyGoalResolutionCount: 0,
      majorObstacles: [],
      revealedTruths: []
    };
  }

  return gameState.keeper;
}

function extractKeeperKeywords(choice) {
  const text = String(choice || "");

  const keywords = [
    "구출", "연애", "결혼", "육아", "훈련", "대회", "친구", "라이벌",
    "퀘스트", "약속", "탐험", "발견", "싸움", "전투", "증거", "요리",
    "퀴즈", "봉인", "의식", "마법", "수호자", "상인", "여관", "던전",
    "도망", "추적", "탈출", "보수", "골드", "훔치", "동행", "배신"
  ].filter((keyword) => text.includes(keyword));

  const words = text
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2)
    .filter((word) => !["그리고", "하지만", "나는", "내가", "한다", "한다면", "그냥", "다시"].includes(word));

  return [...new Set([...keywords, ...words])].slice(0, 8);
}

function pickKeeperEventType(gameState, playerChoice) {
  const keeper = ensureKeeper(gameState);
  const text = String(playerChoice || "");

  const eventPool = [
    "탐험",
    "발견",
    "전투",
    "퀘스트",
    "증거 수집",
    "요리 또는 제작",
    "수수께끼",
    "구출",
    "관계 변화",
    "훈련",
    "대회",
    "거래",
    "추적",
    "라이벌 등장",
    "위기",
    "휴식 후 사건"
  ];

  let preferred = [];

  if (text.includes("구출") || text.includes("찾")) {
    preferred = ["구출", "추적", "증거 수집", "위기", "발견"];
  } else if (text.includes("연애") || text.includes("고백") || text.includes("사랑")) {
    preferred = ["관계 변화", "수수께끼", "위기", "퀘스트", "발견"];
  } else if (text.includes("훈련") || text.includes("수련")) {
    preferred = ["훈련", "대회", "라이벌 등장", "발견", "위기"];
  } else if (text.includes("대회") || text.includes("시합")) {
    preferred = ["대회", "라이벌 등장", "훈련", "증거 수집", "위기"];
  } else if (text.includes("요리") || text.includes("만들")) {
    preferred = ["요리 또는 제작", "거래", "발견", "퀘스트", "위기"];
  } else if (text.includes("증거") || text.includes("조사")) {
    preferred = ["증거 수집", "발견", "추적", "수수께끼", "위기"];
  } else if (text.includes("싸움") || text.includes("공격") || text.includes("처치")) {
    preferred = ["전투", "위기", "라이벌 등장", "발견", "증거 수집"];
  } else {
    preferred = eventPool;
  }

  const recent = keeper.recentEventTypes || [];
  const candidates = preferred.filter((type) => !recent.includes(type));
  const finalCandidates = candidates.length > 0 ? candidates : eventPool.filter((type) => !recent.includes(type));
  const list = finalCandidates.length > 0 ? finalCandidates : eventPool;

  const selected = list[Math.floor(Math.random() * list.length)];

  keeper.currentEventType = selected;
  keeper.recentEventTypes.push(selected);
  keeper.recentEventTypes = keeper.recentEventTypes.slice(-4);

  return selected;
}

function getStoryPhaseDirective(gameState) {
  const turn = gameState.turn;
  const goal = gameState.playerGoal || "미정";

  if (turn <= 10) {
    return `
현재 구간: 기
- 최종 목표 "${goal}"에 바로 도달시키지 않는다.
- 목표의 존재, 단서, 첫 방해물, 조력자, 위험을 배치한다.
- 플레이어가 목표에 너무 빨리 접근하면 문턱, 조건, 열쇠, 시험, 방해꾼을 만든다.
- 이 구간의 목표는 "출발과 문제 인식"이다.
`;
  }

  if (turn <= 25) {
    return `
현재 구간: 승
- 최종 목표를 향해 실제 진전을 준다.
- 단서 획득, 중간 퀘스트, 관계 변화, 첫 승리, 첫 실패를 배치한다.
- 목표를 완전히 해결하지 말고, 해결에 필요한 조건을 1개씩 드러낸다.
- 이 구간의 목표는 "중간 목표 달성과 세계 확장"이다.
`;
  }

  if (turn <= 40) {
    return `
현재 구간: 전
- 목표의 진실, 배후, 강한 방해자, 반전, 대가를 드러낸다.
- 플레이어가 목표에 도달할 수는 있지만, 완전한 엔딩은 아직 이르다.
- 목표를 달성했다면 즉시 후속 문제를 만든다.
- 이 구간의 목표는 "결정적 충돌과 큰 전환"이다.
`;
  }

  return `
현재 구간: 결
- 이제 최종 목표 해결을 허용한다.
- 이전에 쌓은 단서, 관계, 약속, 라이벌, 퀘스트를 회수한다.
- 플레이어 선택에 따라 성공, 실패, 희생, 타협, 새 출발 중 하나로 마무리한다.
- 이 구간의 목표는 "결말과 정산"이다.
`;
}

function buildKeeperDirective(gameState, playerChoice) {
  const keeper = ensureKeeper(gameState);
  const selectedEventType = pickKeeperEventType(gameState, playerChoice);
  const keywords = extractKeeperKeywords(playerChoice);
  const phaseDirective = getStoryPhaseDirective(gameState);
  const turn = gameState.turn;
  const goal = gameState.playerGoal || "미정";

  return `
키퍼 진행 지시:
${phaseDirective}

이번 턴 강제 사건 종류:
- ${selectedEventType}

플레이어 입력 핵심 단어:
- ${keywords.length > 0 ? keywords.join(", ") : "없음"}

진행 원칙:
진행 원칙:
- 새 사건을 무조건 추가하기 전에 직전 사건의 결과를 먼저 정리한다.
- 직전 장면에 구출, 전투, 추격, 시험, 대화, 거래, 의식, 봉인, 요리, 대회, 훈련, 약속 같은 미해결 사건이 있으면 이번 턴은 그 사건의 성공, 실패, 부분 성공, 대가, 다음 조건 중 하나를 먼저 확정한다.
- 이번 장면의 사건 종류는 "${selectedEventType}"이지만, 직전 사건과 충돌하면 직전 사건 정산을 우선한다.
- 플레이어가 직접 입력한 핵심 단어를 장면의 중심 원인으로 삼는다.
- 같은 사건 종류를 2턴 연속 반복하지 않는다.
- 같은 대사, 같은 준비, 같은 대치, 같은 설명을 반복하지 않는다.
- 플레이어가 한 행동은 말로만 반복하지 말고 결과, 반응, 대가, 단서 중 하나로 이어진다.
- 새 인물, 새 단서, 새 장애물, 새 보상, 새 손실, 새 장소, 새 위협은 직전 사건과 연결될 때만 넣는다.
- 새 인물이 등장하면 기존 목표, 현재 사건, 플레이어 행동 중 하나와 어떤 관계인지 반드시 설명한다.
- 플레이어가 전투를 선언했으면 요리, 휴식, 잡담, 일반 대화 이벤트로 덮지 말고 전투 진입, 전투 결과, 전투 회피 대가 중 하나로 이어간다.
- 플레이어가 누군가를 구출했으면 그 인물이 동행하는지, 안전한지, 다쳤는지, 다음 목적지와 어떤 관련이 있는지 정리한다.

최종 목표 관리:
- 플레이어의 최종 목표는 "${goal}"이다.
- ${keeper.mainGoalLockedUntilTurn}턴 전에는 최종 목표를 너무 쉽게 완전 해결하지 않는다.
- 단, 플레이어가 목표에 접근한 보람은 있어야 하므로 단서, 부분 성공, 임시 구출, 조건 달성, 조력자 확보 중 하나는 준다.
- 최종 목표에 너무 일찍 도달한 경우, 그것을 완전한 끝으로 처리하지 말고 다음 국면으로 전환한다.
- 구출 목표라면 구출 후에도 탈출, 보호, 치료, 배후 추적, 추격자, 배신자, 안전한 귀환 같은 후속 문제가 생길 수 있다.
- 단, 구출한 대상을 아무 설명 없이 없는 사람처럼 취급하지 않는다.
- 재납치가 필요하면 반드시 장면 안에서 명확히 납치 과정을 보여준다.
- 연애 목표라면 고백 성공 후에도 신뢰, 경쟁자, 가족 반대, 약속, 위기, 관계 유지 문제로 이어진다.
- 훈련 목표라면 기술 습득 후 시험, 실전, 대회, 라이벌, 부작용으로 이어진다.
- 대회 목표라면 예선, 본선, 부정행위, 라이벌, 결승, 후폭풍으로 이어진다.
- 퀘스트 목표라면 완료 후 보상, 배후, 후속 의뢰, 선택의 대가로 이어진다.
- 약속 목표라면 약속 이행, 지연, 배신, 조건 변경, 증인, 보상으로 이어진다.

금지:
- 최종 목표를 초반에 끝내고 남은 턴을 의미 없이 소비하지 않는다.
- 목표가 끝났다면 즉시 후속 목표를 만들되, 왜 후속 목표가 생겼는지 장면 안에서 납득 가능하게 설명한다.
- “아직 준비가 부족하다”, “기운이 더 모였다”, “무엇을 할까”만으로 턴을 끝내지 않는다.
- 같은 인물이 같은 말을 반복하게 하지 않는다.
- 직전 사건이 끝나지 않았는데 전혀 다른 새 사건으로 덮어씌우지 않는다.
- 전투 직전 상황을 요리, 휴식, 보상 이벤트로 끊지 않는다. 보상이나 요리는 전투 전 준비로 명확히 연결하거나, 전투 후 정산으로 배치한다.
- 구출된 인물을 아무 설명 없이 사라진 사람처럼 취급하지 않는다.
- 목표 인물과 이름이 비슷한 새 인물을 등장시킬 경우, 두 인물의 관계를 즉시 밝힌다.
`;
}
async function rewriteStalledScene(gameState, playerChoice, aiText) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: "너는 RPG 장면 반복을 해결하는 편집자다. 반드시 기존 장면을 결론이 나도록 다시 쓴다."
        },
        {
          role: "user",
          content: `
아래 장면은 같은 상황이 반복되고 있다.
플레이어 행동을 존중해서 이번 장면 안에서 반드시 상황을 진전 또는 종료시켜라.

플레이어:
이름: ${gameState.playerName}
직업: ${gameState.playerJob}
캐릭터 설정: ${gameState.playerPersonality}
목표: ${gameState.playerGoal}

플레이어 행동:
${playerChoice}

반복된 장면:
${aiText}

수정 규칙:
- 같은 장소, 같은 시비, 같은 싸움, 같은 대치 상태를 그대로 유지하지 않는다.
- 플레이어가 벗어나려 했다면 벗어나거나, 실패해도 새로운 장소/추격/전투/대가로 넘어간다.
- 플레이어가 적을 처치하려 했다면 적이 죽거나, 크게 다치거나, 도망치거나, 전투 UI로 넘어갈 만큼 명확한 교전이 시작되어야 한다.
- 플레이어가 강한 공격을 선언했다면 “대충 싸움이 이어졌다”로 넘기지 않는다.
- 결과가 성공이든 실패든 반드시 확정한다.
- 선택지는 3개만 만든다.
- 전투가 필요하면 마지막 줄에 [전투발생:전투대상이름]을 붙인다.
- 골드나 아이템 변화가 있으면 기존 태그 형식을 사용한다.

출력 형식:

설명:
(수정된 설명)

선택지:
1. (선택지)
2. (선택지)
3. (선택지)
`
        }
      ]
    });

    return response.choices[0].message.content;
  } catch {
    return aiText;
  }
}
async function judgeSceneProgress(gameState, playerChoice, aiText) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: "너는 RPG 장면 진행 판정기다. 반드시 JSON만 출력한다."
        },
        {
          role: "user",
          content: `
아래 장면이 이전 장면과 같은 문제를 반복하는지 판정해라.

이전 장면 목표:
${gameState.activeSceneGoal || "없음"}

이전 장면 요약:
${gameState.lastSceneSummary || "없음"}

플레이어 행동:
${playerChoice}

이번 장면:
${aiText}

판정 기준:
- 봉인, 의식, 기 모으기, 문 열기, 설득, 추격, 탈출, 전투 준비, 대치, 협상 같은 장면 목표가 해결되지 않고 같은 준비만 반복되면 stalled를 true로 한다.
- 전투가 발생했지만 전투 후 다시 같은 봉인/의식/대치 상태로 돌아갈 가능성이 높으면 stalled를 true로 한다.
- 목표가 성공, 실패, 파괴, 해제, 봉인 완료, 봉인 실패, 도주, 사망, 항복, 새 장소 이동, 명확한 단서 획득으로 변하면 progressed를 true로 한다.
- 단순히 “기운이 모였다”, “긴장이 커졌다”, “사람들이 바라본다” 정도면 progressed는 false다.
- 목표가 완전히 끝났으면 resolved를 true로 한다.
- 새로운 장면 목표가 생겼으면 activeGoal에 짧게 적는다.
- JSON만 출력한다.

형식:
{
  "activeGoal": "현재 장면 목표",
  "summary": "이번 장면 짧은 요약",
  "stalled": true 또는 false,
  "progressed": true 또는 false,
  "resolved": true 또는 false
}
`
        }
      ]
    });

    return parseJson(response.choices[0].message.content, {
      activeGoal: gameState.activeSceneGoal || "",
      summary: "",
      stalled: false,
      progressed: true,
      resolved: false
    });
  } catch {
    return {
      activeGoal: gameState.activeSceneGoal || "",
      summary: "",
      stalled: false,
      progressed: true,
      resolved: false
    };
  }
}

function applySceneProgressJudge(gameState, judge) {
  const activeGoal = String(judge.activeGoal || "").trim();
  const summary = String(judge.summary || "").trim();

  if (judge.resolved) {
    gameState.activeSceneGoal = "";
    gameState.lastSceneSummary = summary;
    gameState.sceneGoalStallCount = 0;
    return;
  }

  if (activeGoal) {
    if (gameState.activeSceneGoal === activeGoal && judge.stalled && !judge.progressed) {
      gameState.sceneGoalStallCount += 1;
    } else if (gameState.activeSceneGoal === activeGoal && judge.progressed) {
      gameState.sceneGoalStallCount = 0;
    } else {
      gameState.sceneGoalStallCount = 0;
    }

    gameState.activeSceneGoal = activeGoal;
  }

  if (summary) {
    gameState.lastSceneSummary = summary;
  }
}

async function forceResolveSceneGoal(gameState, playerChoice, aiText) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: "너는 반복되는 RPG 장면을 강제로 결론 내는 편집자다."
        },
        {
          role: "user",
          content: `
아래 장면은 너무 오래 반복되고 있다.
이번 출력 안에서 반드시 결론을 내라.

현재 장면 목표:
${gameState.activeSceneGoal || "불명"}

플레이어:
이름: ${gameState.playerName}
직업: ${gameState.playerJob}
캐릭터 설정: ${gameState.playerPersonality}
목표: ${gameState.playerGoal}

플레이어 행동:
${playerChoice}

반복된 장면:
${aiText}

강제 결론 규칙:
- 봉인/의식/기 모으기 상황이면 반드시 아래 중 하나로 결론낸다.
  1. 봉인 성공
  2. 봉인 실패
  3. 봉인 일부 성공 후 대가 발생
  4. 필요한 조건이 명확히 드러나고 새 목표로 전환
  5. 전투 발생
- “기운이 더 모였다”, “의식이 이어졌다”, “아직 부족하다”만으로 끝내지 않는다.
- 전투가 끝난 뒤라면 전투 전 상태로 되돌리지 않는다.
- 플레이어가 강한 행동을 선언했다면 성공/실패/대가를 확정한다.
- 장면은 반드시 다음 국면으로 넘어간다.
- 전투가 필요하면 마지막 줄에 [전투발생:전투대상이름]을 붙인다.
- 골드나 아이템 변화가 있으면 기존 태그 형식을 사용한다.
- 선택지는 3개만 만든다.

출력 형식:

설명:
(결론이 난 설명)

선택지:
1. (선택지)
2. (선택지)
3. (선택지)
`
        }
      ]
    });

    return response.choices[0].message.content;
  } catch {
    return aiText;
  }
}
async function judgeMemoryContradiction(gameState, playerChoice, aiText) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: "너는 RPG 장면 모순 검사관이다. 반드시 JSON만 출력한다."
        },
        {
          role: "user",
          content: `
아래 장면이 장기 기억과 명백히 모순되는지 검사해라.

장기 기억:
${storyMemoryText(gameState)}

플레이어 행동:
${playerChoice}

이번 장면:
${aiText}

검사 규칙:
- 장기 기억과 명백히 충돌할 때만 contradiction을 true로 한다.
- 단순히 새로운 사건이 생긴 것은 모순이 아니다.
- 이미 완료된 사건이 아무 설명 없이 미완료로 되돌아가면 모순이다.
- 이미 구출된 인물을 명확한 재납치/실종 장면 없이 다시 찾고 있다면 모순이다.
- 이미 동행 중인 인물을 아무 설명 없이 없는 사람처럼 취급하면 모순이다.
- 이미 특정 용도로 확정된 아이템이나 단서가 아무 설명 없이 다른 용도로 바뀌면 모순이다.
- 이미 약속, 계약, 관계, 퀘스트 조건이 확정되었는데 장면이 그것을 무시하면 모순이다.
- 반전, 오해, 거짓 정보, 배신, 재납치, 이탈, 사망, 조건 변경이 장면 안에 명확히 묘사되어 있으면 모순이 아닐 수 있다.
- 애매하면 contradiction은 false로 둔다.
- JSON만 출력한다.

형식:
{
  "contradiction": true 또는 false,
  "reasons": ["모순 이유"],
  "fixInstruction": "어떻게 고쳐야 하는지 짧게"
}
`
        }
      ]
    });

    return parseJson(response.choices[0].message.content, {
      contradiction: false,
      reasons: [],
      fixInstruction: ""
    });
  } catch {
    return {
      contradiction: false,
      reasons: [],
      fixInstruction: ""
    };
  }
}

async function rewriteContradictedScene(gameState, playerChoice, aiText, contradictionJudge) {
  try {
    const reasons = Array.isArray(contradictionJudge.reasons)
      ? contradictionJudge.reasons.join("\n")
      : "";

    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: "너는 RPG 장면을 장기 기억과 모순되지 않게 고쳐 쓰는 편집자다."
        },
        {
          role: "user",
          content: `
아래 장면은 장기 기억과 충돌한다.
장기 기억을 우선해서 장면을 다시 써라.

장기 기억:
${storyMemoryText(gameState)}

플레이어 행동:
${playerChoice}

모순 이유:
${reasons || "명확한 이유 없음"}

수정 지시:
${contradictionJudge.fixInstruction || "장기 기억과 충돌하지 않게 고쳐라."}

문제 장면:
${aiText}

수정 규칙:
- 장기 기억에 적힌 확정 사실을 우선한다.
- 이미 완료된 사건을 아무 설명 없이 다시 미완료로 되돌리지 않는다.
- 이미 구출된 인물을 다시 찾고 있는 대상으로 만들지 않는다. 단, 재납치가 필요하면 장면 안에서 재납치 과정을 명확히 보여준다.
- 이미 용도가 확정된 아이템이나 단서는 그 용도를 유지한다.
- 아이템 용도나 퀘스트 조건을 바꾸려면 기존 정보가 거짓, 오해, 반전이었다는 설명을 장면 안에 명확히 넣는다.
- 동행자, 친구, 연인, 배우자, 라이벌, 적대자 관계를 이유 없이 초기화하지 않는다.
- 플레이어 행동의 핵심은 유지하되, 결과가 장기 기억과 맞게 이어지게 한다.
- 전투가 필요하면 마지막 줄에 [전투발생:전투대상이름]을 붙인다.
- 골드나 아이템 변화가 있으면 기존 태그 형식을 사용한다.
- 선택지는 3개만 만든다.

출력 형식:

설명:
(수정된 설명)

선택지:
1. (선택지)
2. (선택지)
3. (선택지)
`
        }
      ]
    });

    return response.choices[0].message.content;
  } catch {
    return aiText;
  }
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
function ensureInn(gameState) {
  if (!gameState.inn) {
    gameState.inn = {
      active: false,
      price: 12
    };
  }

  return gameState.inn;
}

function recoverAtInn(gameState) {
  gameState.hp = gameState.maxHp;
  gameState.mp = gameState.maxMp;

  if (Array.isArray(gameState.party)) {
    gameState.party = gameState.party.map((member) => ({
      ...member,
      hp: member.maxHp ?? member.hp,
      mp: member.maxMp ?? member.mp
    }));
  }
}

function applyInnTheft(gameState) {
  const messages = [];
  const theftHappened = Math.random() < 0.12;

  if (!theftHappened) {
    return messages;
  }

  const goldLoss = Math.min(
    gameState.gold,
    5 + Math.floor(Math.random() * 16)
  );

  if (goldLoss > 0) {
    gameState.gold -= goldLoss;
    messages.push(`자는 사이 도둑에게 ${goldLoss}골드를 빼앗긴 것 같다.`);
  }

  const stealableItems = gameState.inventory.filter((item) => item.amount > 0);

  if (stealableItems.length > 0 && Math.random() < 0.6) {
    const targetItem =
      stealableItems[Math.floor(Math.random() * stealableItems.length)];

    removeItemByName(gameState, targetItem.name);
    messages.push(`자는 사이 ${targetItem.name}을 잃어버린 것 같다.`);
  }

  if (messages.length === 0) {
    messages.push("자는 사이 누군가 짐을 뒤진 흔적이 남았지만, 잃어버린 것은 없었다.");
  }

  return messages;
}

function openInn(gameState) {
  const inn = ensureInn(gameState);

  inn.active = true;
  gameState.shop.active = false;

  return {
    text:
      "설명:\n" +
      `여관에 도착했다. 하룻밤 숙박비는 ${inn.price}골드다.\n` +
      "잠을 자면 자신과 일행의 HP와 MP가 모두 회복된다.",
    choices: [
      `하룻밤 숙박한다 (${inn.price}골드)`,
      "여관 주인에게 소문을 묻는다",
      "여관 나가기"
    ],
    dice: "-",
    turn: gameState.turn,
    state: gameState
  };
}

function handleInn(gameState, choice) {
  const inn = ensureInn(gameState);

  if (
    choice.includes("여관 나가기") ||
    choice.includes("나간다") ||
    choice.includes("떠난다")
  ) {
    inn.active = false;

    return {
      text: "설명:\n여관에서 나왔다.",
      choices: ["주변을 살핀다", "길을 떠난다", "상점을 찾는다"],
      dice: "-",
      turn: gameState.turn,
      state: gameState
    };
  }

  if (
    choice.includes("소문") ||
    choice.includes("정보") ||
    choice.includes("묻는다")
  ) {
    return {
      text:
        "설명:\n" +
        "여관 주인은 잔을 닦으며 주변에서 들은 이야기를 몇 가지 흘렸다.\n" +
        "최근 밤길에 도둑이 늘었고, 몬스터 때문에 마을 밖 의뢰값도 조금 오른 모양이다.",
      choices: [
        `하룻밤 숙박한다 (${inn.price}골드)`,
        "여관 나가기",
        "더 자세히 묻는다"
      ],
      dice: "-",
      turn: gameState.turn,
      state: gameState
    };
  }

  const wantsRest =
    choice.includes("숙박") ||
    choice.includes("잔다") ||
    choice.includes("잠") ||
    choice.includes("쉰다") ||
    choice.includes("방을 빌");

  if (!wantsRest) {
    return {
      text: "설명:\n여관에서는 숙박하거나, 소문을 묻거나, 밖으로 나갈 수 있다.",
      choices: [
        `하룻밤 숙박한다 (${inn.price}골드)`,
        "여관 주인에게 소문을 묻는다",
        "여관 나가기"
      ],
      dice: "-",
      turn: gameState.turn,
      state: gameState
    };
  }

  if (gameState.gold < inn.price) {
    return {
      text:
        "설명:\n" +
        `골드가 부족하다. 숙박하려면 ${inn.price}골드가 필요하다.\n` +
        `현재 보유 골드: ${gameState.gold}`,
      choices: [
        "일거리를 찾는다",
        "여관 주인에게 외상을 부탁한다",
        "여관 나가기"
      ],
      dice: "-",
      turn: gameState.turn,
      state: gameState
    };
  }

  gameState.gold -= inn.price;
  recoverAtInn(gameState);

  const theftMessages = applyInnTheft(gameState);
  inn.active = false;

  let text =
    "설명:\n" +
    `${gameState.playerName}은 ${inn.price}골드를 내고 여관방에서 하룻밤을 보냈다.\n` +
    "몸의 피로가 풀리고, 흐려졌던 정신도 맑아졌다.\n" +
    "자신과 일행의 HP와 MP가 모두 회복되었다.\n\n" +
    "상태 변화:\n" +
    "- HP가 모두 회복되었다.\n" +
    "- MP가 모두 회복되었다.";

  if (theftMessages.length > 0) {
    text +=
      "\n\n사건:\n" +
      theftMessages.map((message) => `- ${message}`).join("\n");
  }

  return {
    text,
    choices: ["아침 식사를 한다", "여관을 나선다", "주변 소문을 확인한다"],
    dice: "-",
    turn: gameState.turn,
    state: gameState
  };
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
function handlePaymentClaim(gameState, choice) {
  const text = String(choice || "");
  const recentContext = [
    gameState.lastScene || "",
    ...(gameState.history || []).slice(-5)
  ].join("\n");

  const wantsPayment =
    text.includes("보수") ||
    text.includes("임금") ||
    text.includes("일당") ||
    text.includes("대금") ||
    text.includes("월급") ||
    text.includes("돈을 받") ||
    text.includes("골드를 받") ||
    text.includes("보상을 받") ||
    text.includes("급료");

  if (!wantsPayment) {
    return null;
  }

  const hasWorkContext =
    recentContext.includes("알바") ||
    recentContext.includes("일을") ||
    recentContext.includes("일했다") ||
    recentContext.includes("일을 끝") ||
    recentContext.includes("의뢰") ||
    recentContext.includes("퀘스트") ||
    recentContext.includes("고용") ||
    recentContext.includes("심부름") ||
    recentContext.includes("노동") ||
    recentContext.includes("보수") ||
    recentContext.includes("임금") ||
    recentContext.includes("일당");

  if (!hasWorkContext) {
    return null;
  }

  const basePay = 12;
  const bonus = Math.floor(Math.random() * 9);
  const pay = basePay + bonus;

  gameState.gold += pay;

  return {
    text:
      "설명:\n" +
      `${gameState.playerName}은 더 이상 말을 돌리지 않고, 끝낸 일에 대한 보수를 요구했다.\n` +
      `상대는 잠시 버티려 했지만 이미 일이 끝난 뒤였다.\n` +
      `결국 약속된 보수로 ${pay}골드를 지급했다.\n\n` +
      "획득/변동:\n" +
      `- 일의 보수로 ${pay}골드를 얻었다.`,
    choices: [
      "받은 골드를 확인한다",
      "다음 장소로 이동한다",
      "추가로 일거리를 묻는다"
    ],
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

function applyRewardData(gameState, rewardData) {
  const messages = [];

  const goldChange = clampNumber(rewardData.goldChange, -100, 100, 0);

  if (goldChange > 0) {
    gameState.gold += goldChange;
    messages.push(`${rewardData.goldReason || "금품 획득"}으로 ${goldChange}골드를 얻었다.`);
  }

  if (goldChange < 0) {
    const loss = Math.min(gameState.gold, Math.abs(goldChange));
    gameState.gold -= loss;
    messages.push(`${rewardData.goldReason || "금품 손실"}으로 ${loss}골드를 잃었다.`);
  }

  const itemsGained = Array.isArray(rewardData.itemsGained)
    ? rewardData.itemsGained
    : [];

  itemsGained.forEach((item) => {
    if (!item || !item.name) return;

    const safeItem = {
      name: String(item.name).trim(),
      type: ALLOWED_ITEM_TYPES.includes(item.type) ? item.type : "attack",
      amount: 1,
      effectValue: clampNumber(item.effectValue, 1, 30, 1),
      consumable: Boolean(item.consumable),
      equipped: false,
      description: String(item.description || "").trim()
    };

    addItem(gameState, safeItem);
    messages.push(`${safeItem.name}을 얻었다.`);
  });

  const itemsLost = Array.isArray(rewardData.itemsLost)
    ? rewardData.itemsLost
    : [];

  itemsLost.forEach((name) => {
    const removed = removeItemByName(gameState, String(name).trim());

    if (removed) {
      messages.push(`${name}을 잃었다.`);
    }
  });

  return messages;
}
async function judgeStoryMemory(gameState, playerChoice, aiText) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: "너는 RPG 장기 기억 관리 담당자다. 반드시 JSON만 출력한다."
        },
        {
          role: "user",
          content: `
아래 장면을 보고 게임 진행에 오래 유지되어야 할 중요한 사실만 장기 기억으로 갱신해라.

현재 장기 기억:
${storyMemoryText(gameState)}

플레이어 행동:
${playerChoice}

이번 장면:
${aiText}

판정 규칙:
- 장면에서 실제로 확정된 사실만 기록한다.
- 추측, 가능성, 분위기, 암시만으로는 기록하지 않는다.
- 인물의 생존, 사망, 구출, 실종, 동행, 이탈, 배신, 보호 상태를 기록한다.
- 아이템의 용도, 소유자, 획득 여부, 사용 조건, 퀘스트 필요 조건을 기록한다.
- 장소, 봉인, 결계, 문, 열쇠, 증거, 단서, 의식 조건처럼 이후 장면에 영향을 주는 설정을 기록한다.
- 연애, 결혼, 가족, 육아, 친구, 라이벌, 스승, 제자, 적대 관계를 기록한다.
- 퀘스트 수락, 진행, 완료, 실패, 보상 미수령, 후속 의뢰를 기록한다.
- 약속, 계약, 거래, 빚, 보수, 맹세, 조건을 기록한다.
- 이미 끝난 사건은 completedThreads에 넣는다.
- 아직 해결되지 않은 사건은 activeThreads에 넣는다.
- 앞으로 어기면 안 되는 설정은 contradictionRules에 넣는다.
- 이미 완료된 일을 명확한 새 사건 없이 다시 미완료로 되돌리지 않는다.
- 이미 특정 용도로 확정된 아이템은 명확한 반전 없이 다른 용도로 바꾸지 않는다.
- 이미 동행자가 된 인물은 명확한 이탈/사망/실종 장면 없이 사라진 것처럼 취급하지 않는다.
- 이미 확정된 관계는 명확한 변화 장면 없이 초기화하지 않는다.
- 장면에 없는 사실을 새로 만들지 않는다.
- 모든 배열에는 짧은 한국어 문장만 넣는다.
- JSON만 출력한다.

형식:
{
  "mainGoal": "주 목표",
  "goalStatus": "진행 중 / 부분 완료 / 완료 / 실패",
  "currentObjective": "현재 목적",

  "canonFacts": ["세계관, 사건, 목표, 장소에 관한 확정 사실"],
  "activeThreads": ["아직 진행 중인 사건이나 문제"],
  "completedThreads": ["이미 완료된 사건"],

  "characterFacts": ["인물 상태, 동행, 사망, 구출, 실종, 정체 관련 사실"],
  "itemFacts": ["아이템, 단서, 열쇠, 조건, 장소, 용도 관련 사실"],
  "relationshipFacts": ["연애, 결혼, 가족, 친구, 라이벌, 적대 관계"],
  "promisesAndContracts": ["약속, 계약, 거래, 보수, 빚, 맹세"],

  "contradictionRules": ["앞으로 어기면 안 되는 모순 방지 규칙"]
}
`
        }
      ]
    });

    return parseJson(response.choices[0].message.content, null);
  } catch {
    return null;
  }
}

function mergeStoryMemory(gameState, memoryUpdate) {
  if (!memoryUpdate) return;

  const memory = ensureStoryMemory(gameState);

  if (memoryUpdate.mainGoal) {
    memory.mainGoal = String(memoryUpdate.mainGoal).trim();
  }

  if (memoryUpdate.goalStatus) {
    memory.goalStatus = String(memoryUpdate.goalStatus).trim();
  }

  if (memoryUpdate.currentObjective) {
    memory.currentObjective = String(memoryUpdate.currentObjective).trim();
  }

  const mergeList = (key, max = 25) => {
    memory[key] = uniqueList([
      ...(memory[key] || []),
      ...(Array.isArray(memoryUpdate[key]) ? memoryUpdate[key] : [])
    ], max);
  };

  mergeList("canonFacts", 30);
  mergeList("activeThreads", 25);
  mergeList("completedThreads", 25);
  mergeList("characterFacts", 30);
  mergeList("itemFacts", 30);
  mergeList("relationshipFacts", 30);
  mergeList("promisesAndContracts", 25);
  mergeList("contradictionRules", 30);

  memory.completedThreads.forEach((completed) => {
    memory.activeThreads = memory.activeThreads.filter(
      (thread) =>
        !thread.includes(completed) &&
        !completed.includes(thread)
    );
  });

  memory.completedThreads.forEach((completed) => {
    memory.contradictionRules.push(
      `완료된 사건 "${completed}"은 명확한 새 사건 없이 다시 미완료 상태로 되돌리지 않는다.`
    );
  });

  memory.itemFacts.forEach((itemFact) => {
    memory.contradictionRules.push(
      `아이템/조건 기록 "${itemFact}"와 충돌하는 용도 변경은 명확한 반전이나 오해 해소 장면 없이 만들지 않는다.`
    );
  });

  memory.characterFacts.forEach((characterFact) => {
    memory.contradictionRules.push(
      `인물 기록 "${characterFact}"와 충돌하는 상태 변경은 명확한 장면 없이 만들지 않는다.`
    );
  });

  memory.relationshipFacts.forEach((relationshipFact) => {
    memory.contradictionRules.push(
      `관계 기록 "${relationshipFact}"는 명확한 변화 장면 없이 초기화하지 않는다.`
    );
  });

  memory.promisesAndContracts.forEach((promiseFact) => {
    memory.contradictionRules.push(
      `약속/계약 기록 "${promiseFact}"는 이행, 파기, 변경 장면 없이 없는 일로 취급하지 않는다.`
    );
  });

  memory.contradictionRules = uniqueList(memory.contradictionRules, 30);
}
async function judgeStoryRewards(gameState, playerChoice, aiText) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: "너는 중세 판타지 RPG 보상 판정기다. 반드시 JSON만 출력한다."
        },
        {
          role: "user",
          content: `
아래 내용을 보고 실제로 플레이어의 골드나 인벤토리가 바뀌었는지 판정해라.

플레이어 상태:
이름: ${gameState.playerName}
직업: ${gameState.playerJob}
현재 골드: ${gameState.gold}
현재 인벤토리: ${inventoryText(gameState)}

플레이어 행동:
${playerChoice}

진행된 장면:
${aiText}

판정 규칙:
- 플레이어가 금품을 훔치거나 빼앗는 데 성공했다면 goldChange를 양수로 한다.
- NPC가 돈을 주거나 보상으로 지급했다면 goldChange를 양수로 한다.
- 벌금, 배상, 도난, 지불이 발생했다면 goldChange를 음수로 한다.
- 단순히 시도만 했고 실패했다면 goldChange는 0이다.
- 장면에 명확히 아이템을 얻었다고 나오면 itemsGained에 넣는다.
- 장면에 명확히 아이템을 잃었다고 나오면 itemsLost에 넣는다.
- 장면에 없는 보상을 새로 만들지 않는다.
- 골드 변화는 -100~100 사이로 제한한다.
- 아이템 type은 hp, mp, attack, defense, magic, heal 중 하나만 쓴다.
- 회복 음식, 약초, 차, 포션은 hp 또는 mp로 둔다.
- 무기, 목걸이, 반지, 부적은 attack, defense, magic, heal 중 적절히 둔다.
- JSON만 출력한다.

형식:
{
  "goldChange": 숫자,
  "goldReason": "짧은 이유",
  "itemsGained": [
    {
      "name": "아이템 이름",
      "type": "attack",
      "effectValue": 숫자,
      "consumable": true 또는 false,
      "description": "짧은 설명"
    }
  ],
  "itemsLost": ["아이템 이름"]
}
`
        }
      ]
    });

    return parseJson(response.choices[0].message.content, {
      goldChange: 0,
      goldReason: "",
      itemsGained: [],
      itemsLost: []
    });
  } catch {
    return {
      goldChange: 0,
      goldReason: "",
      itemsGained: [],
      itemsLost: []
    };
  }
}
function applyStoryStateData(gameState, stateData) {
  const messages = [];

  const hpChange = clampNumber(stateData.hpChange, -50, 50, 0);
  const mpChange = clampNumber(stateData.mpChange, -50, 50, 0);

  if (hpChange > 0) {
    const before = gameState.hp;
    gameState.hp = Math.min(gameState.maxHp, gameState.hp + hpChange);
    const actualHeal = gameState.hp - before;

    if (actualHeal > 0) {
      messages.push(`${stateData.hpReason || "회복"}으로 HP가 ${actualHeal} 회복되었다.`);
    }
  }

  if (hpChange < 0) {
    const damage = Math.min(gameState.hp, Math.abs(hpChange));
    gameState.hp -= damage;

    if (damage > 0) {
      messages.push(`${stateData.hpReason || "피해"}으로 HP가 ${damage} 감소했다.`);
    }

    if (gameState.hp <= 0) {
      gameState.hp = 0;
      gameState.ended = true;
      messages.push("HP가 0이 되어 모험을 계속할 수 없게 되었다.");
    }
  }

  if (mpChange > 0) {
    const before = gameState.mp;
    gameState.mp = Math.min(gameState.maxMp, gameState.mp + mpChange);
    const actualRecovery = gameState.mp - before;

    if (actualRecovery > 0) {
      messages.push(`${stateData.mpReason || "마력 회복"}으로 MP가 ${actualRecovery} 회복되었다.`);
    }
  }

  if (mpChange < 0) {
    const cost = Math.min(gameState.mp, Math.abs(mpChange));
    gameState.mp -= cost;

    if (cost > 0) {
      messages.push(`${stateData.mpReason || "마법 사용"}으로 MP가 ${cost} 소모되었다.`);
    }

    if (cost < Math.abs(mpChange)) {
      messages.push("필요한 MP보다 보유 MP가 부족해, 남은 MP를 전부 소모했다.");
    }
  }

  return messages;
}

async function judgeStoryStateChanges(gameState, playerChoice, aiText) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: "너는 중세 판타지 RPG 상태 변화 판정기다. 반드시 JSON만 출력한다."
        },
        {
          role: "user",
          content: `
아래 내용을 보고 일반 스토리 진행 중 플레이어의 HP 또는 MP가 실제로 변해야 하는지 판정해라.

플레이어 상태:
이름: ${gameState.playerName}
직업: ${gameState.playerJob}
HP: ${gameState.hp}/${gameState.maxHp}
MP: ${gameState.mp}/${gameState.maxMp}
공격 보정: ${gameState.attackBonus}
회복 보정: ${gameState.healBonus}
방어 보정: ${gameState.defenseBonus}
마법 보정: ${gameState.magicBonus}

플레이어 행동:
${playerChoice}

진행된 장면:
${aiText}

판정 규칙:
- 플레이어가 전투가 아닌 일반 장면에서 마법을 사용했다면 MP를 소모시킨다.
- 예: 사람을 재움, 불을 피움, 문을 마법으로 엶, 환각을 만듦, 치료 마법 사용, 물건을 띄움.
- 단순 대화, 걷기, 관찰, 돈 거래, 훔치기만으로는 MP를 소모하지 않는다.
- 마법이 아니라 손기술, 협박, 은신, 도구 사용이면 MP를 소모하지 않는다.
- 신체적으로 다치거나 맞거나 넘어지거나 독을 마셨다면 HP를 감소시킨다.
- 치료 마법을 사용했다면 HP는 회복될 수 있지만 MP는 반드시 감소해야 한다.
- 휴식, 식사, 치료를 명확히 받았다면 HP를 회복할 수 있다.
- 마나 포션이나 명확한 마력 회복 수단이 없으면 MP는 회복하지 않는다.
- 이미 전투 수치가 처리되는 전투 장면이면 여기서는 HP/MP 변화를 만들지 않는다.
- 변화가 애매하면 0으로 둔다.
- hpChange와 mpChange는 -50부터 50 사이 숫자다.
- 감소는 음수, 회복은 양수다.
- JSON만 출력한다.

형식:
{
  "hpChange": 숫자,
  "hpReason": "짧은 이유",
  "mpChange": 숫자,
  "mpReason": "짧은 이유"
}
`
        }
      ]
    });

    return parseJson(response.choices[0].message.content, {
      hpChange: 0,
      hpReason: "",
      mpChange: 0,
      mpReason: ""
    });
  } catch {
    return {
      hpChange: 0,
      hpReason: "",
      mpChange: 0,
      mpReason: ""
    };
  }
}
app.post("/start", async (req, res) => {
  try {
    const {
  playerName,
  playerJob,
  worldSetting,
  playerPersonality,
  playerGoal,
  sessionId
} = req.body;

    const gameState = resetGameState(sessionId);

    gameState.playerName = playerName || "이름 없는 자";
    gameState.playerJob = playerJob || "모험가";
    gameState.worldSetting =
  worldSetting ||
  "이곳은 흔히 아는 몬스터가 나타나는 판타지 RPG의 세계이며, 당신은 중대한 목표를 가지고 있습니다.";

gameState.playerPersonality =
  playerPersonality ||
  "특별히 정해지지 않은 성격";

gameState.playerGoal =
  playerGoal ||
  "아직 정하지 못한 중대한 목표";
  ensureStoryMemory(gameState);

gameState.storyMemory.mainGoal = gameState.playerGoal;
gameState.storyMemory.goalStatus = "진행 중";
gameState.storyMemory.currentObjective = gameState.playerGoal;

gameState.storyMemory.canonFacts = [
  `플레이어의 중대한 목표는 "${gameState.playerGoal}"이다.`,
  `플레이어의 캐릭터 설정은 "${gameState.playerPersonality}"이다.`
];

gameState.storyMemory.activeThreads = [
  `주 목표 "${gameState.playerGoal}"는 아직 해결되지 않았다.`
];

gameState.storyMemory.characterFacts = [
  `플레이어 캐릭터 설정: ${gameState.playerPersonality}`
];

gameState.storyMemory.contradictionRules = [
  `플레이어의 캐릭터 설정 "${gameState.playerPersonality}"와 충돌하는 묘사를 명확한 변화 장면 없이 만들지 않는다.`,
  `주 목표 "${gameState.playerGoal}"를 명확한 완료 장면 없이 완료된 것처럼 처리하지 않는다.`
];
  

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

    ensureInn(gameState);

if (gameState.inn.active) {
  return res.json(handleInn(gameState, playerChoice));
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
    const wantsInn =
  playerChoice.includes("여관") ||
  playerChoice.includes("숙소") ||
  playerChoice.includes("숙박") ||
  playerChoice.includes("방을 빌");

if (wantsInn) {
  ensureInn(gameState);

  const wantsDirectRest =
    playerChoice.includes("숙박") ||
    playerChoice.includes("잔다") ||
    playerChoice.includes("잠") ||
    playerChoice.includes("쉰다") ||
    playerChoice.includes("방을 빌");

  if (wantsDirectRest) {
    gameState.inn.active = true;
    return res.json(handleInn(gameState, "하룻밤 숙박한다"));
  }

  return res.json(openInn(gameState));
}

    const paymentClaimResult = handlePaymentClaim(gameState, playerChoice);
if (paymentClaimResult) {
  return res.json(paymentClaimResult);
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
      const antiLoopDirective = buildAntiLoopDirective(gameState, playerChoice);
      const keeperDirective = buildKeeperDirective(gameState, playerChoice);
      const keywordEventDirective = buildKeywordEventDirective(gameState, playerChoice);

    const prompt = `
세계관:
${gameState.worldSetting}

기본 규칙:
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
캐릭터 설정: ${gameState.playerPersonality}
중대한 목표: ${gameState.playerGoal}
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

${storyMemoryText(gameState)}

${diceText}

${antiLoopDirective}
${keeperDirective}

${keywordEventDirective}

규칙:
[최우선 원칙]
- 플레이어 선택을 최우선으로 따른다.
- 플레이어 행동을 무시하거나 온건하게 바꾸지 않는다.
- 플레이어가 직접 한 행동을 도덕적으로 순화해서 반대 행동으로 바꾸지 않는다.
- 플레이어의 캐릭터 설정은 행동 방식, 말투, 주변 반응, 외형 묘사에 반영한다.
- 캐릭터 설정은 행동의 태도, 말투, 망설임, 죄책감, 주변 반응에만 반영한다.
- 캐릭터가 온순하거나 착하더라도, 플레이어가 직접 공격, 살해, 협박, 강탈, 방화, 도주, 배신 같은 행동을 입력하면 그 행동 자체를 취소하거나 순화하지 않는다.
- 온순한 캐릭터가 싸움을 걸면 망설이거나 떨거나 죄책감을 느낄 수는 있지만, 플레이어가 입력한 공격 의도는 실제 사건으로 처리한다.
- 플레이어가 명확히 싸움을 걸거나 공격을 선언하면 전투 시작, 즉시 제압, 실패, 반격, 도주, 협상 중 하나로 결과를 확정한다.
- 플레이어가 명확히 공격했는데 “말로 타일렀다”, “조용히 물러났다”, “갈등이 흐려졌다”처럼 행동을 바꾸지 않는다.

[장기 기억]
- 장기 기억에 적힌 확정 사실, 진행 중인 사건, 완료된 사건, 인물 상태, 아이템 용도, 관계, 약속, 계약을 우선한다.
- 직전 장면과 장기 기억이 충돌하면 장기 기억을 기준으로 한다.
- 이미 완료된 사건은 명확한 새 사건 없이 다시 미완료로 되돌리지 않는다.
- 이미 특정 용도로 확정된 아이템이나 단서는 명확한 반전, 오해 해소, 거짓 정보였다는 설명 없이 다른 용도로 바꾸지 않는다.
- 이미 동행자, 친구, 연인, 배우자, 라이벌, 적으로 확정된 인물 관계는 명확한 변화 장면 없이 초기화하지 않는다.
- 중요한 사실이 바뀌면 장면 안에서 그 변화 과정을 명확히 보여준다.
- 하나의 큰 사건은 여러 턴 동안 이어질 수 있다.
- 단, 매 턴 같은 상태를 반복하지 말고 하위 단계를 바꾼다.
- 장기 사건은 조사, 단서 획득, 자료 수집, 길찾기, 잡몹 처리, 협상, 함정 돌파, 중간 전투, 핵심 전투, 승리 후 정산, 휴식, 다음 목표 토론 같은 단계로 나누어 진행한다.
- “같은 사건 반복 금지”는 큰 사건을 빨리 끝내라는 뜻이 아니라, 같은 준비 상태나 같은 대사를 반복하지 말라는 뜻이다.
- 플레이어가 4천왕, 대회, 장기 퀘스트, 구출 작전, 훈련, 연애 관계, 여행 같은 긴 목표를 진행 중이면 2턴 안에 끝내지 않는다.
- 긴 목표는 매 턴 진행도, 새 정보, 장애물, 비용, 위험, 보상 중 하나가 달라져야 한다.
- 장기 사건이 끝나면 반드시 전투 후 정산, 부상 회복, 획득 정보 확인, 다음 여정 토론 중 하나로 마무리한다.

[스토리 진행]
- 에이아이는 단순 서술자가 아니라 티알피지 진행자처럼 장면을 운영한다.
- 플레이어의 중대한 목표를 장기 목표로 삼고, 현재 구간에 맞춰 사건을 배치한다.
- 1~10턴은 도입, 11~25턴은 확장, 26~40턴은 전환, 41~50턴은 결말로 진행한다.
- 50턴이 되기 전에는 최종 엔딩을 내지 않는다.
- 50턴에서는 선택지를 만들지 말고 최종 엔딩 지문만 작성한다.
- 최종 목표는 후반부 전까지 쉽게 완결하지 않는다.
- 최종 목표에 빨리 닿았을 경우 완전한 종료가 아니라 부분 성공, 후속 문제, 배후 발견, 탈출, 보호, 추격, 새로운 조건으로 이어간다.

[직전 사건 정산]
- 새 사건을 만들기 전에 직전 사건의 결과를 먼저 정산한다.
- 직전 사건이 해결되지 않았으면 이번 턴은 그 사건을 성공, 실패, 부분 성공, 대가 발생, 조건 공개 중 하나로 진전시킨다.
- 이전 선택지의 결과가 다음 장면에서 사라지지 않게 한다.
- 구출한 인물이 있으면 그 인물의 현재 상태, 위치, 동행 여부, 다음 목표와의 관련성을 유지한다.
- 새 인물이 등장하면 기존 목표나 현재 사건과의 관계를 반드시 설명한다.
- 목표와 연결된 장기 사건은 여러 턴 이어져도 되지만, 목표와 무관한 곁가지 사건은 1턴 이상 끌지 않는다.
- 같은 종류의 큰 사건은 이어져도 되지만, 같은 하위 상황을 2턴 연속 반복하지 않는다.

[반복 방지]
- 같은 장소, 같은 시비, 같은 대치, 같은 싸움, 같은 준비 상태를 2턴 이상 반복하지 않는다.
- 같은 대사, 같은 준비, 같은 설명을 두 턴 연속 반복하지 않는다.
- 플레이어가 직접 쓴 대사를 주인공이 매 턴 그대로 반복하게 하지 않는다.
- “싸움이 이어졌다”, “상황이 이어진다”, “아직 부족하다”, “기운이 더 모였다”, “이제 무엇을 할까”만으로 장면을 끝내지 않는다.
- 플레이어가 특정 행동을 직접 입력하면 그 행동의 결과, 반응, 대가, 단서 중 하나를 반드시 보여준다.
- 같은 종류의 큰 사건은 이어져도 되지만, 같은 하위 상황을 2턴 연속 반복하지 않는다.
- 장기 사건은 조사, 단서 획득, 자료 수집, 길찾기, 잡몹 처리, 협상, 함정 돌파, 중간 전투, 핵심 전투, 승리 후 정산, 휴식, 다음 목표 토론 같은 단계로 나누어 진행한다.

[사건 다양화]
- 탐험, 발견, 전투, 퀘스트, 증거 수집, 요리, 수수께끼, 구출, 관계 변화, 훈련, 대회, 거래, 추적, 라이벌, 위기, 휴식 후 사건을 섞어서 사용한다.
- 같은 큰 사건은 여러 턴 동안 진행해도 된다.
- 단, 매 턴 하위 단계가 달라져야 한다.
- 같은 장소, 같은 대치, 같은 준비, 같은 말만 반복하는 것은 금지한다.
- 장기 사건은 조사, 이동, 장애물, 전투, 보상, 휴식, 다음 목표 정리처럼 단계가 바뀌며 진행되어야 한다.
- 플레이어가 직접 입력한 문장의 핵심 단어를 이번 장면의 중심축으로 삼는다.
- 매 턴 이전 장면과 다른 새 전개를 넣되, 직전 사건의 정산을 먼저 끝낸다.
- 보상, 요리, 휴식, 정보 제공은 현재 사건 흐름을 끊지 말고 전투 준비, 전투 후 정산, 이동 중 사건처럼 자연스럽게 배치한다.

[전투]
- 실제 물리적 전투가 시작되는 장면이라면 마지막 줄에 [전투발생:전투대상이름]을 출력할 수 있다.
- 플레이어가 전투를 선언하면 전투를 회피시키거나 다른 이벤트로 덮지 말고, 전투 시작, 전투 결과, 도주, 협상, 대가 중 하나로 처리한다.
- 전투 수치 계산은 코드가 하므로 인공지능은 전투 데미지와 HP 계산을 하지 않는다.
- 전투가 끝난 뒤에는 전투 전 장면으로 되돌리지 말고 반드시 다음 국면으로 넘어간다.
- 일반 장면에서는 주사위를 언급하지 않는다.

[돈과 아이템]
- 상황상 돈을 쓸 수 있으면 [골드사용:이름:비용:효과] 형식을 한 줄로 추가할 수 있다.
- 플레이어가 돈을 얻는 행동에 성공하면 [골드획득:금액:이유] 형식을 한 줄로 추가한다.
- 플레이어가 돈을 잃으면 [골드손실:금액:이유] 형식을 한 줄로 추가한다.
- 플레이어가 아이템을 얻으면 [아이템획득:이름:type:effectValue:consumable:설명] 형식을 한 줄로 추가한다.
- type은 hp, mp, attack, defense, magic, heal 중 하나만 쓴다.
- consumable은 true 또는 false만 쓴다.
- 플레이어가 아이템을 잃으면 [아이템손실:이름] 형식을 한 줄로 추가한다.
- NPC가 선물하거나, 플레이어가 훔치거나, 빼앗거나, 보상으로 받거나, 주워도 실제 획득으로 처리한다.

[상점과 여관]
- 상인이나 상점이 등장하면 상황에 맞는 물건을 살 수 있다.
- 모든 선택지를 유료 선택지나 상점 아이템 요구로만 만들지 않는다.
- 유료 해결책이 있더라도 무료 해결책, 위험한 해결책, 우회 해결책 중 하나는 반드시 남긴다.
- 상인을 공격하거나 협박하거나 훔치려는 행동을 상점 이용으로 바꾸지 않는다.
- 마을이나 도시에는 여관이 있을 수 있다.
- 플레이어가 여관이나 숙소를 찾으면 여관 이용 선택지를 제공할 수 있다.
- 여관에서 돈을 내고 자면 HP와 MP가 모두 회복된다.
- 여관 숙박 중에는 낮은 확률로 도둑에게 골드나 아이템을 잃을 수 있다.
- 여관 숙박비 계산과 회복 처리는 서버가 담당한다.

[보수와 약속]
- 플레이어가 일을 끝냈고 보수를 요구하면 보수 지급, 거절, 사기, 협박, 전투 중 하나로 즉시 결론낸다.
- 보수 지급 장면을 2턴 이상 미루지 않는다.
- 마을 사람이나 NPC가 아무 대가 없이 플레이어의 노동만 가져가고 같은 상황을 반복하지 않는다.

[마법과 상태 변화]
- 플레이어가 일반 장면에서 마법을 사용하면 장면에 그 마법 사용이 드러나게 작성한다.
- MP 소모 수치 계산은 서버가 따로 처리한다.
- 회복, 피해, 마력 소모, 상태 변화가 명확한 장면이면 그 원인이 드러나야 한다.

[출력]
- 설명은 6~10문장.
- 분위기와 대사를 섞는다.
- 선택지는 반드시 3개.
- 출력 형식을 지킨다.
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

if (gameState.sameIntentCount >= 3) {
  aiText = await rewriteStalledScene(gameState, playerChoice, aiText);
  gameState.sameIntentCount = 0;
}

if (isSceneTooSimilar(gameState, aiText)) {
  aiText = await rewriteTooSimilarScene(gameState, playerChoice, aiText);
}

const sceneProgressJudge = await judgeSceneProgress(gameState, playerChoice, aiText);
applySceneProgressJudge(gameState, sceneProgressJudge);

if (gameState.sceneGoalStallCount >= 2) {
  aiText = await forceResolveSceneGoal(gameState, playerChoice, aiText);
  gameState.sceneGoalStallCount = 0;
  gameState.activeSceneGoal = "";
}

const contradictionJudge = await judgeMemoryContradiction(gameState, playerChoice, aiText);

if (contradictionJudge.contradiction) {
  aiText = await rewriteContradictedScene(
    gameState,
    playerChoice,
    aiText,
    contradictionJudge
  );
}

aiText = parseGoldUses(gameState, aiText);

    const storyRewardResult = applyStoryRewards(gameState, aiText);
aiText = storyRewardResult.text;

let rewardMessages = [...storyRewardResult.messages];

if (rewardMessages.length === 0) {
  const judgedReward = await judgeStoryRewards(gameState, playerChoice, aiText);
  rewardMessages = applyRewardData(gameState, judgedReward);
}

if (rewardMessages.length > 0) {
  aiText +=
    "\n\n획득/변동:\n" +
    rewardMessages.map((message) => `- ${message}`).join("\n");
}
    const judgedStateChange = await judgeStoryStateChanges(gameState, playerChoice, aiText);
    const stateMessages = applyStoryStateData(gameState, judgedStateChange);

    if (stateMessages.length > 0) {
      aiText +=
        "\n\n상태 변화:\n" +
        stateMessages.map((message) => `- ${message}`).join("\n");
    }

    if (gameState.ended) {
      return res.json({
        text:
          aiText +
          "\n\n엔딩:\n무리한 행동의 대가로 모험은 여기서 끝났다.",
        choices: [],
        dice: "-",
        turn: gameState.turn,
        state: gameState
      });
    }
    const explicitCombatMatch = aiText.match(/\[전투발생:(.+?)\]/);
let combatJudgement = { combat: false, target: "" };

if (explicitCombatMatch) {
  combatJudgement = {
    combat: true,
    target: explicitCombatMatch[1].trim() || "적"
  };
} else if (hasDirectCombatIntent(playerChoice)) {
  combatJudgement = {
    combat: true,
    target: inferCombatTargetFromChoice(playerChoice)
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
    const memoryUpdate = await judgeStoryMemory(gameState, playerChoice, aiText);
mergeStoryMemory(gameState, memoryUpdate);

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