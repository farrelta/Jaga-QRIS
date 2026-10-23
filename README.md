# QRIS Guard prototype

A local-first Chrome extension prototype for inspecting QRIS payment payloads and comparing the encoded merchant name with text on the page you choose to check.

## Load it in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select this project folder.
4. Open the QRIS Guard extension from the toolbar.
5. Choose **Load demo** to see a valid example and its parsed fields.

To check a page, open it and click **Scan page** in the extension. It reads visible text and tries to decode visible QR images after that click. You can also choose a QR image file. Image decoding depends on the browser and operating system exposing the native QR detector. If it is unavailable, paste the decoded QR text instead.

## What is included

- Local EMV-style TLV field parsing for QR payment data.
- Required-field checks and CRC-16/CCITT-FALSE checksum verification.
- Merchant, city, country, currency, amount, and static/dynamic indicator display.
- A small fixture of demo merchant names and aliases.
- A cautious page comparison: a different known demo merchant on the page raises a possible mismatch; missing page text is not treated as proof of fraud.
- Optional local QR image decoding through the browser's `BarcodeDetector` API.

## Limits

The merchant records are examples, not a verified directory. A valid checksum confirms payload integrity, not the identity of the recipient. The browser's built-in image decoder is not available on every platform; this prototype does not bundle a fallback decoder yet. It has no backend, external requests, AI model, payment integration, or automated reporting. Always confirm the displayed recipient in your payment app before paying.
