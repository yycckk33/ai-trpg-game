let sessionId = localStorage.getItem("trpgSessionId");

if (!sessionId) {
  sessionId = crypto.randomUUID();
  localStorage.setItem("trpgSessionId", sessionId);
}

function updateStatus(state) {
  if (!state) return;

  const personality = state.playerPersonality || "미정";
  const goal = state.playerGoal || "미정";

  document.getElementById("playerInfo").innerHTML =
    `이름: ${state.playerName || "이름 없는 자"}<br>` +
    `직업: ${state.playerJob || "모험가"}<br>` +
    `성격: ${personality}<br>` +
    `목표: ${goal}<br>` +
    `HP: ${state.hp}/${state.maxHp}<br>` +
    `MP: ${state.mp}/${state.maxMp}<br>` +
    `공격 보정: +${state.attackBonus}<br>` +
    `회복 보정: +${state.healBonus}<br>` +
    `방어 보정: +${state.defenseBonus}<br>` +
    `마법 보정: +${state.magicBonus}<br>` +
    `골드: ${state.gold}`;
}

function updateInventory(state) {
  const info = document.getElementById("inventoryInfo");
  const buttons = document.getElementById("inventoryButtons");

  if (!state || !state.inventory || state.inventory.length === 0) {
    info.innerHTML = "없음";
    buttons.innerHTML = "";
    return;
  }

  info.innerHTML = state.inventory
    .map((item) => {
      const equippedText = item.equipped ? " (장착됨)" : "";
      const description = item.description ? ` - ${item.description}` : "";
      return `${item.name} x${item.amount}${equippedText}${description}`;
    })
    .join("<br>");

  buttons.innerHTML = "";

  if (
    state.ended ||
    (state.combat && state.combat.active) ||
    (state.shop && state.shop.active)
  ) {
    return;
  }

  state.inventory.forEach((item) => {
    const button = document.createElement("button");
    button.textContent = `${item.name} 사용`;
    button.onclick = () => sendChoice(`${item.name} 사용`);
    buttons.appendChild(button);
  });
}

function updateCombat(state) {
  const combatBox = document.getElementById("combatBox");
  const combatInfo = document.getElementById("combatInfo");

  if (!state || !state.combat || !state.combat.active) {
    combatBox.style.display = "none";
    combatInfo.innerHTML = "";
    return;
  }

  combatBox.style.display = "block";

  combatInfo.innerHTML =
    `적: ${state.combat.monsterName}<br>` +
    `적 HP: ${state.combat.monsterHp}/${state.combat.monsterMaxHp}<br>` +
    `적 공격력: ${state.combat.monsterAttack}`;
}

function updateShop(state) {
  const shopBox = document.getElementById("shopBox");
  const shopInfo = document.getElementById("shopInfo");
  const shopButtons = document.getElementById("shopButtons");

  if (!state || !state.shop || !state.shop.active) {
    shopBox.style.display = "none";
    shopInfo.innerHTML = "";
    shopButtons.innerHTML = "";
    return;
  }

  shopBox.style.display = "block";

  const items = state.shop.items || [];

  shopInfo.innerHTML =
    `보유 골드: ${state.gold}<br><br>` +
    items
      .map((item) => {
        const itemType = item.consumable ? "소모품" : "장비/영구 효과";
        const description = item.description || "설명 없음";

        return (
          `${item.name} - ${item.price}골드<br>` +
          `종류: ${itemType}<br>` +
          `효과: ${description}`
        );
      })
      .join("<br><br>");

  shopButtons.innerHTML = "";

  items.forEach((item) => {
    const button = document.createElement("button");
    button.textContent = `${item.name} 구매`;
    button.onclick = () => sendChoice(`${item.name} 구매`);
    shopButtons.appendChild(button);
  });

  const exitButton = document.createElement("button");
  exitButton.textContent = "상점 나가기";
  exitButton.onclick = () => sendChoice("상점 나가기");
  shopButtons.appendChild(exitButton);
}

function renderChoices(state, choices) {
  const choiceButtons = document.getElementById("choiceButtons");
  choiceButtons.innerHTML = "";

  if (!choices || choices.length === 0) return;

  if (state && state.shop && state.shop.active) {
    return;
  }

  if (state && state.ended) {
    return;
  }

  choices.forEach((choice) => {
    const button = document.createElement("button");
    button.textContent = choice;
    button.onclick = () => sendChoice(choice);
    choiceButtons.appendChild(button);
  });
}

function updateAll(data) {
  const state = data.state;

  updateStatus(state);
  updateInventory(state);
  updateCombat(state);
  updateShop(state);
  renderChoices(state, data.choices || []);
}

async function startGame() {
  const playerName =
    document.getElementById("nameInput").value.trim() || "이름 없는 자";

  const playerJob =
    document.getElementById("jobInput").value.trim() || "모험가";

  const worldSetting =
    document.getElementById("worldInput").value.trim() ||
    "이곳은 흔히 아는 몬스터가 나타나는 판타지 RPG의 세계이며, 당신은 중대한 목표를 가지고 있습니다.";

  const playerPersonality =
    document.getElementById("personalityInput").value.trim() ||
    "특별히 정해지지 않은 성격";

  const playerGoal =
    document.getElementById("goalInput").value.trim() ||
    "아직 정하지 못한 중대한 목표";

  const response = await fetch("/start", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      sessionId,
      playerName,
      playerJob,
      worldSetting,
      playerPersonality,
      playerGoal
    })
  });

  const data = await response.json();

  document.getElementById("startScreen").style.display = "none";
  document.getElementById("gameScreen").style.display = "block";

  updateStatus(data.state);
  updateInventory(data.state);
  updateCombat(data.state);
  updateShop(data.state);

  await sendChoice("게임 시작");
}

async function sendChoice(choiceText) {
  const input = document.getElementById("choiceInput");
  const story = document.getElementById("story");
  const turnBox = document.getElementById("turn");
  const diceBox = document.getElementById("dice");

  const choice = choiceText || input.value.trim() || "주변을 살핀다";

  story.textContent = "진행 중...";

  const response = await fetch("/next", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      sessionId,
      choice
    })
  });

  const data = await response.json();

  story.textContent = data.text || "응답 없음";
  turnBox.textContent = "턴: " + (data.turn ?? 1);
  diceBox.textContent = "주사위: " + (data.dice ?? "-");

  updateAll(data);

  input.value = "";
}

async function resetGame() {
  await fetch("/reset", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      sessionId
    })
  });

  location.reload();
}

function newPlayerSession() {
  localStorage.removeItem("trpgSessionId");
  location.reload();
}