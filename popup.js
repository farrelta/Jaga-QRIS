const $ = (selector) => document.querySelector(selector);
const payloadInput = $("#payload");
const message = $("#message");
const result = $("#result");

const knownMerchants = [
  { name: "KOPI SENJA UGM", aliases: ["KOPI SENJA", "KOPI SENJA UGM"], city: "YOGYAKARTA" },
  { name: "TOKO MAKMUR", aliases: ["TOKO MAKMUR"], city: "YOGYAKARTA" }
];

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
    subtitle = cityMatch ? "The encoded merchant name matches a local demo record." : "The merchant name matched, but its saved city differs.";
    evidence.push(`QRIS merchant “${decoded.name}” matches local record “${exactMatch.name}”.`);
    if (exactMatch.city) evidence.push(`Encoded city: ${decoded.city || "not provided"}; saved city: ${exactMatch.city}.`);
  } else {
    evidence.push("This merchant is not present in the local demo records.");
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
    subtitle = "The page mentions a different merchant in the local demo records.";
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

$("#page-check").addEventListener("click", async () => {
  message.textContent = "";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active page is available.");
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async () => {
        const text = (document.body?.innerText || "").slice(0, 12000);
        const found = [];
        if (globalThis.BarcodeDetector) {
          try {
            const formats = await BarcodeDetector.getSupportedFormats();
            if (formats.includes("qr_code")) {
              const detector = new BarcodeDetector({ formats: ["qr_code"] });
              const images = [...document.images].filter((image) => {
                const rect = image.getBoundingClientRect();
                return rect.width > 48 && rect.height > 48 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
              }).slice(0, 30);
              for (const image of images) {
                try {
                  for (const code of await detector.detect(image)) found.push(code.rawValue);
                } catch { /* Ignore cross-origin or unsupported image formats. */ }
                if (found.length) break;
              }
            }
          } catch { /* Native QR scan is optional on this platform. */ }
        }
        return { title: document.title, text, payload: found[0] || "" };
      }
    });
    if (injection.result?.payload) payloadInput.value = injection.result.payload;
    if (!payloadInput.value.trim()) throw new Error("No QR image was decoded on this page. Paste QR text or choose a QR image, then scan again.");
    const decoded = decodePayload(payloadInput.value);
    render(decoded, analyze(decoded, injection.result?.text || ""));
    message.textContent = injection.result?.payload ? "QR image and page text checked locally." : `Page text checked${injection.result?.title ? `: ${injection.result.title}` : ""}.`;
  } catch (error) {
    message.textContent = error.message.includes("Cannot access") ? "This browser page does not allow extension access." : error.message;
  }
});

async function checkScannerSupport() {
  try {
    const formats = globalThis.BarcodeDetector ? await BarcodeDetector.getSupportedFormats() : [];
    if (formats.includes("qr_code")) $("#scan-support").textContent = "Image scan supported in this browser.";
    else $("#scan-support").textContent = "Image scan unavailable here; paste decoded QR text instead.";
  } catch {
    $("#scan-support").textContent = "Image scan unavailable here; paste decoded QR text instead.";
  }
}

$("#qr-image").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!globalThis.BarcodeDetector) {
    message.textContent = "QR image scanning is not supported by this browser. Paste decoded QR text to continue.";
    return;
  }
  try {
    const formats = await BarcodeDetector.getSupportedFormats();
    if (!formats.includes("qr_code")) throw new Error("QR image scanning is not supported by this browser.");
    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    const bitmap = await createImageBitmap(file);
    const codes = await detector.detect(bitmap);
    bitmap.close?.();
    if (!codes.length) throw new Error("No QR code found. Try a clearer image or paste the decoded text.");
    payloadInput.value = codes[0].rawValue;
    analyzeCurrent();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    event.target.value = "";
  }
});

checkScannerSupport();
