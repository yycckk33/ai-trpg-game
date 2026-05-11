let sessionId = localStorage.getItem("trpgSessionId");

if (!sessionId) {
  sessionId = crypto.randomUUID();
  localStorage.setItem("trpgSessionId", sessionId);
}
function getStoryLogKey() {
  return `trpgStoryLog:${sessionId}`;
}

function loadStoryLog() {
  try {
    return JSON.parse(localStorage.getItem(getStoryLogKey()) || "[]");
  } catch {
    return [];
  }
}

function saveStoryLog(logs) {
  localStorage.setItem(getStoryLogKey(), JSON.stringify(logs.slice(-100)));
}

function addStoryLog(choice, data) {
  if (!data || !data.text) return;

  const logs = loadStoryLog();

  logs.push({
    turn: data.turn ?? "-",
    dice: data.dice ?? "-",
    choice: choice || "알 수 없는 행동",
    text: data.text,
    time: new Date().toLocaleString("ko-KR")
  });

  saveStoryLog(logs);
  renderStoryLog();
}

function renderStoryLog() {
  const logList = document.getElementById("logList");
  if (!logList) return;

  const logs = loadStoryLog();

  logList.innerHTML = "";

  if (logs.length === 0) {
    logList.textContent = "기록 없음";
    return;
  }

  [...logs].reverse().forEach((log) => {
    const entry = document.createElement("div");
    entry.className = "log-entry";

    const meta = document.createElement("div");
    meta.className = "log-meta";
    meta.textContent = `턴: ${log.turn} / 주사위: ${log.dice} / ${log.time}`;

    const choice = document.createElement("div");
    choice.className = "log-choice";
    choice.textContent = `행동: ${log.choice}`;

    const text = document.createElement("div");
    text.className = "log-text";
    text.textContent = log.text;

    entry.appendChild(meta);
    entry.appendChild(choice);
    entry.appendChild(text);

    logList.appendChild(entry);
  });
}

function toggleLog() {
  const logBox = document.getElementById("logBox");
  if (!logBox) return;

  if (logBox.style.display === "block") {
    logBox.style.display = "none";
  } else {
    logBox.style.display = "block";
    renderStoryLog();
  }
}

function clearStoryLog() {
  localStorage.removeItem(getStoryLogKey());
  renderStoryLog();
}

function createFreshSession() {
  sessionId = crypto.randomUUID();
  localStorage.setItem("trpgSessionId", sessionId);
  return sessionId;
}

function getInputValue(id, fallback) {
  const element = document.getElementById(id);

  if (!element) {
    return fallback;
  }

  const value = element.value.trim();
  return value || fallback;
}

function showError(error) {
  const startScreen = document.getElementById("startScreen");
  const gameScreen = document.getElementById("gameScreen");
  const story = document.getElementById("story");

  if (startScreen) {
    startScreen.style.display = "none";
  }

  if (gameScreen) {
    gameScreen.style.display = "block";
  }

  if (story) {
    story.textContent =
      "에러 발생:\n" +
      (error && error.message ? error.message : String(error)) +
      "\n\n서버가 꺼졌거나, 코드 오류가 있거나, 응답이 늦어지는 중일 수 있다.";
  }

  console.error(error);
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

  if (!info || !buttons) return;

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
    (state.shop && state.shop.active) ||
    (state.inn && state.inn.active)
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

  if (!combatBox || !combatInfo) return;

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

  if (!shopBox || !shopInfo || !shopButtons) return;

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

  if (!choiceButtons) return;

  choiceButtons.innerHTML = "";

  if (!choices || choices.length === 0) return;

  if (state && state.shop && state.shop.active) return;
  if (state && state.ended) return;

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

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${url} 응답이 JSON 형식이 아니다.\n\n${text}`);
  }

  if (!response.ok) {
    throw new Error(data.text || data.message || `${url} 요청 실패`);
  }

  return data;
}

async function startGame() {
  try {
    createFreshSession();
    clearStoryLog();

    const playerName = getInputValue("nameInput", "이름 없는 자");
    const playerJob = getInputValue("jobInput", "모험가");

    const worldSetting = getInputValue(
      "worldInput",
      "이곳은 흔히 아는 몬스터가 나타나는 판타지 RPG의 세계이며, 당신은 중대한 목표를 가지고 있습니다."
    );

    const playerPersonality = getInputValue(
      "personalityInput",
      "특별히 정해지지 않은 성격"
    );

    const playerGoal = getInputValue(
      "goalInput",
      "아직 정하지 못한 중대한 목표"
    );

    const startButton = document.querySelector("#startScreen button");
    if (startButton) {
      startButton.disabled = true;
      startButton.textContent = "시작 중...";
    }

    const data = await postJson("/start", {
      sessionId,
      playerName,
      playerJob,
      worldSetting,
      playerPersonality,
      playerGoal
    });

    document.getElementById("startScreen").style.display = "none";
    document.getElementById("gameScreen").style.display = "block";

    updateAll({
      ...data,
      choices: []
    });

    await sendChoice("게임 시작");
  } catch (error) {
    showError(error);
  }
}

async function sendChoice(choiceText) {
  try {
    const input = document.getElementById("choiceInput");
    const story = document.getElementById("story");
    const turnBox = document.getElementById("turn");
    const diceBox = document.getElementById("dice");

    const choice =
      choiceText ||
      (input && input.value ? input.value.trim() : "") ||
      "주변을 살핀다";

    if (story) {
      story.textContent = "진행 중...";
    }

    const data = await postJson("/next", {
      sessionId,
      choice
    });

    if (story) {
      story.textContent = data.text || "응답 없음";
    }

    if (turnBox) {
      turnBox.textContent = "턴: " + (data.turn ?? 1);
    }

    if (diceBox) {
      diceBox.textContent = "주사위: " + (data.dice ?? "-");
    }

    updateAll(data);
addStoryLog(choice, data);

if (input) {
  input.value = "";
}
  } catch (error) {
    showError(error);
  }
}

async function resetGame() {
  try {
    createFreshSession();

    await postJson("/reset", {
      sessionId
    });

    location.reload();
  } catch (error) {
    showError(error);
  }
}

function newPlayerSession() {
  createFreshSession();
  location.reload();
}