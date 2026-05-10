function getSessionId() {
  let sessionId = localStorage.getItem("trpgSessionId");

  if (!sessionId) {
    sessionId = crypto.randomUUID();
    localStorage.setItem("trpgSessionId", sessionId);
  }

  return sessionId;
}

function updateStatus(state) {
  if (!state) return;

  document.getElementById("playerInfo").innerHTML =
    `이름: ${state.playerName}<br>` +
    `직업: ${state.playerJob}<br>` +
    `HP: ${state.hp}/${state.maxHp}<br>` +
    `MP: ${state.mp}/${state.maxMp}<br>` +
    `공격 보정: +${state.attackBonus}<br>` +
    `회복 보정: +${state.healBonus}<br>` +
    `방어 보정: +${state.defenseBonus}<br>` +
    `마법 보정: +${state.magicBonus}<br>` +
    `골드: ${state.gold}`;
}

function updateInventory(state) {
  const inventoryInfo = document.getElementById("inventoryInfo");
  const itemButtons = document.getElementById("itemButtons");

  if (!state || !state.inventory || state.inventory.length === 0) {
    inventoryInfo.innerHTML = "없음";
    itemButtons.innerHTML = "";
    return;
  }

  inventoryInfo.innerHTML = state.inventory
    .map((item) => {
      const desc = item.description ? ` - ${item.description}` : "";
      const equipped = item.equipped ? " 장착됨" : "";
      return `${item.name} x${item.amount}${equipped}${desc}`;
    })
    .join("<br>");

  itemButtons.innerHTML = "";

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
    itemButtons.appendChild(button);
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
        const desc = item.description ? `<br>${item.description}` : "";
        const typeText = item.consumable ? "소모품" : "장비/영구 효과";
        return `${item.name}: ${item.price}골드 (${typeText})${desc}`;
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

function updateAll(state) {
  updateStatus(state);
  updateInventory(state);
  updateCombat(state);
  updateShop(state);
}

async function startGame() {
  const playerName =
    document.getElementById("nameInput").value || "이름 없는 자";

  const playerJob =
    document.getElementById("jobInput").value || "모험가";

  const response = await fetch("/start", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      sessionId: getSessionId(),
      playerName,
      playerJob
    })
  });

  const data = await response.json();

  document.getElementById("startScreen").style.display = "none";
  document.getElementById("gameScreen").style.display = "block";

  updateAll(data.state);

  sendChoice("게임 시작");
}

async function sendChoice(choiceText) {
  const input = document.getElementById("choiceInput");
  const story = document.getElementById("story");
  const turnBox = document.getElementById("turn");
  const diceBox = document.getElementById("dice");
  const choiceButtons = document.getElementById("choiceButtons");

  const choice = choiceText || input.value || "주변을 살핀다";

  story.textContent = "진행 중...";

  const response = await fetch("/next", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      sessionId: getSessionId(),
      choice
    })
  });

  const data = await response.json();

  story.textContent = data.text;
  turnBox.textContent = "턴: " + data.turn;
  diceBox.textContent = "주사위: " + data.dice;

  updateAll(data.state);

  choiceButtons.innerHTML = "";

  const state = data.state;
  const isShopOpen = state && state.shop && state.shop.active;

  if (state && !isShopOpen && !state.ended) {
    data.choices.forEach((choice) => {
      const button = document.createElement("button");
      button.textContent = choice;
      button.onclick = () => sendChoice(choice);
      choiceButtons.appendChild(button);
    });
  }

  input.value = "";
}

async function resetGame() {
  await fetch("/reset", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      sessionId: getSessionId()
    })
  });

  location.reload();
}

function newPlayerSession() {
  localStorage.removeItem("trpgSessionId");
  location.reload();
}