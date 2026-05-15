# TicketChain — Architectural Notes

These notes explain *why* the project is structured the way it is: the decisions that shaped each layer, how the pages fit together, and the reasoning behind choices that might otherwise look arbitrary in the source code.

---

## 1. Why no backend?

The entire application runs in the browser with no server, API, or database. This is intentional. The goal of a Web3 ticketing system is to eliminate the centralised intermediary — the traditional backend is replaced by the smart contract itself. Every state change (buying a ticket, returning one) is recorded on-chain and verifiable by anyone. A backend would re-introduce the same trust problem the blockchain was brought in to solve.

The trade-off is that the UX is slightly more involved: users must manage their own keystore file and password. That friction is deliberate — it reflects the real responsibility model of self-custody.

---

## 2. Page flow and how the four pages integrate

```
createWallet → buyTicket → [checkBalance]
                         ↘ sendToVendor
```

Each page is independent by design (no shared session, no cookies), but they are sequentially dependent:

- **createWallet** produces a keystore JSON file. Without it you cannot use buyTicket or sendToVendor.
- **buyTicket** decrypts that keystore, signs a `buyToken()` transaction, and broadcasts it. The private key is discarded from memory immediately after signing.
- **sendToVendor** follows the same decryption pattern but calls `transfer()` instead, sending exactly 1 TKT back to the contract.
- **checkBalance** is stateless and read-only — it needs no keystore. It exists as a utility for attendees, door staff, and the venue independently of the purchase flow.

The landing page (`index.html`) makes this flow visible at a glance. It exists to remove the ambiguity of "which file do I open first?" — a real usability concern when the project is handed to someone unfamiliar with it.

---

## 3. Keystore encryption: why scrypt and why V3 format

`web3.eth.accounts.encrypt()` uses the Ethereum V3 keystore format with scrypt key derivation. This was chosen over simpler encryption for three reasons:

1. **Portability.** The V3 format is the same standard used by geth, MetaMask's export function, and most Ethereum tooling. A keystore produced here can be imported elsewhere without conversion.
2. **Resistance to brute-force.** Scrypt is deliberately slow and memory-hard, which makes offline dictionary attacks expensive even for weak passwords.
3. **No custom crypto.** Delegating to `web3.eth.accounts.encrypt()` means we rely on audited, well-tested library code rather than rolling our own AES setup.

The private key is held in a module-level JavaScript variable only for the duration of the signing step. It is never written to any DOM node (except behind an explicit user-triggered reveal toggle), and it is set to `null` immediately after the transaction is signed.

---

## 4. Why Web3.js via CDN rather than a bundler

The project ships no build step — no Webpack, Vite, or Rollup. Web3.js is loaded from a CDN `<script>` tag. This choice keeps the barrier to entry minimal: any student or reviewer can open the HTML file in a browser and it works. A bundler would require Node.js, npm install, and a build command before anything runs.

The downside is that CDN-loaded Web3.js is a large library (>1 MB) and the version is loosely pinned. For a production system this would be replaced with a proper build pipeline and a locked dependency. For a Sepolia testnet demo, the simplicity outweighs the risk.

---

## 5. Why checkBalance uses raw JSON-RPC instead of Web3.js

The balance check page makes two types of call: `eth_getBalance` and `eth_call`. Both are read-only. Implementing them as direct `fetch` POST requests to the RPC endpoint is roughly 15 lines of code and avoids loading the 1+ MB Web3.js bundle entirely on a page that never signs anything.

The choice also makes the RPC wire format explicit and educational — the data encoding (`0x70a08231` for `balanceOf`, the 32-byte left-padded address argument) is visible and documented in the source. Using Web3.js would hide that detail inside the library.

The other three pages do load Web3.js because they need `eth.accounts.create()`, `eth.accounts.encrypt()`, and `eth.accounts.signTransaction()` — capabilities that are not trivially replicated with raw fetch calls.

---

## 6. The CSS design system and why it is unified

All four pages share the same set of CSS custom properties (`--bg`, `--surface`, `--accent`, `--muted`, etc.) with identical values. This was done to create a single visual identity across what would otherwise look like four unrelated tools.

The unified variables live in each page's own `styles.css` (not a shared file) because the pages are intended to be self-contained — no relative path dependencies that break if a folder is moved. The cost is a small amount of duplication in the `:root` block; the benefit is that each page works independently.

**Space Mono** was chosen for all code-adjacent content (addresses, token values, labels) because its fixed-width nature makes alphanumeric strings easier to scan and compare — which matters when users are reading wallet addresses. **DM Sans** handles prose and UI copy where readability at small sizes is more important than alignment.

---

## 7. The test architecture: why this structure

### Why Jest + jsdom

The application has no build step, so the test suite also avoids one. Jest with `jest-environment-jsdom` provides a browser-like DOM environment that can run under Node.js without opening a real browser. This makes the tests fast and CI-compatible.

### Why pure functions are re-declared inline in each test file

The HTML pages do not export modules — their functions live in inline `<script>` tags. Rather than refactoring the source files to use ES modules (which would require a bundler or a server for ES module imports), the test files re-declare the pure functions they need. This keeps the source HTML unchanged and the tests self-contained.

The trade-off is that if a pure function's logic changes in the HTML, the corresponding test re-declaration must be updated manually. For a small project with stable utility functions (`scorePassword`, `isValidAddress`, `weiToEth`, etc.), this is acceptable.

### Why the async handlers use dependency injection

`buyTicket` and `sendToVendor` use jQuery for all DOM updates. Mocking jQuery in a jsdom environment is possible but messy. Instead, the test files extract the core async logic into functions that accept `web3` and `contract` as parameters:

```js
async function executeBuy({ web3, walletAddress, privateKey, quantity }) { ... }
async function executeTransfer({ contract, web3, walletAddress, privateKey }) { ... }
```

These functions contain the pre-flight checks, transaction construction, and signing logic — everything that can fail in meaningful ways. The DOM rendering (receipt display, button state) is tested separately, against the output those functions return. This separation means the critical on-chain logic is fully testable without jQuery, and the DOM rendering tests remain simple and declarative.

### Why `makeMockWeb3` and sequential `mockResolvedValueOnce`

Web3 calls chain through several layers: `Contract → methods → call()`. The mock factory `makeMockWeb3()` pre-wires all of these so individual tests stay readable. The `shouldFailGas` flag lets a single factory cover both the success path (TC-09) and the insufficient-funds failure path (TC-10) without duplicating setup code.

Sequential `mockResolvedValueOnce` calls (used in the vendor transfer tests) model a contract whose `balanceOf` returns different values before and after the transaction — the same real-world behaviour where balance state changes between calls.

---

## 8. Security considerations and known limitations

- **Private keys in JavaScript memory.** There is no way to fully prevent a malicious browser extension from reading memory. The mitigation here is to minimise how long the key exists: it is decrypted from the keystore, used once for signing, and immediately set to `null`. The keystore file itself is never written to any server.

- **No signature replay protection beyond nonces.** The explicit `pending` nonce fetch prevents double-submission within a session, but the application relies on the network's standard nonce-based replay protection for cross-session safety.

- **Contract address is hardcoded.** `CONTRACT_ADDRESS` in `buyTicket` and `sendToVendor` must be updated after each deployment. This is by design for a testnet demo — a production system would resolve the address from an on-chain registry or environment configuration.

- **The `checkBalance` page reads a public RPC endpoint.** `rpc-sepolia.rockx.com` is a third-party free endpoint. Rate limits or downtime on that endpoint will cause balance queries to fail. The error is surfaced to the user via the modal, but there is no automatic retry or fallback RPC.
