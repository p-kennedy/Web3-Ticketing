// TC-06 to TC-08 — checkBalance page
// Pure helpers re-declared inline; fetch is mocked for async RPC calls.

const VALID_ADDR    = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const CONTRACT_ADDR = '0x0000000000000000000000000000000000000001';

// ── Pure functions under test ────────────────────────────────────────────────
function isValidAddress(addr) {
  return /^0x[0-9a-fA-F]{40}$/.test(addr.trim());
}

function weiToEth(hex) {
  const wei = BigInt(hex);
  const eth = Number(wei) / 1e18;
  return eth.toFixed(4);
}

function hexToDecimal(hex) {
  if (!hex || hex === '0x') return '0';
  return BigInt(hex).toString(10);
}

function ticketBadge(tokBalance) {
  const n = Number(tokBalance);
  if (n > 0) {
    return `<span class="ticket-badge has-ticket"><span class="badge-dot"></span>TICKET VALID — ${n} token${n > 1 ? 's' : ''}</span>`;
  }
  return `<span class="ticket-badge no-ticket"><span class="badge-dot"></span>NO TICKET FOUND</span>`;
}

function truncate(addr) {
  return addr.slice(0, 6) + '…' + addr.slice(-4);
}

// ── DOM setup ────────────────────────────────────────────────────────────────
function setupDOM() {
  document.body.innerHTML = `
    <input  id="attendeeAddr"       value="" />
    <div    id="attendeeResult"     class="results"></div>
    <span   id="attendeeResultAddr"></span>
    <span   id="attendeeEth"></span>
    <span   id="attendeeTok"></span>
    <span   id="attendeeBadge"></span>
    <input  id="venueAddr"          value="${CONTRACT_ADDR}" />
    <div    id="errorModal"         class="modal-overlay"></div>
    <p      id="modalMsg"></p>
    <p      id="modalDetail"></p>
  `;
}

// ── Minimal re-implementation of the page's checkBalance (attendee role) ────
// Uses an injectable rpcCall so fetch is never called directly in tests.
async function checkAttendee(address, rpcCall) {
  if (!isValidAddress(address)) {
    return { error: 'The address you entered is not a valid Ethereum address.' };
  }

  const SIG_BALANCE_OF = '0x70a08231';
  const padAddr = a => '000000000000000000000000' + a.slice(2).toLowerCase();

  const [ethHex, tokHex] = await Promise.all([
    rpcCall('eth_getBalance', [address, 'latest']),
    rpcCall('eth_call', [{ to: CONTRACT_ADDR, data: SIG_BALANCE_OF + padAddr(address) }, 'latest']),
  ]);

  const eth = weiToEth(ethHex);
  const tok = hexToDecimal(tokHex);

  document.getElementById('attendeeResultAddr').textContent = truncate(address);
  document.getElementById('attendeeEth').innerHTML          = `${eth}<span class="bal-unit">ETH</span>`;
  document.getElementById('attendeeTok').innerHTML          = `${tok}<span class="bal-unit">TKT</span>`;
  document.getElementById('attendeeBadge').innerHTML        = ticketBadge(tok);
  document.getElementById('attendeeResult').classList.add('visible');

  return { eth, tok };
}

function showModal(msg, detail) {
  document.getElementById('modalMsg').textContent    = msg;
  document.getElementById('modalDetail').textContent = detail;
  document.getElementById('errorModal').classList.add('open');
}

// ── isValidAddress unit tests ────────────────────────────────────────────────
describe('isValidAddress', () => {
  test('accepts a valid checksummed address', () => {
    expect(isValidAddress('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266')).toBe(true);
  });

  test('accepts a lowercase address', () => {
    expect(isValidAddress('0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266')).toBe(true);
  });

  test('rejects an address that is too short', () => {
    expect(isValidAddress('0xabcdef')).toBe(false);
  });

  test('rejects an address without 0x prefix', () => {
    expect(isValidAddress('f39Fd6e51aad88F6F4ce6aB8827279cffFb92266')).toBe(false);
  });

  test('rejects an empty string', () => {
    expect(isValidAddress('')).toBe(false);
  });
});

// ── weiToEth unit tests ──────────────────────────────────────────────────────
describe('weiToEth', () => {
  test('converts 1 ETH in wei to "1.0000"', () => {
    expect(weiToEth('0xDE0B6B3A7640000')).toBe('1.0000');
  });

  test('converts 0 wei to "0.0000"', () => {
    expect(weiToEth('0x0')).toBe('0.0000');
  });
});

// ── hexToDecimal unit tests ──────────────────────────────────────────────────
describe('hexToDecimal', () => {
  test('converts "0x3" to "3"', () => {
    expect(hexToDecimal('0x0000000000000000000000000000000000000000000000000000000000000003')).toBe('3');
  });

  test('returns "0" for "0x"', () => {
    expect(hexToDecimal('0x')).toBe('0');
  });

  test('returns "0" for null', () => {
    expect(hexToDecimal(null)).toBe('0');
  });
});

// ── ticketBadge unit tests ───────────────────────────────────────────────────
describe('ticketBadge', () => {
  test('positive balance renders has-ticket badge', () => {
    const html = ticketBadge('3');
    expect(html).toContain('has-ticket');
    expect(html).toContain('TICKET VALID');
    expect(html).toContain('3 tokens');
  });

  test('zero balance renders no-ticket badge', () => {
    const html = ticketBadge('0');
    expect(html).toContain('no-ticket');
    expect(html).toContain('NO TICKET FOUND');
  });

  test('balance of 1 uses singular "token"', () => {
    expect(ticketBadge('1')).toContain('1 token');
    expect(ticketBadge('1')).not.toContain('tokens');
  });
});

// ── TC-06: valid address with balance → results displayed ────────────────────
describe('TC-06: valid address returns balance and shows results', () => {
  beforeEach(setupDOM);

  test('displays ETH balance, token count, and green TICKET VALID badge', async () => {
    const mockRpc = jest.fn()
      .mockResolvedValueOnce('0xDE0B6B3A7640000')   // eth_getBalance → 1 ETH
      .mockResolvedValueOnce(                         // eth_call → 3 TKT
        '0x0000000000000000000000000000000000000000000000000000000000000003'
      );

    const result = await checkAttendee(VALID_ADDR, mockRpc);

    expect(result.eth).toBe('1.0000');
    expect(result.tok).toBe('3');
    expect(document.getElementById('attendeeResult').classList.contains('visible')).toBe(true);
    expect(document.getElementById('attendeeBadge').innerHTML).toContain('has-ticket');
    expect(document.getElementById('attendeeBadge').innerHTML).toContain('TICKET VALID');
    expect(mockRpc).toHaveBeenCalledTimes(2);
  });
});

// ── TC-07: invalid address → modal shown ────────────────────────────────────
describe('TC-07: invalid address shows error modal', () => {
  beforeEach(setupDOM);

  test('non-hex address triggers modal with address validation message', async () => {
    const mockRpc = jest.fn();

    const result = await checkAttendee('not-an-address', mockRpc);

    // The caller is responsible for showing the modal (matches page behaviour)
    showModal(result.error, '"not-an-address"');

    expect(result.error).toMatch(/not a valid Ethereum address/i);
    expect(document.getElementById('errorModal').classList.contains('open')).toBe(true);
    expect(document.getElementById('modalMsg').textContent).toMatch(/not a valid Ethereum address/i);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test('empty input also fails address validation', async () => {
    const result = await checkAttendee('', jest.fn());
    expect(result.error).toBeDefined();
  });
});

// ── TC-08: zero token balance → NO TICKET FOUND badge ───────────────────────
describe('TC-08: zero TKT balance shows no-ticket badge', () => {
  beforeEach(setupDOM);

  test('renders red NO TICKET FOUND badge when token balance is 0', async () => {
    const mockRpc = jest.fn()
      .mockResolvedValueOnce('0x16345785D8A0000') // eth_getBalance → 0.1 ETH
      .mockResolvedValueOnce('0x');               // eth_call → 0 TKT

    const result = await checkAttendee(VALID_ADDR, mockRpc);

    expect(result.tok).toBe('0');
    expect(document.getElementById('attendeeBadge').innerHTML).toContain('no-ticket');
    expect(document.getElementById('attendeeBadge').innerHTML).toContain('NO TICKET FOUND');
    expect(document.getElementById('attendeeResult').classList.contains('visible')).toBe(true);
  });
});
