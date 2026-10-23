const $ = (selector) => document.querySelector(selector);
const payloadInput = $("#payload");
const message = $("#message");
const result = $("#result");

function activateTab(name) {
  for (const tab of document.querySelectorAll("[role=tab]")) {
    const active = tab.dataset.tab === name;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  }
  $("#scan-panel").hidden = name !== "scan";
  $("#merchants-panel").hidden = name !== "merchants";
}

document.querySelectorAll("[role=tab]").forEach((tab, index, tabs) => {
  tab.addEventListener("click", () => activateTab(tab.dataset.tab));
  tab.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = tabs[(index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    activateTab(next.dataset.tab);
    next.focus();
  });
});

const demoMerchants = [
  { name: "KOPI SENJA UGM", aliases: ["KOPI SENJA", "KOPI SENJA UGM"], city: "YOGYAKARTA", demo: true },
  { name: "TOKO MAKMUR", aliases: ["TOKO MAKMUR"], city: "YOGYAKARTA", demo: true }
];
const merchantStorageKey = "jagaQrisSavedMerchants";
let savedMerchants = loadSavedMerchants();
let knownMerchants = [...demoMerchants, ...savedMerchants];

function loadSavedMerchants() {
  try {
    const records = JSON.parse(localStorage.getItem(merchantStorageKey) || "[]");
    return Array.isArray(records) ? records.filter((record) => record && typeof record.name === "string" && Array.isArray(record.aliases)) : [];
  } catch { return []; }
}

function saveMerchants() {
  localStorage.setItem(merchantStorageKey, JSON.stringify(savedMerchants));
  knownMerchants = [...demoMerchants, ...savedMerchants];
  renderMerchantList();
}

function renderMerchantList() {
  const list = $("#merchant-list");
  $("#merchant-count").textContent = `${savedMerchants.length} saved`;
  const records = [...savedMerchants.map((merchant, index) => ({ ...merchant, index, removable: true })), ...demoMerchants.map((merchant) => ({ ...merchant, removable: false }))];
  list.innerHTML = records.map((merchant) => `<li class="merchant-entry"><div><strong>${escapeHtml(merchant.name)}</strong><small>${escapeHtml(merchant.city || "City not set")} · ${merchant.removable ? "Your record" : "Demo record"}${merchant.source ? ` · ${escapeHtml(merchant.source)}` : ""}</small></div>${merchant.removable ? `<button class="remove-merchant" type="button" data-remove="${merchant.index}" aria-label="Remove ${escapeHtml(merchant.name)}">Remove</button>` : ""}</li>`).join("");
}

function normalize(value = "") {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function readTlvs(data) {
  const items = [];
  let pos = 0;
  while (pos < data.length) {
    if (pos + 4 > data.length || !/^\d{4}$/.test(data.slice(pos, pos + 4))) throw new Error(`Invalid field header at character ${pos + 1}.`);
    const tag = data.slice(pos, pos + 2);
    const lengthText = data.slice(pos + 2, pos + 4);
    const length = Number(lengthText);
    const valueStart = pos + 4;
    const value = data.slice(valueStart, valueStart + length);
    if (value.length !== length) throw new Error(`Field ${tag} declares ${length} characters but is incomplete.`);
    items.push({ tag, length, value });
    pos = valueStart + length;
  }
  return items;
}

function crc16CcittFalse(text) {
  let crc = 0xffff;
  for (let i = 0; i < text.length; i += 1) {
    crc ^= text.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
    crc &= 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function decodePayload(raw) {
  // Spaces inside merchant names are meaningful TLV data; remove only transport line breaks.
  const payload = raw.trim().replace(/[\r\n\t]/g, "");
  if (!payload) throw new Error("Paste QR data or load the demo payload first.");
  const fields = readTlvs(payload);
  const byTag = new Map(fields.map((field) => [field.tag, field]));
  const required = ["00", "01", "52", "53", "58", "59", "60", "63"];
  const missing = required.filter((tag) => !byTag.has(tag));
  const merchant = fields.find((field) => Number(field.tag) >= 26 && Number(field.tag) <= 51);
  let crcValid = false;
  let expectedCrc = "";
  const crcField = byTag.get("63");
  if (crcField && crcField.length === 4 && payload.endsWith("6304" + crcField.value)) {
    expectedCrc = crc16CcittFalse(payload.slice(0, -4));
    crcValid = expectedCrc === crcField.value.toUpperCase();
  }
  return {
    payload,
    fields: byTag,
    missing,
    crcValid,
    expectedCrc,
    formatValid: missing.length === 0 && byTag.get("00")?.value === "01" && byTag.get("53")?.value === "360",
    merchantAccount: merchant ? readTlvs(merchant.value) : [],
    name: byTag.get("59")?.value || "",
    city: byTag.get("60")?.value || "",
    amount: byTag.get("54")?.value || "",
    country: byTag.get("58")?.value || "",
    currency: byTag.get("53")?.value || "",
    initiation: byTag.get("01")?.value === "12" ? "Dynamic" : byTag.get("01")?.value === "11" ? "Static" : "Unknown"
  };
}

function makeDemoPayload(name = "KOPI SENJA UGM", city = "YOGYAKARTA") {
  const field = (tag, value) => tag + String(value.length).padStart(2, "0") + value;
  const merchantAccount = field("00", "A000000677010111") + field("01", "123456789012345");
  let data = field("00", "01") + field("01", "11") + field("26", merchantAccount) + field("52", "5812") + field("53", "360") + field("58", "ID") + field("59", name) + field("60", city) + "6304";
  return data + crc16CcittFalse(data);
}

function formatMoney(value, currency) {
  if (!value) return "Not encoded";
  return `${value} ${currency === "360" ? "IDR" : currency || ""}`.trim();
}

function analyze(decoded, pageText = "") {
  const evidence = [];
  const exactMatch = knownMerchants.find((merchant) => merchant.aliases.some((alias) => normalize(alias) === normalize(decoded.name)));
  const pageMerchant = pageText ? knownMerchants.find((merchant) => normalize(merchant.name) !== normalize(decoded.name) && merchant.aliases.some((alias) => normalize(pageText).includes(normalize(alias)))) : null;
  let status = "unknown";
  let title = "Needs a closer look";
  let subtitle = "We could not verify this merchant from the available evidence.";

  if (!decoded.formatValid || !decoded.crcValid) {
    status = "invalid";
    title = "Payload check failed";
    subtitle = !decoded.formatValid ? "Some expected QR payment fields are missing or invalid." : "The QR payload checksum does not match.";
    if (!decoded.formatValid) evidence.push(decoded.missing.length ? `Missing fields: ${decoded.missing.join(", ")}.` : "The payload does not contain the expected QR payment markers.");
    if (!decoded.crcValid) evidence.push(`Checksum mismatch. Expected ${decoded.expectedCrc || "a four-character CRC"}; found ${decoded.fields.get("63")?.value || "none"}.`);
  } else if (exactMatch) {
    const cityMatch = !exactMatch.city || normalize(exactMatch.city) === normalize(decoded.city);
    status = cityMatch ? "match" : "review";
    title = cityMatch ? "Matches a saved merchant" : "Merchant city differs";
    subtitle = cityMatch ? (exactMatch.demo ? "The encoded merchant name matches a local demo record." : "The encoded merchant name matches a merchant you saved.") : "The merchant name matched, but its saved city differs.";
    evidence.push(`QRIS merchant “${decoded.name}” matches local record “${exactMatch.name}”.`);
    if (exactMatch.city) evidence.push(`Encoded city: ${decoded.city || "not provided"}; saved city: ${exactMatch.city}.`);
    if (exactMatch.source) evidence.push(`Your verification note: ${exactMatch.source}.`);
  } else {
    evidence.push("This merchant is not present in your saved or demo records.");
  }

  if (pageText && decoded.name) {
    const page = normalize(pageText);
    const name = normalize(decoded.name);
    if (page.includes(name)) evidence.push("The exact QRIS merchant name also appears in the current page text.");
    else evidence.push("The exact QRIS merchant name was not found in the current page text. This alone does not establish a mismatch.");
  }

  if (pageMerchant && decoded.formatValid && decoded.crcValid) {
    status = "review";
    title = "Possible merchant mismatch";
    subtitle = "The page mentions a different merchant in your saved or demo records.";
    evidence.unshift(`Page text mentions “${pageMerchant.name}”, while the QRIS encodes “${decoded.name}”.`);
    evidence.push("This is a possible discrepancy only; confirm the recipient with the business and your payment app.");
  }

  if (status === "unknown" && evidence.some((entry) => entry.startsWith("The exact QRIS"))) {
    subtitle = "The QR is structurally valid, but we have no trusted merchant record to compare it with.";
  }
  return { status, title, subtitle, evidence };
}

function render(decoded, verdict) {
  const rows = [
    ["Merchant", decoded.name || "Not encoded"],
    ["City", decoded.city || "Not encoded"],
    ["Payment type", decoded.initiation],
    ["Amount", formatMoney(decoded.amount, decoded.currency)],
    ["Country", decoded.country || "Not encoded"],
    ["CRC checksum", decoded.crcValid ? "Valid" : "Invalid"]
  ];
  result.innerHTML = `<div class="result-top ${verdict.status}"><span class="status-icon">${verdict.status === "match" ? "✓" : verdict.status === "invalid" ? "!" : "?"}</span><div><strong>${escapeHtml(verdict.title)}</strong><small>${escapeHtml(verdict.subtitle)}</small></div></div><div class="details">${rows.map(([key, value]) => `<div class="detail"><span>${escapeHtml(key)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}<h3 class="evidence-title">Evidence</h3><ul class="evidence">${verdict.evidence.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ul></div>`;
  result.hidden = false;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function analyzeCurrent(pageText = "") {
  message.textContent = "";
  try {
    const decoded = decodePayload(payloadInput.value);
    render(decoded, analyze(decoded, pageText));
  } catch (error) {
    result.hidden = true;
    message.textContent = error.message;
  }
}

$("#analyze").addEventListener("click", () => analyzeCurrent());
$("#sample").addEventListener("click", () => {
  payloadInput.value = makeDemoPayload();
  analyzeCurrent();
});

$("#merchant-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const name = String(form.get("name") || "").trim();
  const city = String(form.get("city") || "").trim();
  const aliases = String(form.get("aliases") || "").split(",").map((alias) => alias.trim()).filter(Boolean);
  const source = String(form.get("source") || "").trim();
  const allNames = [...demoMerchants, ...savedMerchants].flatMap((merchant) => [merchant.name, ...merchant.aliases]).map(normalize);
  if (!name) return;
  if ([name, ...aliases].some((candidate) => allNames.includes(normalize(candidate)))) {
    $("#merchant-message").textContent = "That name or alias is already in the local merchant records.";
    return;
  }
  savedMerchants.push({ name, aliases: [name, ...aliases], city, source });
  saveMerchants();
  event.currentTarget.reset();
  $("#merchant-message").textContent = "Merchant saved in this browser.";
});

$("#merchant-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove]");
  if (!button) return;
  savedMerchants.splice(Number(button.dataset.remove), 1);
  saveMerchants();
  $("#merchant-message").textContent = "Saved merchant removed.";
});

$("#page-check").addEventListener("click", async () => {
  message.textContent = "";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active page is available.");
    const screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    let scannedPayload = "";
    try {
      const code = await QrScanner.scanImage(screenshot, { returnDetailedScanResult: true });
      scannedPayload = code?.data || "";
    } catch { /* It is valid for a page to have no QR code in view. */ }
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({ title: document.title, text: (document.body?.innerText || "").slice(0, 12000) })
    });
    if (scannedPayload) payloadInput.value = scannedPayload;
    if (!payloadInput.value.trim()) throw new Error("No QR code found in the visible area. Scroll the QR into view, or paste its decoded text.");
    const decoded = decodePayload(payloadInput.value);
    render(decoded, analyze(decoded, injection.result?.text || ""));
    message.textContent = scannedPayload ? "Visible page area and page text checked locally." : `Page text checked${injection.result?.title ? `: ${injection.result.title}` : ""}.`;
  } catch (error) {
    message.textContent = error.message.includes("Cannot access") ? "This browser page does not allow extension access." : error.message;
  }
});

function checkScannerSupport() {
  $("#scan-support").textContent = typeof QrScanner?.scanImage === "function" ? "Offline QR image scan ready." : "QR image scan unavailable; paste decoded QR text instead.";
}

$("#qr-image").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const code = await QrScanner.scanImage(file, { returnDetailedScanResult: true });
    payloadInput.value = code.data;
    analyzeCurrent();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    event.target.value = "";
  }
});

checkScannerSupport();
renderMerchantList();
