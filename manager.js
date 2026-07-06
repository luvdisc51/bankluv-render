const STORAGE_KEY = "bankluv.state.v1";
const MANAGER_SESSION_KEY = "bankluv.manager.unlocked";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

const els = {
  statAccounts: document.querySelector("#statAccounts"),
  statCards: document.querySelector("#statCards"),
  statTransactions: document.querySelector("#statTransactions"),
  managerLoginPanel: document.querySelector("#managerLoginPanel"),
  managerLoginForm: document.querySelector("#managerLoginForm"),
  managerLoginMessage: document.querySelector("#managerLoginMessage"),
  managerApp: document.querySelector("#managerApp"),
  lockManager: document.querySelector("#lockManager"),
  resetDemo: document.querySelector("#resetDemo"),
  accountForm: document.querySelector("#accountForm"),
  cardForm: document.querySelector("#cardForm"),
  giftCardForm: document.querySelector("#giftCardForm"),
  giftCardMessage: document.querySelector("#giftCardMessage"),
  passwordForm: document.querySelector("#passwordForm"),
  passwordMessage: document.querySelector("#passwordMessage"),
  cardAccountSelect: document.querySelector("#cardAccountSelect"),
  cardType: document.querySelector("#cardType"),
  pinInput: document.querySelector("#pinInput"),
  creditLimitLabel: document.querySelector("#creditLimitLabel"),
  managerAccounts: document.querySelector("#managerAccounts"),
  billList: document.querySelector("#billList"),
  payAllBills: document.querySelector("#payAllBills"),
  subscriptionForm: document.querySelector("#subscriptionForm"),
  subscriptionCardSelect: document.querySelector("#subscriptionCardSelect"),
  subscriptionList: document.querySelector("#subscriptionList"),
};

let state = defaultState();
let managerUnlocked = sessionStorage.getItem(MANAGER_SESSION_KEY) === "true";
let expandedCardHistoryId = null;

function makeId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function defaultState() {
  const accountId = makeId("acct");
  const creditId = makeId("card");
  const debitId = makeId("card");
  return normalizeState({
    activeCustomerId: null,
    settings: { managerPassword: "manager", checkoutPassword: "checkout" },
    cart: [
      { id: makeId("item"), name: "Latte", price: 5.25 },
      { id: makeId("item"), name: "Blueberry muffin", price: 4.75 },
    ],
    accounts: [
      {
        id: accountId,
        ownerName: "Maya Chen",
        username: "maya",
        password: "bankluv",
        balance: 820.5,
        createdAt: new Date().toISOString(),
      },
    ],
    cards: [
      {
        id: debitId,
        accountId,
        type: "debit",
        number: "4111000011112222",
        pin: "1234",
        creditLimit: 0,
        balance: 0,
        active: true,
        createdAt: new Date().toISOString(),
      },
      {
        id: creditId,
        accountId,
        type: "credit",
        number: "5555000099998888",
        pin: "",
        creditLimit: 1500,
        balance: 132.4,
        active: true,
        createdAt: new Date().toISOString(),
      },
    ],
    transactions: [
      {
        id: makeId("txn"),
        createdAt: new Date().toISOString(),
        merchant: "BankLuv Companion",
        items: [{ name: "Desk lamp", price: 46.8 }],
        total: 46.8,
        method: "credit",
        cardId: creditId,
        accountId,
        status: "approved",
      },
    ],
    bills: [],
  });
}

function normalizeState(nextState) {
  const normalized = {
    activeCustomerId: null,
    cart: [],
    accounts: [],
    cards: [],
    transactions: [],
    bills: [],
    subscriptions: [],
    ...nextState,
    settings: {
      managerPassword: "manager",
      checkoutPassword: "checkout",
      ...(nextState?.settings || {}),
    },
  };
  normalized.accounts.forEach((account, index) => {
    if (typeof account.active !== "boolean") account.active = true;
    if (!Number.isFinite(Number(account.order))) account.order = index;
  });
  const cardCounts = new Map();
  normalized.cards.forEach((card, index) => {
    const key = card.accountId || "_none";
    const nextOrder = cardCounts.get(key) ?? 0;
    if (typeof card.active !== "boolean") card.active = true;
    if (!Number.isFinite(Number(card.order))) card.order = nextOrder;
    cardCounts.set(key, nextOrder + 1);
    if (!card.createdAt) card.createdAt = new Date(Date.now() + index).toISOString();
  });
  normalized.accounts
    .filter((account) => account.active !== false)
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
    .forEach((account, index) => {
      account.order = index;
    });
  const activeAccountIds = new Set(normalized.accounts.filter((account) => account.active !== false).map((account) => account.id));
  activeAccountIds.forEach((accountId) => {
    normalized.cards
      .filter((card) => card.accountId === accountId && card.active)
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
      .forEach((card, index) => {
        card.order = index;
      });
  });
  return normalized;
}

async function postJson(url, body = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "BankLuv request failed.");
  return payload;
}

function cleanNumber(value) {
  return String(value || "").replace(/\D/g, "");
}

function formatCardNumber(number) {
  return cleanNumber(number).replace(/(\d{4})(?=\d)/g, "$1 ");
}

function money(value) {
  return usd.format(Number(value || 0));
}

function parseMoney(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

async function loadState() {
  if (location.protocol !== "file:") {
    try {
      const response = await fetch("/api/state");
      if (response.ok) return normalizeState(await response.json());
    } catch {}
  }
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? normalizeState(JSON.parse(saved)) : defaultState();
  } catch {
    return defaultState();
  }
}

function saveState() {
  state = normalizeState(state);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (location.protocol !== "file:") {
    fetch("/api/state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    }).catch(() => {});
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function findAccount(id) {
  return state.accounts.find((account) => account.id === id && account.active !== false);
}

function findCard(id) {
  return state.cards.find((card) => card.id === id);
}

function activeAccounts() {
  return state.accounts.filter((account) => account.active !== false);
}

function sortedAccounts() {
  return activeAccounts().sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
}

function sortedCardsForAccount(accountId) {
  return state.cards
    .filter((card) => card.accountId === accountId && card.active)
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
}

function moveAccount(accountId, direction) {
  const accounts = sortedAccounts();
  const index = accounts.findIndex((account) => account.id === accountId);
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= accounts.length) return false;
  const [movedAccount] = accounts.splice(index, 1);
  accounts.splice(targetIndex, 0, movedAccount);
  accounts.forEach((account, accountIndex) => {
    account.order = accountIndex;
  });
  return true;
}

function moveCard(cardId, direction) {
  const card = findCard(cardId);
  if (!card) return false;
  const cards = sortedCardsForAccount(card.accountId);
  const index = cards.findIndex((entry) => entry.id === cardId);
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= cards.length) return false;
  const [movedCard] = cards.splice(index, 1);
  cards.splice(targetIndex, 0, movedCard);
  cards.forEach((entry, cardIndex) => {
    entry.order = cardIndex;
  });
  return true;
}

function makeCardNumber(type) {
  const prefix = type === "credit" ? "5555" : "4111";
  const used = new Set(state.cards.map((card) => card.number));
  let number = "";
  do {
    number = prefix + Array.from({ length: 12 }, () => Math.floor(Math.random() * 10)).join("");
  } while (used.has(number));
  return number;
}

function parseGiftCardName(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(.*?)(\d+)\s*$/);
  if (!match) return null;
  return {
    prefix: match[1],
    startNumber: Number(match[2]),
  };
}

function usernameFromName(name) {
  const base =
    String(name || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "gift-card";
  const used = new Set(state.accounts.map((account) => String(account.username || "").toLowerCase()));
  let username = base;
  let suffix = 2;
  while (used.has(username)) {
    username = `${base}-${suffix}`;
    suffix += 1;
  }
  return username;
}

function cardHistoryEntries(card) {
  const account = findAccount(card.accountId);
  const entries = [];

  state.transactions.forEach((txn) => {
    if (txn.method === "bankmo" && txn.accountId === card.accountId) {
      entries.push({
        createdAt: txn.createdAt,
        type: txn.status === "received" ? "Bankmo received" : "Bankmo sent",
        title: txn.items?.map((item) => item.name).join(", ") || txn.merchant || "Bankmo",
        detail: `Account: ${account?.ownerName || "Unknown"}`,
        amount: txn.status === "sent" ? -Number(txn.total || 0) : Number(txn.total || 0),
      });
      return;
    }

    const split = txn.paymentSplits?.find((entry) => entry.cardId === card.id);
    const chargedThisCard = split ? Number(split.amount || 0) : txn.cardId === card.id ? Number(txn.total || 0) : null;
    if (chargedThisCard === null) return;

    entries.push({
      createdAt: txn.createdAt,
      type: "Payment charge",
      title: txn.merchant || "Payment",
      detail: txn.items?.map((item) => `${item.name} ${money(item.finalPrice ?? item.price)}`).join(" - ") || "No items",
      amount: -chargedThisCard,
    });
  });

  return entries.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function renderCardHistory(card) {
  const entries = cardHistoryEntries(card);
  if (!entries.length) return `<div class="empty card-history">No Bankmo or payment charges for this card yet.</div>`;
  return `
    <div class="card-history">
      ${entries
        .map(
          (entry) => `
            <div class="history-row">
              <div>
                <div class="record-title">${escapeHtml(entry.type)} - ${escapeHtml(entry.title)}</div>
                <div class="record-meta">${new Date(entry.createdAt).toLocaleString()} - ${escapeHtml(entry.detail)}</div>
              </div>
              <strong>${entry.amount < 0 ? "-" : ""}${money(Math.abs(entry.amount))}</strong>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function render() {
  renderLockState();
  renderStats();
  if (managerUnlocked) {
    renderManager();
  }
}

function persistAndRender() {
  saveState();
  render();
}

function renderLockState() {
  els.managerLoginPanel.classList.toggle("hidden", managerUnlocked);
  els.managerApp.classList.toggle("hidden", !managerUnlocked);
  els.lockManager.classList.toggle("hidden", !managerUnlocked);
  els.resetDemo.classList.toggle("hidden", !managerUnlocked);
}

function renderStats() {
  const activeAccountIds = new Set(activeAccounts().map((account) => account.id));
  els.statAccounts.textContent = activeAccountIds.size;
  els.statCards.textContent = state.cards.filter((card) => card.active && activeAccountIds.has(card.accountId)).length;
  els.statTransactions.textContent = state.transactions.length;
}

function renderManager() {
  const accounts = sortedAccounts();
  els.passwordForm.managerPassword.value = state.settings.managerPassword;
  els.passwordForm.checkoutPassword.value = state.settings.checkoutPassword;
  els.cardAccountSelect.innerHTML = accounts
    .map((account) => `<option value="${account.id}">${escapeHtml(account.ownerName)} - ${money(account.balance)}</option>`)
    .join("");

  if (!accounts.length) {
    els.cardAccountSelect.innerHTML = `<option value="">Create an account first</option>`;
  }

  els.managerAccounts.innerHTML = accounts.length
    ? accounts.map(renderManagerAccount).join("")
    : `<div class="empty">No accounts yet. Create the first fake USD account.</div>`;

  const activeAccountIds = new Set(accounts.map((account) => account.id));
  const creditCards = state.cards.filter((card) => card.type === "credit" && card.active && activeAccountIds.has(card.accountId));
  els.subscriptionCardSelect.innerHTML = creditCards.length
    ? creditCards
        .map((card) => {
          const account = findAccount(card.accountId);
          return `<option value="${card.id}">${escapeHtml(account?.ownerName || "Unknown")} - ${formatCardNumber(card.number)}</option>`;
        })
        .join("")
    : `<option value="">Create an active credit card first</option>`;

  els.billList.innerHTML = creditCards.length
    ? creditCards.map(renderBillCard).join("")
    : `<div class="empty">No active credit cards to bill.</div>`;

  renderSubscriptions();
}

function renderManagerAccount(account) {
  const cards = sortedCardsForAccount(account.id);
  const cardsHtml = cards.length
    ? cards
        .map((card) => {
          const balanceLine =
            card.type === "credit" ? `Outstanding ${money(card.balance)} of ${money(card.creditLimit)}` : "Draws from account balance";
          const noteLine = card.note ? `<div class="card-note-readout">Note: ${escapeHtml(card.note)}</div>` : "";
          const isHistoryOpen = expandedCardHistoryId === card.id;
          return `
            <div class="record">
              <div class="record-top">
                <div>
                  <span class="badge ${card.type === "credit" ? "credit" : ""}">${card.type}</span>
                  <div class="record-title">${formatCardNumber(card.number)}</div>
                  <div class="record-meta">${balanceLine}${card.type === "debit" ? ` - PIN ${escapeHtml(card.pin)}` : ""}</div>
                  ${noteLine}
                </div>
                <div class="order-actions">
                  <button class="small-button" data-action="move-card-up" data-id="${card.id}" type="button">Up</button>
                  <button class="small-button" data-action="move-card-down" data-id="${card.id}" type="button">Down</button>
                  <button class="small-button" data-action="card-history" data-id="${card.id}" type="button">${isHistoryOpen ? "Hide History" : "Check History"}</button>
                  <button class="danger-button" data-action="delete-card" data-id="${card.id}" type="button">Delete Card</button>
                </div>
              </div>
              ${isHistoryOpen ? renderCardHistory(card) : ""}
            </div>
          `;
        })
        .join("")
    : `<div class="empty">No active cards for this account.</div>`;

  return `
    <article class="record">
      <div class="record-top">
        <div>
          <div class="record-title">${escapeHtml(account.ownerName)}</div>
          <div class="record-meta">Login: ${escapeHtml(account.username)} / ${escapeHtml(account.password)}</div>
        </div>
        <div class="account-heading-actions">
          <strong>${money(account.balance)}</strong>
          <div class="order-actions">
            <button class="small-button" data-action="move-account-up" data-id="${account.id}" type="button">Up</button>
            <button class="small-button" data-action="move-account-down" data-id="${account.id}" type="button">Down</button>
          </div>
        </div>
      </div>
      <div class="record-actions">
        <label class="inline-money-control">
          Deposit amount
          <input data-deposit-amount="${account.id}" type="number" min="0.01" step="0.01" value="100.00" />
        </label>
        <button class="small-button" data-action="deposit" data-id="${account.id}" type="button">Deposit</button>
        <button class="danger-button" data-action="delete-account" data-id="${account.id}" type="button">Delete Account</button>
      </div>
      <div class="cards-inside">${cardsHtml}</div>
    </article>
  `;
}

function renderSubscriptions() {
  const activeSubscriptions = state.subscriptions.filter((subscription) => subscription.active);
  els.subscriptionList.innerHTML = activeSubscriptions.length
    ? activeSubscriptions
        .map((subscription) => {
          const card = findCard(subscription.cardId);
          const account = card ? findAccount(card.accountId) : null;
          return `
            <article class="record">
              <div class="record-top">
                <div>
                  <div class="record-title">${escapeHtml(subscription.name)}</div>
                  <div class="record-meta">${money(subscription.amount)} charged to ${escapeHtml(account?.ownerName || "Unknown")} ${card ? `- ${formatCardNumber(card.number)}` : ""}</div>
                  <div class="record-meta">Last charged: ${subscription.lastChargedAt ? new Date(subscription.lastChargedAt).toLocaleString() : "Never"}</div>
                </div>
                <button class="danger-button" data-action="delete-subscription" data-id="${subscription.id}" type="button">Delete</button>
              </div>
            </article>
          `;
        })
        .join("")
    : `<div class="empty">No subscriptions yet.</div>`;
}

function renderBillCard(card) {
  const account = findAccount(card.accountId);
  const openBills = state.bills.filter((bill) => bill.cardId === card.id && bill.status === "open");
  const billRows = openBills.length
    ? openBills
        .map(
          (bill) => `
          <div class="money-row">
            <span>${money(bill.amount)} bill</span>
            <button class="small-button" data-action="pay-bill" data-id="${bill.id}" type="button">Pay from Account</button>
          </div>
        `,
        )
        .join("")
    : `<div class="record-meta">No open bills.</div>`;

  return `
    <article class="record">
      <div class="record-top">
        <div>
          <div class="record-title">${escapeHtml(account?.ownerName || "Unknown account")}</div>
          <div class="record-meta">${formatCardNumber(card.number)}</div>
        </div>
        <span class="badge credit">Credit</span>
      </div>
      <div class="money-row"><span>Outstanding</span><strong>${money(card.balance)}</strong></div>
      <div class="record-actions">
        <button class="primary-button" data-action="generate-bill" data-id="${card.id}" type="button">Generate Bill</button>
      </div>
      <div class="cards-inside">${billRows}</div>
    </article>
  `;
}

els.managerLoginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const password = new FormData(formElement).get("password");
  if (password !== state.settings.managerPassword) {
    els.managerLoginMessage.textContent = "Manager password did not match.";
    els.managerLoginMessage.className = "status-message error";
    return;
  }
  managerUnlocked = true;
  sessionStorage.setItem(MANAGER_SESSION_KEY, "true");
  formElement.reset();
  els.managerLoginMessage.textContent = "";
  render();
});

els.lockManager.addEventListener("click", () => {
  managerUnlocked = false;
  sessionStorage.removeItem(MANAGER_SESSION_KEY);
  render();
});

els.resetDemo.addEventListener("click", () => {
  state = defaultState();
  persistAndRender();
});

els.cardType.addEventListener("change", () => {
  const isCredit = els.cardType.value === "credit";
  els.creditLimitLabel.classList.toggle("hidden", !isCredit);
  els.pinInput.required = !isCredit;
});

els.passwordForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const managerPassword = String(form.get("managerPassword")).trim();
  const checkoutPassword = String(form.get("checkoutPassword")).trim();
  if (!managerPassword || !checkoutPassword) {
    els.passwordMessage.textContent = "Both passwords are required.";
    els.passwordMessage.className = "status-message error";
    return;
  }
  state.settings.managerPassword = managerPassword;
  state.settings.checkoutPassword = checkoutPassword;
  els.passwordMessage.textContent = "Passwords saved.";
  els.passwordMessage.className = "status-message success";
  persistAndRender();
});

els.accountForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const username = String(form.get("username")).trim();
  if (activeAccounts().some((account) => account.username.toLowerCase() === username.toLowerCase())) {
    alert("That username already exists.");
    return;
  }
  state.accounts.push({
    id: makeId("acct"),
    ownerName: String(form.get("ownerName")).trim(),
    username,
    password: String(form.get("password")).trim(),
    balance: parseMoney(form.get("balance")),
    active: true,
    order: activeAccounts().length,
    createdAt: new Date().toISOString(),
  });
  formElement.reset();
  formElement.balance.value = "250.00";
  persistAndRender();
});

els.cardForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const accountId = String(form.get("accountId"));
  const type = String(form.get("type"));
  const pin = cleanNumber(form.get("pin"));
  if (!findAccount(accountId)) {
    alert("Create an account before creating a card.");
    return;
  }
  if (type === "debit" && pin.length < 4) {
    alert("Debit cards need a PIN with at least 4 digits.");
    return;
  }
  state.cards.push({
    id: makeId("card"),
    accountId,
    type,
    number: makeCardNumber(type),
    pin: type === "debit" ? pin : "",
    creditLimit: type === "credit" ? parseMoney(form.get("creditLimit")) : 0,
    balance: 0,
    active: true,
    order: state.cards.filter((card) => card.accountId === accountId).length,
    createdAt: new Date().toISOString(),
  });
  formElement.reset();
  els.creditLimitLabel.classList.add("hidden");
  persistAndRender();
});

els.giftCardForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const parsedName = parseGiftCardName(form.get("giftCardName"));
  const count = Math.floor(Number(form.get("giftCardCount")));
  const balance = parseMoney(form.get("giftCardBalance"));

  if (!parsedName || !Number.isFinite(parsedName.startNumber)) {
    els.giftCardMessage.textContent = "Use a name that ends with a number, like Gift Card #8.";
    els.giftCardMessage.className = "status-message error";
    return;
  }
  if (!Number.isFinite(count) || count < 1) {
    els.giftCardMessage.textContent = "Enter at least 1 gift card.";
    els.giftCardMessage.className = "status-message error";
    return;
  }

  const startingAccountOrder = activeAccounts().length;
  for (let index = 0; index < count; index += 1) {
    const ownerName = `${parsedName.prefix}${parsedName.startNumber + index}`;
    const accountId = makeId("acct");
    state.accounts.push({
      id: accountId,
      ownerName,
      username: usernameFromName(ownerName),
      password: "0303",
      balance,
      active: true,
      order: startingAccountOrder + index,
      createdAt: new Date().toISOString(),
    });
    state.cards.push({
      id: makeId("card"),
      accountId,
      type: "debit",
      number: makeCardNumber("debit"),
      pin: "0303",
      creditLimit: 0,
      balance: 0,
      active: true,
      order: 0,
      createdAt: new Date().toISOString(),
    });
  }

  els.giftCardMessage.textContent = `Created ${count} gift card${count === 1 ? "" : "s"} with PIN 0303.`;
  els.giftCardMessage.className = "status-message success";
  formElement.giftCardName.value = `${parsedName.prefix}${parsedName.startNumber + count}`;
  persistAndRender();
});

els.managerAccounts.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const { action, id } = button.dataset;
  if (action === "move-account-up" || action === "move-account-down") {
    const direction = action === "move-account-up" ? -1 : 1;
    if (location.protocol !== "file:") {
      postJson("/api/reorder-account", { accountId: id, direction })
        .then((nextState) => {
          state = normalizeState(nextState);
          render();
        })
        .catch((error) => alert(error.message));
      return;
    }
    if (moveAccount(id, direction)) persistAndRender();
    return;
  }
  if (action === "move-card-up" || action === "move-card-down") {
    const direction = action === "move-card-up" ? -1 : 1;
    if (location.protocol !== "file:") {
      postJson("/api/reorder-card", { cardId: id, direction })
        .then((nextState) => {
          state = normalizeState(nextState);
          render();
        })
        .catch((error) => alert(error.message));
      return;
    }
    if (moveCard(id, direction)) persistAndRender();
    return;
  }
  if (action === "card-history") {
    expandedCardHistoryId = expandedCardHistoryId === id ? null : id;
    render();
    return;
  }
  if (action === "deposit") {
    const amountInput = els.managerAccounts.querySelector(`[data-deposit-amount="${id}"]`);
    const amount = parseMoney(amountInput?.value);
    if (amount <= 0) {
      alert("Enter a deposit amount greater than $0.");
      return;
    }
    if (location.protocol !== "file:") {
      postJson("/api/deposit", { accountId: id, amount })
        .then((nextState) => {
          state = normalizeState(nextState);
          render();
        })
        .catch((error) => alert(error.message));
      return;
    }
    const account = findAccount(id);
    if (account) account.balance = parseMoney(account.balance + amount);
  }
  if (action === "delete-card") {
    const card = findCard(id);
    if (card) card.active = false;
  }
  if (action === "delete-account") {
    const account = state.accounts.find((entry) => entry.id === id);
    if (account) account.active = false;
    state.cards = state.cards.map((card) => (card.accountId === id ? { ...card, active: false } : card));
  }
  persistAndRender();
});

els.billList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const { action, id } = button.dataset;
  if (action === "generate-bill") {
    const card = findCard(id);
    if (!card || card.balance <= 0) {
      alert("This credit card has no outstanding balance to bill.");
      return;
    }
    state.bills.push({
      id: makeId("bill"),
      cardId: card.id,
      accountId: card.accountId,
      amount: parseMoney(card.balance),
      status: "open",
      createdAt: new Date().toISOString(),
      paidAt: null,
    });
  }
  if (action === "pay-bill") {
    if (location.protocol !== "file:") {
      postJson("/api/bills/pay", { id })
        .then((nextState) => {
          state = normalizeState(nextState);
          render();
        })
        .catch((error) => alert(error.message));
      return;
    }
    const bill = state.bills.find((entry) => entry.id === id);
    const card = bill ? findCard(bill.cardId) : null;
    const account = bill ? findAccount(bill.accountId) : null;
    if (!bill || !card || !account) return;
    if (account.balance < bill.amount) {
      alert("The linked account does not have enough USD to pay that bill.");
      return;
    }
    account.balance = parseMoney(account.balance - bill.amount);
    card.balance = parseMoney(Math.max(card.balance - bill.amount, 0));
    bill.status = "paid";
    bill.paidAt = new Date().toISOString();
  }
  persistAndRender();
});

els.payAllBills.addEventListener("click", () => {
  if (location.protocol !== "file:") {
    postJson("/api/bills/pay-all")
      .then((result) => {
        state = normalizeState(result.state);
        const skipped = result.skipped?.length ? ` ${result.skipped.length} item(s) could not be paid or charged.` : "";
        alert(`Charged ${result.charged.length} subscription(s), paid ${result.paid.length} bill(s).${skipped}`);
        render();
      })
      .catch((error) => alert(error.message));
    return;
  }
  state.subscriptions.filter((subscription) => subscription.active).forEach((subscription) => {
    const card = findCard(subscription.cardId);
    if (card && card.type === "credit" && card.active) {
      card.balance = parseMoney(card.balance + subscription.amount);
      subscription.lastChargedAt = new Date().toISOString();
    }
  });
  state.bills = state.bills.filter((bill) => bill.status !== "open");
  state.cards
    .filter((card) => card.active && card.type === "credit" && card.balance > 0 && findAccount(card.accountId))
    .forEach((card) => {
      state.bills.push({
        id: makeId("bill"),
        cardId: card.id,
        accountId: card.accountId,
        amount: parseMoney(card.balance),
        status: "open",
        createdAt: new Date().toISOString(),
        paidAt: null,
      });
    });
  state.bills.forEach((bill) => {
    const card = findCard(bill.cardId);
    const account = findAccount(bill.accountId);
    if (card && account && account.balance >= bill.amount) {
      account.balance = parseMoney(account.balance - bill.amount);
      card.balance = parseMoney(Math.max(card.balance - bill.amount, 0));
      bill.status = "paid";
    }
  });
  state.bills = state.bills.filter((bill) => bill.status !== "paid");
  persistAndRender();
});

els.subscriptionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const payload = {
    name: String(form.get("name")).trim(),
    amount: parseMoney(form.get("amount")),
    cardId: String(form.get("cardId")),
  };
  if (!payload.name || payload.amount <= 0 || !payload.cardId) {
    alert("Subscription needs a name, amount, and credit card.");
    return;
  }
  if (location.protocol !== "file:") {
    postJson("/api/subscriptions", payload)
      .then((nextState) => {
        state = normalizeState(nextState);
        formElement.reset();
        render();
      })
      .catch((error) => alert(error.message));
    return;
  }
  const card = findCard(payload.cardId);
  state.subscriptions.push({
    id: makeId("sub"),
    ...payload,
    accountId: card?.accountId,
    active: true,
    createdAt: new Date().toISOString(),
    lastChargedAt: null,
  });
  formElement.reset();
  persistAndRender();
});

els.subscriptionList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action='delete-subscription']");
  if (!button) return;
  if (location.protocol !== "file:") {
    postJson("/api/subscriptions/delete", { id: button.dataset.id })
      .then((nextState) => {
        state = normalizeState(nextState);
        render();
      })
      .catch((error) => alert(error.message));
    return;
  }
  state.subscriptions = state.subscriptions.map((subscription) =>
    subscription.id === button.dataset.id ? { ...subscription, active: false } : subscription,
  );
  persistAndRender();
});

async function init() {
  state = await loadState();
  render();
}

init();
