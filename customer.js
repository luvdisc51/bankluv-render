const STORAGE_KEY = "bankluv.state.v1";
const SESSION_KEY = "bankluv.customer.id";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const els = {
  loginPanel: document.querySelector("#loginPanel"),
  customerPanel: document.querySelector("#customerPanel"),
  loginForm: document.querySelector("#loginForm"),
  loginMessage: document.querySelector("#loginMessage"),
  logoutButton: document.querySelector("#logoutButton"),
  refreshButton: document.querySelector("#refreshButton"),
  customerName: document.querySelector("#customerName"),
  customerSummary: document.querySelector("#customerSummary"),
  customerCards: document.querySelector("#customerCards"),
  cardNoteMessage: document.querySelector("#cardNoteMessage"),
  bankmoForm: document.querySelector("#bankmoForm"),
  bankmoMessage: document.querySelector("#bankmoMessage"),
  customerTransactions: document.querySelector("#customerTransactions"),
};

let portal = null;
let activeCustomerId = sessionStorage.getItem(SESSION_KEY);

function money(value) {
  return usd.format(Number(value || 0));
}

function cleanNumber(value) {
  return String(value || "").replace(/\D/g, "");
}

function formatCardNumber(number) {
  return cleanNumber(number).replace(/(\d{4})(?=\d)/g, "$1 ");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeCredential(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim()
    .toLowerCase();
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function parseMoney(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function makeId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

async function customerLogin(username, password) {
  if (location.protocol !== "file:") {
    const response = await fetch("/api/customer-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || "Login did not match a BankLuv account.");
    }

    return response.json();
  }

  const saved = localStorage.getItem(STORAGE_KEY);
  const state = saved ? JSON.parse(saved) : { accounts: [], cards: [], transactions: [], bills: [] };
  const normalizedUsername = normalizeCredential(username);
  const normalizedPassword = normalizeCredential(password);
  const account = state.accounts.find(
    (entry) =>
      entry.active !== false &&
      normalizeCredential(entry.username) === normalizedUsername &&
      normalizeCredential(entry.password) === normalizedPassword,
  );

  if (!account) throw new Error("Login did not match a BankLuv account.");
  return buildPortalFromState(state, account);
}

async function loadPortal(accountId) {
  if (!accountId) return null;

  if (location.protocol !== "file:") {
    const response = await fetch(`/api/customer?id=${encodeURIComponent(accountId)}`);
    if (!response.ok) {
      sessionStorage.removeItem(SESSION_KEY);
      activeCustomerId = null;
      return null;
    }
    return response.json();
  }

  const saved = localStorage.getItem(STORAGE_KEY);
  const state = saved ? JSON.parse(saved) : { accounts: [], cards: [], transactions: [], bills: [] };
  const account = state.accounts.find((entry) => entry.id === accountId && entry.active !== false);
  return account ? buildPortalFromState(state, account) : null;
}

function buildPortalFromState(state, account) {
  return {
    account: {
      id: account.id,
      ownerName: account.ownerName,
      username: account.username,
      balance: account.balance,
    },
    cards: state.cards
      .filter((card) => card.accountId === account.id && card.active)
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0)),
    transactions: state.transactions.filter((txn) => txn.accountId === account.id),
    bills: state.bills.filter((bill) => bill.accountId === account.id),
  };
}

async function saveCardNote(cardId, note) {
  if (!portal?.account?.id) throw new Error("Login again before saving a card note.");

  if (location.protocol !== "file:") {
    const response = await fetch("/api/customer-card-note", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: portal.account.id,
        cardId,
        note,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Card note could not be saved.");
    return body;
  }

  const saved = localStorage.getItem(STORAGE_KEY);
  const state = saved ? JSON.parse(saved) : { accounts: [], cards: [], transactions: [], bills: [] };
  const card = state.cards.find((entry) => entry.id === cardId && entry.accountId === portal.account.id && entry.active);
  if (!card) throw new Error("Card was not found for this customer.");
  card.note = note;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  return buildPortalFromState(state, state.accounts.find((entry) => entry.id === portal.account.id && entry.active !== false));
}

async function sendBankmo(recipientName, amount) {
  if (!portal?.account?.id) throw new Error("Login again before sending Bankmo money.");

  if (location.protocol !== "file:") {
    const response = await fetch("/api/bankmo-transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: portal.account.id,
        recipientName,
        amount,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Bankmo transfer could not be sent.");
    return body;
  }

  const saved = localStorage.getItem(STORAGE_KEY);
  const state = saved ? JSON.parse(saved) : { accounts: [], cards: [], transactions: [], bills: [] };
  const sender = state.accounts.find((entry) => entry.id === portal.account.id && entry.active !== false);
  const matches = state.accounts.filter(
    (entry) => entry.active !== false && entry.id !== portal.account.id && normalizeName(entry.ownerName) === normalizeName(recipientName),
  );
  const transferAmount = parseMoney(amount);
  if (!sender) throw new Error("Login again before sending Bankmo money.");
  if (!matches.length) throw new Error("That Bankmo recipient was not found.");
  if (matches.length > 1) throw new Error("More than one person has that name. Ask the manager to make the names more specific.");
  if (transferAmount <= 0) throw new Error("Bankmo amount must be greater than $0.");
  if (Number(sender.balance || 0) < transferAmount) throw new Error("You do not have enough cash balance for that Bankmo transfer.");

  const recipient = matches[0];
  sender.balance = parseMoney(Number(sender.balance || 0) - transferAmount);
  recipient.balance = parseMoney(Number(recipient.balance || 0) + transferAmount);
  const transferId = makeId("bankmo");
  const createdAt = new Date().toISOString();
  state.transactions.push({
    id: `${transferId}_out`,
    createdAt,
    merchant: "Bankmo",
    items: [{ name: `Sent to ${recipient.ownerName}`, price: transferAmount }],
    total: transferAmount,
    method: "bankmo",
    accountId: sender.id,
    relatedAccountId: recipient.id,
    status: "sent",
  });
  state.transactions.push({
    id: `${transferId}_in`,
    createdAt,
    merchant: "Bankmo",
    items: [{ name: `Received from ${sender.ownerName}`, price: transferAmount }],
    total: transferAmount,
    method: "bankmo",
    accountId: recipient.id,
    relatedAccountId: sender.id,
    status: "received",
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  return buildPortalFromState(state, sender);
}

function render() {
  const customer = portal?.account || null;
  els.loginPanel.classList.toggle("hidden", Boolean(customer));
  els.customerPanel.classList.toggle("hidden", !customer);
  els.logoutButton.classList.toggle("hidden", !customer);

  if (!customer) return;

  const cards = portal.cards || [];
  const creditOutstanding = cards
    .filter((card) => card.type === "credit")
    .reduce((sum, card) => sum + Number(card.balance || 0), 0);
  const openBills = (portal.bills || [])
    .filter((bill) => bill.status === "open")
    .reduce((sum, bill) => sum + Number(bill.amount || 0), 0);

  els.customerName.textContent = customer.ownerName;
  els.customerSummary.innerHTML = `
    <div class="balance-tile"><span>Cash balance</span><strong>${money(customer.balance)}</strong></div>
    <div class="balance-tile"><span>Credit used</span><strong>${money(creditOutstanding)}</strong></div>
    <div class="balance-tile"><span>Open bills</span><strong>${money(openBills)}</strong></div>
  `;

  els.customerCards.innerHTML = cards.length
    ? cards.map(renderCard).join("")
    : `<div class="empty">No active cards yet.</div>`;

  const txns = (portal.transactions || []).slice().reverse();
  els.customerTransactions.innerHTML = txns.length
    ? txns.map(renderTransaction).join("")
    : `<div class="empty">No card activity yet.</div>`;
}

function renderCard(card) {
  const title = card.type === "credit" ? "Credit Card" : "Debit Card";
  const detail =
    card.type === "credit"
      ? `Balance ${money(card.balance)} - Available ${money(Math.max(card.creditLimit - card.balance, 0))}`
      : "Spends directly from cash balance";

  return `
    <article class="bank-card ${card.type === "credit" ? "credit" : ""}">
      <span>${title}</span>
      <div class="card-number">${formatCardNumber(card.number)}</div>
      <div class="card-foot">
        <span>${detail}</span>
        <span>${card.type === "debit" ? `PIN ${escapeHtml(card.pin)}` : money(card.creditLimit)}</span>
      </div>
      <label class="card-note-control">
        Note
        <textarea data-card-note="${card.id}" maxlength="500" rows="3" placeholder="Add a note for this card">${escapeHtml(card.note || "")}</textarea>
      </label>
      <button class="small-button card-note-button" data-action="save-card-note" data-id="${card.id}" type="button">Save Note</button>
    </article>
  `;
}

function renderTransaction(txn) {
  const signedAmount = txn.method === "bankmo" && txn.status === "sent" ? `-${money(txn.total)}` : money(txn.total);
  return `
    <article class="record">
      <div class="record-top">
        <div>
          <div class="record-title">${escapeHtml(txn.merchant)}</div>
          <div class="record-meta">${new Date(txn.createdAt).toLocaleString()} - ${txn.items
            .map((item) => escapeHtml(item.name))
            .join(", ")}</div>
        </div>
        <strong>${signedAmount}</strong>
      </div>
    </article>
  `;
}

async function refresh() {
  try {
    portal = await loadPortal(activeCustomerId);
    render();
    els.loginMessage.textContent = "";
    els.loginMessage.className = "status-message";
  } catch {
    els.loginMessage.textContent = "Could not reach the BankLuv server.";
    els.loginMessage.className = "status-message error";
  }
}

els.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  els.loginMessage.textContent = "Checking login...";
  els.loginMessage.className = "status-message";

  const form = new FormData(formElement);
  const username = String(form.get("username")).trim();
  const password = String(form.get("password")).trim();

  try {
    portal = await customerLogin(username, password);
    activeCustomerId = portal.account.id;
    sessionStorage.setItem(SESSION_KEY, activeCustomerId);
    formElement.reset();
    els.loginMessage.textContent = "";
    render();
  } catch (error) {
    portal = null;
    els.loginMessage.textContent = error.message || "Login did not match a BankLuv account.";
    els.loginMessage.className = "status-message error";
    render();
  }
});

els.logoutButton.addEventListener("click", () => {
  portal = null;
  activeCustomerId = null;
  sessionStorage.removeItem(SESSION_KEY);
  render();
});

els.refreshButton.addEventListener("click", refresh);

els.bankmoForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const recipientName = String(form.get("recipientName")).trim();
  const amount = parseMoney(form.get("amount"));

  els.bankmoMessage.textContent = "Sending Bankmo...";
  els.bankmoMessage.className = "status-message";

  try {
    portal = await sendBankmo(recipientName, amount);
    formElement.reset();
    els.bankmoMessage.textContent = `Sent ${money(amount)} to ${recipientName}.`;
    els.bankmoMessage.className = "status-message success";
    render();
  } catch (error) {
    els.bankmoMessage.textContent = error.message || "Bankmo transfer could not be sent.";
    els.bankmoMessage.className = "status-message error";
  }
});

els.customerCards.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action='save-card-note']");
  if (!button) return;

  const textarea = els.customerCards.querySelector(`[data-card-note="${button.dataset.id}"]`);
  const note = textarea ? textarea.value : "";
  button.disabled = true;
  els.cardNoteMessage.textContent = "Saving note...";
  els.cardNoteMessage.className = "status-message";

  try {
    portal = await saveCardNote(button.dataset.id, note);
    els.cardNoteMessage.textContent = "Card note saved.";
    els.cardNoteMessage.className = "status-message success";
    render();
  } catch (error) {
    els.cardNoteMessage.textContent = error.message || "Card note could not be saved.";
    els.cardNoteMessage.className = "status-message error";
  } finally {
    button.disabled = false;
  }
});

refresh();
