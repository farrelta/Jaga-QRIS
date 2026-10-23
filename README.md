# Jaga QRIS prototype

A local-first Chrome extension for inspecting QRIS payment payloads and comparing the encoded merchant name with text on the current page.

## Load it in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select this project folder.
4. Open the Jaga QRIS extension from the toolbar.
5. Use **Scan QRIS** to inspect a code, or **Saved merchants** to add and manage local merchant records.
6. Choose **Load demo** to see a valid example and its parsed fields.

To check a page, open it, scroll the QR code into view, then click **Scan page**. The extension captures the visible tab, scans that screenshot locally, and reads page text only after the click. You can also choose a QR image file or paste decoded QR text.

## What is included

- Local EMV-style TLV field parsing and CRC-16/CCITT-FALSE checksum verification.
- Merchant, city, country, currency, amount, and static/dynamic indicator display.
- Demo merchant records and user-managed merchant names, aliases, cities, and verification notes saved in this browser.
- Source-labeled page details from headings, Open Graph tags, business JSON-LD, and text near the QR's on-screen position.
- Cautious page comparison with evidence and uncertainty labels; page details are treated as claims, not verified identity.
- A compact, dependency-free local character n-gram text matcher that compares the QRIS merchant name with page titles, business details, QR-adjacent text, and saved merchant names. It shows an experimental 0–100 match evidence score and the strongest comparison source; an NMID repeated in both the page and QR payload adds corroborating evidence. No QR or page text is sent to a server.
- Local QR image decoding through the bundled `qr-scanner` library and worker.

## Limits

Demo merchant records are examples, not a verified directory. User-saved records are only as trustworthy as the information entered. The current local matcher is a compact text-similarity model, not a pretrained neural network. Its 0–100 score reflects name similarity and evidence source; a zero means no supporting match was found, not a measured probability of fraud. The score is not calibrated and does not prove identity. A valid checksum confirms payload integrity, not recipient identity. Page scanning covers the visible viewport only, so scroll the QR into view first. The prototype has no backend, external requests, payment integration, or automated reporting. Always confirm the displayed recipient in your payment app before paying.

## Third-party software

The extension bundles `qr-scanner` version 1.4.2 under the MIT License. Its UMD build loads the adjacent worker using the package's current setup; Jaga QRIS does not set a worker path. See [LICENSE-qr-scanner.txt](LICENSE-qr-scanner.txt).
