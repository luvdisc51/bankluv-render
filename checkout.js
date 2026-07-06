const STORAGE_KEY = "bankluv.state.v1";
const CHECKOUT_SESSION_KEY = "bankluv.checkout.unlocked";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

const els = {
  checkoutLoginPanel: document.querySelector("#checkoutLoginPanel"),
  checkoutLoginForm: document.querySelector("#checkoutLoginForm"),
  checkoutLoginMessage: document.querySelector("#checkoutLoginMessage"),
  checkoutApp: document.querySelector("#checkoutApp"),
  lockCheckout: document.querySelector("#lockCheckout"),
  itemForm: document.querySelector("#itemForm"),
  clearCart: document.querySelector("#clearCart"),
  cartItems: document.querySelector("#cartItems"),
  cartTotal: document.querySelector("#cartTotal"),
  discountSummary: document.querySelector("#discountSummary"),
  orderDiscountInput: document.querySelector("#orderDiscountInput"),
  chargeForm: document.querySelector("#chargeForm"),
  cardPaymentFields: document.querySelector("#cardPaymentFields"),
  addSplitCard: document.querySelector("#addSplitCard"),
  splitCards: document.querySelector("#splitCards"),
  cashPaymentFields: document.querySelector("#cashPaymentFields"),
  checkoutMessage: document.querySelector("#checkoutMessage"),
  purchaseHistory: document.querySelector("#purchaseHistory"),
};

let state = normalizeState({});
let checkoutUnlocked = sessionStorage.getItem(CHECKOUT_SESSION_KEY) === "true";
let splitCards = [{ id: makeId("split"), cardNumber: "", pin: "", amount: 0, manual: false }];

function normalizeState(nextState) {
  const normalized = {
    activeCustomerId: null,
    cart: [],
    checkout: { orderDiscountPercent: 0 },
    accounts: [],
    cards: [],
    transactions: [],
    bills: [],
    ...nextState,
    checkout: {
      orderDiscountPercent: 0,
      ...(nextState?.checkout || {}),
    },
    settings: {
      managerPassword: "manager",
      checkoutPassword: "checkout",
      ...(nextState?.settings || {}),
    },
  };
  normalized.accounts.forEach((account) => {
    if (typeof account.active !== "boolean") account.active = true;
  });
  normalized.cards.forEach((card) => {
    if (typeof card.active !== "boolean") card.active = true;
  });
  normalized.cart = normalized.cart.map(normalizeCartItem);
  return normalized;
}

function makeId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function cleanNumber(value) {
  return String(value || "").replace(/\D/g, "");
}

function formatCardNumber(number) {
  return cleanNumber(number).replace(/(\d{4})(?=\d)/g, "$1 ");
}

function last4(number) {
  return cleanNumber(number).slice(-4);
}

function money(value) {
  return usd.format(Number(value || 0));
}

function parseMoney(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function parsePercent(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(Math.max(parsed, 0), 100);
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function itemQuantity(item) {
  const quantity = Math.floor(Number(item.quantity || 1));
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

function itemUnitDiscounts(item) {
  const quantity = itemQuantity(item);
  const rawDiscounts = Array.isArray(item.unitDiscountPercents) ? item.unitDiscountPercents : [];
  return Array.from({ length: quantity }, (_, index) => parsePercent(rawDiscounts[index] ?? item.discountPercent ?? 0));
}

function normalizeCartItem(item) {
  const quantity = itemQuantity(item);
  const unitDiscountPercents = itemUnitDiscounts({ ...item, quantity });
  return {
    ...item,
    price: parseMoney(item.price),
    quantity,
    unitDiscountPercents,
    discountPercent: unitDiscountPercents.every((discount) => discount === unitDiscountPercents[0]) ? unitDiscountPercents[0] : 0,
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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
    return saved ? normalizeState(JSON.parse(saved)) : normalizeState({});
  } catch {
    return normalizeState({});
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

function findAccount(id) {
  return state.accounts.find((account) => account.id === id && account.active !== false);
}

function findCard(id) {
  return state.cards.find((card) => card.id === id);
}

function findCardByNumber(number) {
  const normalized = cleanNumber(number);
  return state.cards.find((card) => card.active && cleanNumber(card.number) === normalized);
}

function cartTotal() {
  return cartTotals().total;
}

function itemDiscountPercent(item) {
  const discounts = itemUnitDiscounts(item);
  return discounts.every((discount) => discount === discounts[0]) ? discounts[0] : 0;
}

function itemSubtotal(item) {
  return roundMoney(Number(item.price || 0) * itemQuantity(item));
}

function itemFinalPrice(item) {
  return roundMoney(
    itemUnitDiscounts(item).reduce((sum, discountPercent) => sum + Number(item.price || 0) * (1 - discountPercent / 100), 0),
  );
}

function cartTotals() {
  const subtotal = roundMoney(state.cart.reduce((sum, item) => sum + itemSubtotal(item), 0));
  const afterItemDiscounts = roundMoney(state.cart.reduce((sum, item) => sum + itemFinalPrice(item), 0));
  const itemDiscountAmount = roundMoney(subtotal - afterItemDiscounts);
  const orderDiscountPercent = parsePercent(state.checkout.orderDiscountPercent);
  const orderDiscountAmount = roundMoney(afterItemDiscounts * (orderDiscountPercent / 100));
  const total = roundMoney(afterItemDiscounts - orderDiscountAmount);

  return {
    subtotal,
    itemDiscountAmount,
    orderDiscountPercent,
    orderDiscountAmount,
    discountTotal: roundMoney(itemDiscountAmount + orderDiscountAmount),
    total,
  };
}

function setCheckoutMessage(text, kind = "") {
  els.checkoutMessage.textContent = text;
  els.checkoutMessage.className = `status-message ${kind}`;
}

function render() {
  renderLockState();
  if (checkoutUnlocked) {
    renderCart();
    renderSplitCards();
    renderPurchases();
  }
}

function persistAndRender() {
  saveState();
  render();
}

function renderLockState() {
  els.checkoutLoginPanel.classList.toggle("hidden", checkoutUnlocked);
  els.checkoutApp.classList.toggle("hidden", !checkoutUnlocked);
  els.lockCheckout.classList.toggle("hidden", !checkoutUnlocked);
}

function renderCart() {
  const totals = cartTotals();
  els.orderDiscountInput.value = totals.orderDiscountPercent;
  els.cartTotal.textContent = money(totals.total);
  els.discountSummary.textContent =
    totals.discountTotal > 0
      ? `${money(totals.subtotal)} subtotal - ${money(totals.discountTotal)} discount`
      : `${money(totals.subtotal)} subtotal`;
  els.cartItems.innerHTML = state.cart.length
    ? state.cart
        .map(
          (item) => {
            const discounts = itemUnitDiscounts(item);
            const sameDiscount = discounts.every((discount) => discount === discounts[0]);
            return `
          <div class="cart-row">
            <div class="cart-main">
              <div class="record-title">${escapeHtml(item.name)} x${itemQuantity(item)}</div>
              <div class="record-meta">${money(item.price)} each - ${money(itemFinalPrice(item))} line total${itemSubtotal(item) !== itemFinalPrice(item) ? ` - ${money(itemSubtotal(item) - itemFinalPrice(item))} off` : ""}</div>
            </div>
            <label class="line-discount-control">
              All %
              <input data-discount-all-id="${item.id}" type="number" min="0" max="100" step="0.01" value="${sameDiscount ? discounts[0] : 0}" />
            </label>
            <div class="unit-discount-grid">
              ${discounts
                .map(
                  (discount, index) => `
                    <label>
                      #${index + 1} %
                      <input data-unit-discount-id="${item.id}" data-unit-index="${index}" type="number" min="0" max="100" step="0.01" value="${discount}" />
                    </label>
                  `,
                )
                .join("")}
            </div>
            <button class="icon-button" data-action="remove-item" data-id="${item.id}" type="button" aria-label="Remove ${escapeHtml(item.name)}">x</button>
          </div>
        `;
          },
        )
        .join("")
    : `<div class="empty">Cart is empty.</div>`;
}

function rebalanceSplitCards(force = false) {
  const total = cartTotal();
  const count = Math.max(splitCards.length, 1);
  let remaining = total;
  const editableCards = splitCards.filter((card) => force || !card.manual);
  splitCards.forEach((card) => {
    if (!force && card.manual) remaining = roundMoney(remaining - Number(card.amount || 0));
  });

  const editableCount = editableCards.length;
  editableCards.forEach((card, index) => {
    const amount = editableCount <= 0 ? 0 : index === editableCount - 1 ? remaining : roundMoney(remaining / (editableCount - index));
    card.amount = roundMoney(Math.max(amount, 0));
    remaining = roundMoney(remaining - card.amount);
  });

  if (!splitCards.length) splitCards = [{ id: makeId("split"), cardNumber: "", pin: "", amount: total, manual: false }];
  if (count === 1 && !splitCards[0].manual) splitCards[0].amount = total;
}

function renderSplitCards() {
  rebalanceSplitCards();
  els.splitCards.innerHTML = splitCards
    .map(
      (split, index) => `
        <div class="split-card-row" data-split-id="${split.id}">
          <div class="split-card-title">
            <strong>Card ${index + 1}</strong>
            ${
              splitCards.length > 1
                ? `<button class="icon-button" data-action="remove-split-card" data-id="${split.id}" type="button" aria-label="Remove card">x</button>`
                : ""
            }
          </div>
          <label>Card number<input class="split-card-number" data-field="cardNumber" data-id="${split.id}" inputmode="numeric" value="${escapeHtml(split.cardNumber)}" placeholder="4111 0000 0000 0000" /></label>
          <div class="two-col">
            <label>Debit PIN<input class="split-card-pin" data-field="pin" data-id="${split.id}" inputmode="numeric" maxlength="6" value="${escapeHtml(split.pin)}" placeholder="Required for debit" /></label>
            <label>Charge amount<input class="split-card-amount" data-field="amount" data-id="${split.id}" type="number" min="0.01" step="0.01" value="${split.amount.toFixed(2)}" /></label>
          </div>
        </div>
      `,
    )
    .join("");
}

function renderPurchases() {
  const purchases = state.transactions.slice().reverse();
  els.purchaseHistory.innerHTML = purchases.length
    ? purchases.map(renderPurchase).join("")
    : `<div class="empty">No previous purchases yet.</div>`;
}

function renderPurchase(txn) {
  const customerName = firstNameForTransaction(txn);
  const paymentLabel =
    txn.method === "bankmo"
      ? txn.status === "received"
        ? "Bankmo received"
        : "Bankmo sent"
      : txn.method === "cash"
      ? `Cash - ${escapeHtml(txn.cashName || "Unknown")}`
      : txn.paymentSplits?.length > 1
        ? `${txn.paymentSplits.length} cards`
        : `${txn.method === "credit" ? "Credit" : "Debit"} ending ${last4(findCard(txn.cardId)?.number || txn.paymentSplits?.[0]?.cardNumber)}`;
  return `
    <article class="purchase">
      <div class="purchase-top">
        <div>
          <div class="record-title">${escapeHtml(txn.merchant)}</div>
          <div class="record-meta">${new Date(txn.createdAt).toLocaleString()}</div>
          <div class="record-meta">Customer: ${escapeHtml(customerName)}</div>
        </div>
        <span class="badge ${txn.method === "cash" ? "cash" : txn.method === "credit" ? "credit" : ""}">${paymentLabel}</span>
      </div>
      <p class="purchase-items">${txn.items
        .map((item) => {
          const quantity = itemQuantity(item);
          const discounts = itemUnitDiscounts(item);
          const unitDiscountText = discounts.some((discount) => discount > 0)
            ? ` (${discounts.map((discount, index) => `#${index + 1}: ${discount}%`).join(", ")})`
            : "";
          const finalPrice = item.finalPrice ?? item.price;
          return `${escapeHtml(item.name)} x${quantity} ${money(finalPrice)}${unitDiscountText}`;
        })
        .join(" - ")}</p>
      ${
        Number(txn.discountTotal || 0) > 0
          ? `<div class="record-meta">Subtotal ${money(txn.subtotal)} - Discount ${money(txn.discountTotal)}</div>`
          : ""
      }
      ${
        txn.paymentSplits?.length
          ? `<div class="record-meta">Cards: ${txn.paymentSplits
              .map((split) => `${escapeHtml(split.type)} ending ${escapeHtml(split.last4)} ${money(split.amount)}`)
              .join(" - ")}</div>`
          : ""
      }
      <div class="money-row"><span>Total</span><strong>${money(txn.total)}</strong></div>
    </article>
  `;
}

function firstNameForTransaction(txn) {
  const sourceName = txn.cashName || findAccount(txn.accountId)?.ownerName || "";
  return String(sourceName).trim().split(/\s+/)[0] || "Unknown";
}

els.checkoutLoginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const password = new FormData(formElement).get("password");
  if (password !== state.settings.checkoutPassword) {
    els.checkoutLoginMessage.textContent = "Checkout password did not match.";
    els.checkoutLoginMessage.className = "status-message error";
    return;
  }
  checkoutUnlocked = true;
  sessionStorage.setItem(CHECKOUT_SESSION_KEY, "true");
  formElement.reset();
  els.checkoutLoginMessage.textContent = "";
  render();
});

els.lockCheckout.addEventListener("click", () => {
  checkoutUnlocked = false;
  sessionStorage.removeItem(CHECKOUT_SESSION_KEY);
  render();
});

els.itemForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const name = String(form.get("itemName")).trim();
  const price = parseMoney(form.get("itemPrice"));
  const quantity = Math.max(1, Math.floor(Number(form.get("itemQuantity") || 1)));
  if (!name || price <= 0) return;
  state.cart.push({ id: makeId("item"), name, price, quantity, unitDiscountPercents: Array.from({ length: quantity }, () => 0) });
  formElement.reset();
  formElement.itemQuantity.value = "1";
  persistAndRender();
});

els.clearCart.addEventListener("click", () => {
  state.cart = [];
  state.checkout.orderDiscountPercent = 0;
  setCheckoutMessage("");
  persistAndRender();
});

els.cartItems.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action='remove-item']");
  if (!button) return;
  state.cart = state.cart.filter((item) => item.id !== button.dataset.id);
  persistAndRender();
});

els.cartItems.addEventListener("change", (event) => {
  const allInput = event.target.closest("input[data-discount-all-id]");
  const unitInput = event.target.closest("input[data-unit-discount-id]");
  if (!allInput && !unitInput) return;
  const itemId = allInput?.dataset.discountAllId || unitInput?.dataset.unitDiscountId;
  const item = state.cart.find((entry) => entry.id === itemId);
  if (!item) return;
  item.unitDiscountPercents = itemUnitDiscounts(item);
  if (allInput) {
    item.unitDiscountPercents = item.unitDiscountPercents.map(() => parsePercent(allInput.value));
  } else {
    item.unitDiscountPercents[Number(unitInput.dataset.unitIndex)] = parsePercent(unitInput.value);
  }
  item.discountPercent = itemDiscountPercent(item);
  persistAndRender();
});

els.orderDiscountInput.addEventListener("change", () => {
  state.checkout.orderDiscountPercent = parsePercent(els.orderDiscountInput.value);
  rebalanceSplitCards(true);
  persistAndRender();
});

els.addSplitCard.addEventListener("click", () => {
  splitCards.push({ id: makeId("split"), cardNumber: "", pin: "", amount: 0, manual: false });
  rebalanceSplitCards(true);
  renderSplitCards();
});

els.splitCards.addEventListener("input", (event) => {
  const input = event.target.closest("[data-field]");
  if (!input) return;
  const split = splitCards.find((entry) => entry.id === input.dataset.id);
  if (!split) return;
  if (input.dataset.field === "amount") {
    split.amount = parseMoney(input.value);
    split.manual = true;
  } else {
    split[input.dataset.field] = input.value;
  }
});

els.splitCards.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action='remove-split-card']");
  if (!button) return;
  splitCards = splitCards.filter((entry) => entry.id !== button.dataset.id);
  if (!splitCards.length) splitCards.push({ id: makeId("split"), cardNumber: "", pin: "", amount: 0, manual: false });
  rebalanceSplitCards(true);
  renderSplitCards();
});

document.querySelectorAll("input[name='paymentMethod']").forEach((input) => {
  input.addEventListener("change", () => {
    const method = document.querySelector("input[name='paymentMethod']:checked").value;
    els.cardPaymentFields.classList.toggle("hidden", method === "cash");
    els.cashPaymentFields.classList.toggle("hidden", method !== "cash");
  });
});

els.chargeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  state.checkout.orderDiscountPercent = parsePercent(els.orderDiscountInput.value);
  const totals = cartTotals();
  const total = totals.total;
  const method = document.querySelector("input[name='paymentMethod']:checked").value;
  if (!state.cart.length || total <= 0) {
    setCheckoutMessage("Add at least one cart item before checkout.", "error");
    return;
  }

  const form = new FormData(formElement);
  const cardPayments = splitCards.map((split) => ({
    cardNumber: split.cardNumber,
    pin: split.pin,
    amount: split.amount,
  }));
  const items = state.cart.map((item) => ({
    name: item.name,
    price: item.price,
    quantity: itemQuantity(item),
    unitDiscountPercents: itemUnitDiscounts(item),
    discountPercent: itemDiscountPercent(item),
    finalPrice: itemFinalPrice(item),
  }));

  if (location.protocol !== "file:") {
    const payload = {
      items,
      orderDiscountPercent: totals.orderDiscountPercent,
      method,
      cardPayments,
      merchantName: form.get("merchantName"),
      cashName: form.get("cashName"),
    };
    postJson("/api/checkout-charge", payload)
      .then((result) => {
        state = normalizeState(result.state);
        formElement.reset();
        splitCards = [{ id: makeId("split"), cardNumber: "", pin: "", amount: 0, manual: false }];
        rebalanceSplitCards(true);
        els.cardPaymentFields.classList.remove("hidden");
        els.cashPaymentFields.classList.add("hidden");
        document.querySelector("input[name='paymentMethod'][value='card']").checked = true;
        setCheckoutMessage(`Approved: ${money(result.transaction.total)} ${method === "cash" ? "cash" : "card"} purchase.`, "success");
        render();
      })
      .catch((error) => setCheckoutMessage(error.message, "error"));
    return;
  }

  const transaction = {
    id: makeId("txn"),
    createdAt: new Date().toISOString(),
    merchant: String(form.get("merchantName") || "BankLuv Companion").trim() || "BankLuv Companion",
    items,
    subtotal: totals.subtotal,
    itemDiscountAmount: totals.itemDiscountAmount,
    orderDiscountPercent: totals.orderDiscountPercent,
    orderDiscountAmount: totals.orderDiscountAmount,
    discountTotal: totals.discountTotal,
    total,
    method: "cash",
    cardId: null,
    accountId: null,
    cashName: "",
    status: "approved",
  };

  if (method === "cash") {
    const cashName = String(form.get("cashName")).trim();
    if (!cashName) {
      setCheckoutMessage("Cash checkout requires a customer name.", "error");
      return;
    }
    transaction.cashName = cashName;
  } else {
    const payments = cardPayments.filter((payment) => cleanNumber(payment.cardNumber));
    const paymentTotal = roundMoney(payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0));
    if (!payments.length || paymentTotal !== total) {
      setCheckoutMessage(`Card split must add up to ${money(total)}.`, "error");
      return;
    }
    const applied = [];
    for (const payment of payments) {
      const card = findCardByNumber(payment.cardNumber);
      if (!card) {
        setCheckoutMessage("Card was not found or is no longer active.", "error");
        return;
      }
      const account = findAccount(card.accountId);
      if (!account) {
        setCheckoutMessage("The card has no linked account.", "error");
        return;
      }
      if (card.type === "debit") {
        const pin = cleanNumber(payment.pin);
        if (pin !== card.pin) {
          setCheckoutMessage(`Debit PIN declined for card ending ${last4(card.number)}.`, "error");
          return;
        }
        if (account.balance < payment.amount) {
          setCheckoutMessage(
            payments.length === 1
              ? "That card does not have enough money. Add another card and split the price."
              : `Card ending ${last4(card.number)} cannot cover its split amount.`,
            "error",
          );
          return;
        }
      } else {
        const available = card.creditLimit - card.balance;
        if (available < payment.amount) {
          setCheckoutMessage(
            payments.length === 1
              ? "That card does not have enough available credit. Add another card and split the price."
              : `Card ending ${last4(card.number)} cannot cover its split amount.`,
            "error",
          );
          return;
        }
      }
      applied.push({ card, account, amount: payment.amount });
    }
    const debitTotals = new Map();
    const creditTotals = new Map();
    applied.forEach(({ card, account, amount }) => {
      if (card.type === "debit") {
        debitTotals.set(account.id, roundMoney((debitTotals.get(account.id) || 0) + amount));
      } else {
        creditTotals.set(card.id, roundMoney((creditTotals.get(card.id) || 0) + amount));
      }
    });
    for (const [accountId, amount] of debitTotals) {
      const account = findAccount(accountId);
      if (Number(account?.balance || 0) < amount) {
        setCheckoutMessage(
          payments.length === 1
            ? "That card does not have enough money. Add another card and split the price."
            : "Those debit cards share an account that cannot cover the combined split amount.",
          "error",
        );
        return;
      }
    }
    for (const [cardId, amount] of creditTotals) {
      const card = findCard(cardId);
      const available = Number(card?.creditLimit || 0) - Number(card?.balance || 0);
      if (available < amount) {
        setCheckoutMessage(
          payments.length === 1
            ? "That card does not have enough available credit. Add another card and split the price."
            : `Card ending ${last4(card?.number)} cannot cover its combined split amount.`,
          "error",
        );
        return;
      }
    }
    applied.forEach(({ card, account, amount }) => {
      if (card.type === "debit") account.balance = parseMoney(account.balance - amount);
      else card.balance = parseMoney(card.balance + amount);
    });
    transaction.method = applied.length > 1 ? "split-card" : applied[0].card.type;
    transaction.cardId = applied[0].card.id;
    transaction.accountId = applied[0].account.id;
    transaction.paymentSplits = applied.map(({ card, amount }) => ({
      cardId: card.id,
      type: card.type,
      last4: last4(card.number),
      amount,
    }));
  }

  state.transactions.push(transaction);
  state.cart = [];
  state.checkout.orderDiscountPercent = 0;
  formElement.reset();
  splitCards = [{ id: makeId("split"), cardNumber: "", pin: "", amount: 0, manual: false }];
  els.cardPaymentFields.classList.remove("hidden");
  els.cashPaymentFields.classList.add("hidden");
  document.querySelector("input[name='paymentMethod'][value='card']").checked = true;
  setCheckoutMessage(`Approved: ${money(total)} ${method === "cash" ? "cash" : "card"} purchase.`, "success");
  persistAndRender();
});

async function init() {
  state = await loadState();
  render();
}

init();
