const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3007);
const APP_MODE = process.env.APP_MODE || "full";
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const STATE_FILE = path.join(DATA_DIR, "bankluv-state.json");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function makeId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function defaultState() {
  const accountId = makeId("acct");
  const creditId = makeId("card");
  const debitId = makeId("card");

  return {
    activeCustomerId: null,
    settings: {
      managerPassword: "manager",
      checkoutPassword: "checkout",
    },
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
    subscriptions: [],
  };
}

function normalizeState(state) {
  const normalized = {
    activeCustomerId: null,
    cart: [],
    accounts: [],
    cards: [],
    transactions: [],
    bills: [],
    subscriptions: [],
    ...state,
    settings: {
      managerPassword: "manager",
      checkoutPassword: "checkout",
      ...(state && state.settings ? state.settings : {}),
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
  normalized.bills = normalized.bills.filter((bill) => bill.status !== "paid");
  return normalized;
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
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

function parsePercent(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(Math.max(parsed, 0), 100);
}

function mergeState(existingState, incomingState) {
  const existing = normalizeState(existingState);
  const incoming = normalizeState(incomingState);
  const byId = (items) => new Map(items.filter((item) => item && item.id).map((item) => [item.id, item]));
  const existingAccounts = byId(existing.accounts);
  const incomingAccounts = byId(incoming.accounts);
  const existingCards = byId(existing.cards);
  const incomingCards = byId(incoming.cards);

  const accounts = [...new Set([...existingAccounts.keys(), ...incomingAccounts.keys()])].map((id) => {
    const oldAccount = existingAccounts.get(id);
    const nextAccount = incomingAccounts.get(id);
    if (!oldAccount) return nextAccount;
    if (!nextAccount) return oldAccount;
    return {
      ...oldAccount,
      ...nextAccount,
      balance: Number(oldAccount.balance || 0),
      order: oldAccount.order,
      active: oldAccount.active === false ? false : nextAccount.active !== false,
    };
  });

  const cards = [...new Set([...existingCards.keys(), ...incomingCards.keys()])].map((id) => {
    const oldCard = existingCards.get(id);
    const nextCard = incomingCards.get(id);
    if (!oldCard) return nextCard;
    if (!nextCard) return oldCard;
    return {
      ...oldCard,
      ...nextCard,
      balance: Number(oldCard.balance || 0),
      order: oldCard.order,
      active: oldCard.active === false ? false : nextCard.active !== false,
    };
  });

  return normalizeState({
    ...existing,
    ...incoming,
    accounts,
    cards,
    transactions: mergeById(existing.transactions, incoming.transactions),
    bills: mergeById(existing.bills, incoming.bills).filter((bill) => bill.status !== "paid"),
    subscriptions: mergeById(existing.subscriptions, incoming.subscriptions),
  });
}

function mergeById(left, right) {
  const map = new Map();
  [...left, ...right].forEach((item) => {
    if (item && item.id) map.set(item.id, { ...(map.get(item.id) || {}), ...item });
  });
  return [...map.values()];
}

function ensureState() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STATE_FILE)) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(defaultState(), null, 2));
  }
}

function readState() {
  ensureState();
  const raw = fs.readFileSync(STATE_FILE, "utf8");
  const state = normalizeState(JSON.parse(raw));
  const normalized = JSON.stringify(state, null, 2);
  if (raw.trim() !== normalized.trim()) {
    writeState(state);
  }
  return state;
}

function writeState(state) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(STATE_FILE)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.copyFileSync(STATE_FILE, path.join(BACKUP_DIR, `bankluv-state-${stamp}.json`));
  }
  const tempFile = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(normalizeState(state), null, 2));
  fs.renameSync(tempFile, STATE_FILE);
}

function saveMergedState(incomingState) {
  const existingState = readState();
  const merged = mergeState(existingState, incomingState);
  writeState(merged);
  return merged;
}

function moveOrderedItem(items, itemId, direction, filterItem) {
  const orderedItems = items
    .filter(filterItem)
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  const index = orderedItems.findIndex((item) => item.id === itemId);
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= orderedItems.length) return false;
  const [movedItem] = orderedItems.splice(index, 1);
  orderedItems.splice(targetIndex, 0, movedItem);
  orderedItems.forEach((item, itemIndex) => {
    item.order = itemIndex;
  });
  return true;
}

function chargeSubscription(state, subscription) {
  const card = state.cards.find((entry) => entry.id === subscription.cardId && entry.active);
  const account = card ? state.accounts.find((entry) => entry.id === card.accountId && entry.active !== false) : null;
  if (!card || !account || card.type !== "credit") return { ok: false, reason: "Card unavailable" };
  const amount = roundMoney(subscription.amount);
  const available = Number(card.creditLimit || 0) - Number(card.balance || 0);
  if (amount <= 0 || available < amount) return { ok: false, reason: "Insufficient credit" };

  card.balance = roundMoney(Number(card.balance || 0) + amount);
  state.transactions.push({
    id: makeId("txn"),
    createdAt: new Date().toISOString(),
    merchant: subscription.name,
    items: [{ name: subscription.name, price: amount }],
    subtotal: amount,
    itemDiscountAmount: 0,
    orderDiscountPercent: 0,
    orderDiscountAmount: 0,
    discountTotal: 0,
    total: amount,
    method: "credit",
    cardId: card.id,
    accountId: card.accountId,
    cashName: "",
    status: "approved",
    subscriptionId: subscription.id,
  });
  subscription.lastChargedAt = new Date().toISOString();
  return { ok: true };
}

function payBill(state, bill) {
  const card = state.cards.find((entry) => entry.id === bill.cardId);
  const account = state.accounts.find((entry) => entry.id === bill.accountId && entry.active !== false);
  if (!bill || bill.status === "paid" || !card || !account) return { ok: false, reason: "Bill unavailable" };
  const amount = roundMoney(bill.amount);
  if (Number(account.balance || 0) < amount) return { ok: false, reason: "Insufficient account balance" };

  account.balance = roundMoney(Number(account.balance || 0) - amount);
  card.balance = roundMoney(Math.max(Number(card.balance || 0) - amount, 0));
  bill.status = "paid";
  bill.paidAt = new Date().toISOString();
  return { ok: true };
}

function buildCheckoutItems(items) {
  return items.map((item) => {
    const price = roundMoney(item.price);
    const discountPercent = parsePercent(item.discountPercent);
    return {
      name: String(item.name || "").trim(),
      price,
      discountPercent,
      finalPrice: roundMoney(price * (1 - discountPercent / 100)),
    };
  });
}

function checkoutTotals(items, orderDiscountPercent) {
  const subtotal = roundMoney(items.reduce((sum, item) => sum + Number(item.price || 0), 0));
  const afterItemDiscounts = roundMoney(items.reduce((sum, item) => sum + Number(item.finalPrice || 0), 0));
  const itemDiscountAmount = roundMoney(subtotal - afterItemDiscounts);
  const orderDiscountAmount = roundMoney(afterItemDiscounts * (parsePercent(orderDiscountPercent) / 100));
  const total = roundMoney(afterItemDiscounts - orderDiscountAmount);
  return {
    subtotal,
    itemDiscountAmount,
    orderDiscountPercent: parsePercent(orderDiscountPercent),
    orderDiscountAmount,
    discountTotal: roundMoney(itemDiscountAmount + orderDiscountAmount),
    total,
  };
}

function normalizeCardPayments(body, total) {
  let payments = Array.isArray(body.cardPayments) ? body.cardPayments : [];
  if (!payments.length && body.cardNumber) {
    payments = [{ cardNumber: body.cardNumber, pin: body.pin, amount: total }];
  }

  payments = payments
    .map((payment) => ({
      cardNumber: String(payment.cardNumber || "").replace(/\D/g, ""),
      pin: String(payment.pin || "").replace(/\D/g, ""),
      amount: roundMoney(payment.amount),
    }))
    .filter((payment) => payment.cardNumber);

  if (!payments.length) return [];

  const hasCustomAmounts = payments.some((payment) => payment.amount > 0);
  if (!hasCustomAmounts) {
    let remaining = total;
    payments = payments.map((payment, index) => {
      const amount = index === payments.length - 1 ? remaining : roundMoney(remaining / (payments.length - index));
      remaining = roundMoney(remaining - amount);
      return { ...payment, amount };
    });
  }

  return payments;
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function buildCustomerPortal(state, account) {
  const cards = state.cards
    .filter((card) => card.accountId === account.id && card.active)
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  const transactions = state.transactions.filter((txn) => txn.accountId === account.id);
  const bills = state.bills.filter((bill) => bill.accountId === account.id);

  return {
    account: {
      id: account.id,
      ownerName: account.ownerName,
      username: account.username,
      balance: account.balance,
    },
    cards,
    transactions,
    bills,
  };
}

function findBankmoRecipient(state, senderId, recipientName) {
  const normalizedName = normalizeName(recipientName);
  if (!normalizedName) return { error: "Enter who you want to send Bankmo money to." };
  const matches = state.accounts.filter(
    (entry) => entry.active !== false && entry.id !== senderId && normalizeName(entry.ownerName) === normalizedName,
  );
  if (!matches.length) return { error: "That Bankmo recipient was not found." };
  if (matches.length > 1) return { error: "More than one person has that name. Ask the manager to make the names more specific." };
  return { account: matches[0] };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function safeFilePath(urlPath) {
  let routePath =
    urlPath === "/"
      ? "/index.html"
      : urlPath === "/manager"
        ? "/manager.html"
        : urlPath === "/checkout"
          ? "/checkout.html"
          : urlPath === "/customer"
            ? "/customer.html"
            : urlPath;

  const modeFiles = {
    manager: ["/manager.html", "/manager.js", "/styles.css"],
    checkout: ["/checkout.html", "/checkout.js", "/styles.css"],
    customer: ["/customer.html", "/customer.js", "/styles.css"],
  };

  if (APP_MODE in modeFiles) {
    if (urlPath === "/") routePath = `/${APP_MODE}.html`;
    if (urlPath === `/${APP_MODE}`) routePath = `/${APP_MODE}.html`;
    if (!modeFiles[APP_MODE].includes(routePath)) return null;
  }

  if (APP_MODE === "customer") {
    if (urlPath === "/" || urlPath === "/customer") routePath = "/customer.html";
    if (routePath === "/index.html" || urlPath === "/manager" || urlPath === "/checkout") return null;
    if (!["/customer.html", "/customer.js", "/styles.css"].includes(routePath)) return null;
  }

  const decoded = decodeURIComponent(routePath);
  const filePath = path.join(ROOT, decoded);
  return filePath.startsWith(ROOT) ? filePath : null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (url.pathname === "/api/state" && req.method === "GET") {
      sendJson(res, 200, readState());
      return;
    }

    if (url.pathname === "/api/customer-login" && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      const username = normalizeCredential(body.username);
      const password = normalizeCredential(body.password);
      const state = readState();
      const account = state.accounts.find(
        (entry) =>
          entry.active !== false &&
          normalizeCredential(entry.username) === username &&
          normalizeCredential(entry.password) === password,
      );

      if (!account) {
        sendJson(res, 401, { error: "Login did not match a BankLuv account." });
        return;
      }

      sendJson(res, 200, buildCustomerPortal(state, account));
      return;
    }

    if (url.pathname === "/api/customer" && req.method === "GET") {
      const accountId = url.searchParams.get("id");
      const state = readState();
      const account = state.accounts.find((entry) => entry.id === accountId && entry.active !== false);

      if (!account) {
        sendJson(res, 404, { error: "Customer account was not found." });
        return;
      }

      sendJson(res, 200, buildCustomerPortal(state, account));
      return;
    }

    if (url.pathname === "/api/customer-card-note" && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      const accountId = String(body.accountId || "");
      const cardId = String(body.cardId || "");
      const note = String(body.note || "").slice(0, 500);
      const state = readState();
      const account = state.accounts.find((entry) => entry.id === accountId && entry.active !== false);
      const card = state.cards.find((entry) => entry.id === cardId && entry.accountId === accountId && entry.active);

      if (!account || !card) {
        sendJson(res, 404, { error: "Card was not found for this customer." });
        return;
      }

      card.note = note;
      writeState(state);
      sendJson(res, 200, buildCustomerPortal(state, account));
      return;
    }

    if (url.pathname === "/api/bankmo-transfer" && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      const senderId = String(body.accountId || "");
      const recipientName = String(body.recipientName || "").trim();
      const amount = roundMoney(body.amount);
      const state = readState();
      const sender = state.accounts.find((entry) => entry.id === senderId && entry.active !== false);
      const recipientResult = findBankmoRecipient(state, senderId, recipientName);
      const recipient = recipientResult.account;

      if (!sender) {
        sendJson(res, 404, { error: "Login again before sending Bankmo money." });
        return;
      }
      if (!recipient) {
        sendJson(res, 404, { error: recipientResult.error });
        return;
      }
      if (amount <= 0) {
        sendJson(res, 400, { error: "Bankmo amount must be greater than $0." });
        return;
      }
      if (Number(sender.balance || 0) < amount) {
        sendJson(res, 400, { error: "You do not have enough cash balance for that Bankmo transfer." });
        return;
      }

      sender.balance = roundMoney(Number(sender.balance || 0) - amount);
      recipient.balance = roundMoney(Number(recipient.balance || 0) + amount);

      const transferId = makeId("bankmo");
      const createdAt = new Date().toISOString();
      state.transactions.push({
        id: `${transferId}_out`,
        createdAt,
        merchant: "Bankmo",
        items: [{ name: `Sent to ${recipient.ownerName}`, price: amount }],
        total: amount,
        method: "bankmo",
        accountId: sender.id,
        relatedAccountId: recipient.id,
        status: "sent",
      });
      state.transactions.push({
        id: `${transferId}_in`,
        createdAt,
        merchant: "Bankmo",
        items: [{ name: `Received from ${sender.ownerName}`, price: amount }],
        total: amount,
        method: "bankmo",
        accountId: recipient.id,
        relatedAccountId: sender.id,
        status: "received",
      });

      writeState(state);
      sendJson(res, 200, buildCustomerPortal(state, sender));
      return;
    }

    if (url.pathname === "/api/deposit" && req.method === "POST" && APP_MODE !== "customer") {
      const body = JSON.parse(await readBody(req));
      const state = readState();
      const account = state.accounts.find((entry) => entry.id === body.accountId && entry.active !== false);
      const amount = roundMoney(body.amount);
      if (!account || amount <= 0) {
        sendJson(res, 400, { error: "Deposit needs a valid account and amount." });
        return;
      }
      account.balance = roundMoney(Number(account.balance || 0) + amount);
      writeState(state);
      sendJson(res, 200, state);
      return;
    }

    if (url.pathname === "/api/subscriptions" && req.method === "POST" && APP_MODE !== "customer") {
      const body = JSON.parse(await readBody(req));
      const state = readState();
      const card = state.cards.find((entry) => entry.id === body.cardId && entry.active && entry.type === "credit");
      const account = card ? state.accounts.find((entry) => entry.id === card.accountId && entry.active !== false) : null;
      const amount = roundMoney(body.amount);
      const name = String(body.name || "").trim();
      if (!card || !account || !name || amount <= 0) {
        sendJson(res, 400, { error: "Subscription needs a name, amount, and active credit card." });
        return;
      }
      state.subscriptions.push({
        id: makeId("sub"),
        name,
        amount,
        cardId: card.id,
        accountId: card.accountId,
        active: true,
        createdAt: new Date().toISOString(),
        lastChargedAt: null,
      });
      writeState(state);
      sendJson(res, 200, state);
      return;
    }

    if (url.pathname === "/api/subscriptions/delete" && req.method === "POST" && APP_MODE !== "customer") {
      const body = JSON.parse(await readBody(req));
      const state = readState();
      state.subscriptions = state.subscriptions.map((subscription) =>
        subscription.id === body.id ? { ...subscription, active: false } : subscription,
      );
      writeState(state);
      sendJson(res, 200, state);
      return;
    }

    if (url.pathname === "/api/reorder-account" && req.method === "POST" && APP_MODE !== "customer") {
      const body = JSON.parse(await readBody(req));
      const direction = Number(body.direction) < 0 ? -1 : 1;
      const state = readState();
      const moved = moveOrderedItem(
        state.accounts,
        String(body.accountId || ""),
        direction,
        (account) => account.active !== false,
      );
      if (!moved) {
        sendJson(res, 400, { error: "That account cannot move farther in that direction." });
        return;
      }
      writeState(state);
      sendJson(res, 200, state);
      return;
    }

    if (url.pathname === "/api/reorder-card" && req.method === "POST" && APP_MODE !== "customer") {
      const body = JSON.parse(await readBody(req));
      const direction = Number(body.direction) < 0 ? -1 : 1;
      const state = readState();
      const card = state.cards.find((entry) => entry.id === body.cardId && entry.active);
      const account = card ? state.accounts.find((entry) => entry.id === card.accountId && entry.active !== false) : null;
      if (!card || !account) {
        sendJson(res, 404, { error: "That card was not found." });
        return;
      }
      const moved = moveOrderedItem(
        state.cards,
        card.id,
        direction,
        (entry) => entry.accountId === card.accountId && entry.active,
      );
      if (!moved) {
        sendJson(res, 400, { error: "That card cannot move farther in that direction." });
        return;
      }
      writeState(state);
      sendJson(res, 200, state);
      return;
    }

    if (url.pathname === "/api/bills/pay-all" && req.method === "POST" && APP_MODE !== "customer") {
      const state = readState();
      const charged = [];
      const paid = [];
      const skipped = [];

      state.subscriptions
        .filter((subscription) => subscription.active)
        .forEach((subscription) => {
          const result = chargeSubscription(state, subscription);
          if (result.ok) charged.push(subscription.id);
          else skipped.push({ id: subscription.id, reason: result.reason });
        });

      state.bills = state.bills.filter((bill) => bill.status !== "open");
      state.cards
        .filter(
          (card) =>
            card.active &&
            card.type === "credit" &&
            Number(card.balance || 0) > 0 &&
            state.accounts.some((account) => account.id === card.accountId && account.active !== false),
        )
        .forEach((card) => {
          state.bills.push({
            id: makeId("bill"),
            cardId: card.id,
            accountId: card.accountId,
            amount: roundMoney(card.balance),
            status: "open",
            createdAt: new Date().toISOString(),
            paidAt: null,
          });
        });

      state.bills.forEach((bill) => {
        if (bill.status === "paid") return;
        const result = payBill(state, bill);
        if (result.ok) paid.push(bill.id);
        else skipped.push({ id: bill.id, reason: result.reason });
      });

      state.bills = state.bills.filter((bill) => bill.status !== "paid");
      writeState(state);
      sendJson(res, 200, { state, charged, paid, skipped });
      return;
    }

    if (url.pathname === "/api/bills/pay" && req.method === "POST" && APP_MODE !== "customer") {
      const body = JSON.parse(await readBody(req));
      const state = readState();
      const bill = state.bills.find((entry) => entry.id === body.id);
      const result = payBill(state, bill);
      if (!result.ok) {
        sendJson(res, 400, { error: result.reason });
        return;
      }
      state.bills = state.bills.filter((entry) => entry.status !== "paid");
      writeState(state);
      sendJson(res, 200, state);
      return;
    }

    if (url.pathname === "/api/checkout-charge" && req.method === "POST" && APP_MODE !== "customer") {
      const body = JSON.parse(await readBody(req));
      const state = readState();
      const items = buildCheckoutItems(body.items || []).filter((item) => item.name && item.price > 0);
      const totals = checkoutTotals(items, body.orderDiscountPercent);
      const method = String(body.method || "card");
      const merchantName = String(body.merchantName || "BankLuv Companion").trim() || "BankLuv Companion";
      if (!items.length || totals.total <= 0) {
        sendJson(res, 400, { error: "Add at least one cart item before checkout." });
        return;
      }

      const transaction = {
        id: makeId("txn"),
        createdAt: new Date().toISOString(),
        merchant: merchantName,
        items,
        ...totals,
        method: "cash",
        cardId: null,
        accountId: null,
        cashName: "",
        status: "approved",
      };

      if (method === "cash") {
        const cashName = String(body.cashName || "").trim();
        if (!cashName) {
          sendJson(res, 400, { error: "Cash checkout requires a customer name." });
          return;
        }
        transaction.cashName = cashName;
      } else {
        const payments = normalizeCardPayments(body, totals.total);
        const paymentTotal = roundMoney(payments.reduce((sum, payment) => sum + payment.amount, 0));
        if (!payments.length) {
          sendJson(res, 400, { error: "Add at least one card for card checkout." });
          return;
        }
        if (paymentTotal !== totals.total) {
          sendJson(res, 400, { error: `Card split must add up to $${totals.total.toFixed(2)}.` });
          return;
        }

        const validatedPayments = [];
        for (const payment of payments) {
          const card = state.cards.find((entry) => entry.active && String(entry.number || "").replace(/\D/g, "") === payment.cardNumber);
          if (!card) {
            sendJson(res, 400, { error: "Card was not found or is no longer active." });
            return;
          }
          const account = state.accounts.find((entry) => entry.id === card.accountId && entry.active !== false);
          if (!account) {
            sendJson(res, 400, { error: "The card has no linked account." });
            return;
          }
          if (card.type === "debit") {
            if (payment.pin !== card.pin) {
              sendJson(res, 400, { error: `Debit PIN declined for card ending ${String(card.number).slice(-4)}.` });
              return;
            }
            if (Number(account.balance || 0) < payment.amount) {
              sendJson(res, 400, {
                error:
                  payments.length === 1
                    ? "That card does not have enough money. Add another card and split the price."
                    : `Card ending ${String(card.number).slice(-4)} cannot cover its split amount.`,
              });
              return;
            }
          } else {
            const available = Number(card.creditLimit || 0) - Number(card.balance || 0);
            if (available < payment.amount) {
              sendJson(res, 400, {
                error:
                  payments.length === 1
                    ? "That card does not have enough available credit. Add another card and split the price."
                    : `Card ending ${String(card.number).slice(-4)} cannot cover its split amount.`,
              });
              return;
            }
          }
          validatedPayments.push({ card, account, amount: payment.amount });
        }

        const debitTotals = new Map();
        const creditTotals = new Map();
        validatedPayments.forEach(({ card, account, amount }) => {
          if (card.type === "debit") {
            debitTotals.set(account.id, roundMoney((debitTotals.get(account.id) || 0) + amount));
          } else {
            creditTotals.set(card.id, roundMoney((creditTotals.get(card.id) || 0) + amount));
          }
        });
        for (const [accountId, amount] of debitTotals) {
          const account = state.accounts.find((entry) => entry.id === accountId && entry.active !== false);
          if (Number(account?.balance || 0) < amount) {
            sendJson(res, 400, {
              error:
                payments.length === 1
                  ? "That card does not have enough money. Add another card and split the price."
                  : "Those debit cards share an account that cannot cover the combined split amount.",
            });
            return;
          }
        }
        for (const [cardId, amount] of creditTotals) {
          const card = state.cards.find((entry) => entry.id === cardId);
          const available = Number(card?.creditLimit || 0) - Number(card?.balance || 0);
          if (available < amount) {
            sendJson(res, 400, {
              error:
                payments.length === 1
                  ? "That card does not have enough available credit. Add another card and split the price."
                  : `Card ending ${String(card?.number || "").slice(-4)} cannot cover its combined split amount.`,
            });
            return;
          }
        }

        validatedPayments.forEach(({ card, account, amount }) => {
          if (card.type === "debit") account.balance = roundMoney(Number(account.balance || 0) - amount);
          else card.balance = roundMoney(Number(card.balance || 0) + amount);
        });

        transaction.method = validatedPayments.length > 1 ? "split-card" : validatedPayments[0].card.type;
        transaction.cardId = validatedPayments[0].card.id;
        transaction.accountId = validatedPayments[0].account.id;
        transaction.paymentSplits = validatedPayments.map(({ card, amount }) => ({
          cardId: card.id,
          type: card.type,
          last4: String(card.number || "").slice(-4),
          amount,
        }));
      }

      state.transactions.push(transaction);
      state.cart = [];
      state.checkout = { ...(state.checkout || {}), orderDiscountPercent: 0 };
      writeState(state);
      sendJson(res, 200, { state, transaction });
      return;
    }

    if (url.pathname === "/api/state" && req.method === "PUT" && APP_MODE !== "customer") {
      const body = await readBody(req);
      const nextState = JSON.parse(body);
      const merged = saveMergedState(nextState);
      sendJson(res, 200, merged);
      return;
    }

    if (url.pathname === "/api/reset" && req.method === "POST" && APP_MODE !== "customer") {
      const nextState = defaultState();
      writeState(nextState);
      sendJson(res, 200, nextState);
      return;
    }

    const filePath = safeFilePath(url.pathname);
    if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath);
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(PORT, () => {
  if (APP_MODE === "manager") {
    console.log(`BankLuv manager-only app: http://localhost:${PORT}/manager`);
    return;
  }

  if (APP_MODE === "checkout") {
    console.log(`BankLuv checkout-only app: http://localhost:${PORT}/checkout`);
    return;
  }

  if (APP_MODE === "customer") {
    console.log(`BankLuv customer-only portal: http://localhost:${PORT}/customer`);
    return;
  }

  console.log(`BankLuv manager: http://localhost:${PORT}/manager`);
  console.log(`BankLuv checkout: http://localhost:${PORT}/checkout`);
  console.log(`BankLuv customer: http://localhost:${PORT}/customer`);
});
