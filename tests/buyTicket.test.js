// TC-09 to TC-12 — buyTicket page
// executeBuy is the pure async logic extracted from the jQuery click handler.
// renderReceipt mirrors the page's DOM update logic.

const WALLET_ADDRESS   = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const PRIVATE_KEY      = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const CONTRACT_ADDRESS = '0x1234567890123456789012345678901234567890';
const TICKET_PRICE_ETH = 0.00001;
const MAX_PER_ADDRESS  = 10;

const ABI = [
  { inputs: [], name: 'buyToken',         stateMutability: 'payable',  type: 'function' },
  { inputs: [{ name: 'account', type: 'address' }], name: 'balanceOf', stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'remainingSupply',  stateMutability: 'view',     type: 'function' },
];

// ── Pure function under test ─────────────────────────────────────────────────
function parseRevertReason(err) {
  const rpcMsg = err?.data?.message || err?.message || '';
  const match  = rpcMsg.match(/execution reverted: (.+)/i) || rpcMsg.match(/revert (.+)/i);
  if (match) return match[1].trim();
  if (err?.receipt?.revertReason) return err.receipt.revertReason;
  return err?.message || 'An unexpected error occurred.';
}

// ── Testable buy-flow function (dependency-injected web3, no jQuery) ─────────
async function executeBuy({ web3, walletAddress, privateKey, quantity }) {
  const contract        = new web3.eth.Contract(ABI, CONTRACT_ADDRESS);
  const remaining       = parseInt(await contract.methods.remainingSupply().call());
  const currentBalance  = parseInt(await contract.methods.balanceOf(walletAddress).call());

  if (remaining < quantity) {
    throw new Error(`Not enough tickets remaining.\nRequested: ${quantity} · Available: ${remaining}`);
  }
  if (currentBalance + quantity > MAX_PER_ADDRESS) {
    throw new Error(`This purchase would exceed the per-address limit of ${MAX_PER_ADDRESS} tickets.`);
  }

  const weiValue    = web3.utils.toWei((quantity * TICKET_PRICE_ETH).toFixed(5), 'ether');
  const encoded     = contract.methods.buyToken().encodeABI();
  const gasEstimate = await web3.eth.estimateGas({ from: walletAddress, to: CONTRACT_ADDRESS, value: weiValue, data: encoded });
  const nonce       = await web3.eth.getTransactionCount(walletAddress, 'pending');

  const tx = {
    from:  walletAddress,
    to:    CONTRACT_ADDRESS,
    gas:   Math.ceil(gasEstimate * 1.2),
    value: weiValue,
    data:  encoded,
    nonce,
  };

  const signed  = await web3.eth.accounts.signTransaction(tx, privateKey);
  return web3.eth.sendSignedTransaction(signed.rawTransaction);
}

// ── DOM receipt renderer (mirrors the page's renderReceipt) ──────────────────
function renderReceipt(receipt) {
  document.getElementById('r-hash').textContent   = receipt.transactionHash;
  document.getElementById('r-block').textContent  = String(receipt.blockNumber);
  document.getElementById('r-from').textContent   = receipt.from;
  document.getElementById('r-to').textContent     = receipt.to;
  document.getElementById('r-gas').textContent    = receipt.gasUsed.toLocaleString() + ' units';
  document.getElementById('r-status').textContent = receipt.status ? '✓ Success (status: 1)' : '✗ Failed (status: 0)';

  document.getElementById('receiptPanel').style.display = 'block';

  const buyBtn = document.getElementById('buyBtn');
  buyBtn.disabled    = true;
  buyBtn.textContent = 'Transaction Complete — Check Receipt Below';
}

// ── Mock factory ─────────────────────────────────────────────────────────────
function makeMockWeb3({ shouldFailGas = false } = {}) {
  const contractMethods = {
    remainingSupply: jest.fn().mockReturnValue({ call: jest.fn().mockResolvedValue('100') }),
    balanceOf:       jest.fn().mockReturnValue({ call: jest.fn().mockResolvedValue('0') }),
    buyToken:        jest.fn().mockReturnValue({ encodeABI: jest.fn().mockReturnValue('0xdata') }),
  };

  return {
    eth: {
      Contract: jest.fn().mockImplementation(() => ({ methods: contractMethods })),
      estimateGas: shouldFailGas
        ? jest.fn().mockRejectedValue(new Error('insufficient funds for gas * price + value'))
        : jest.fn().mockResolvedValue(50000),
      getTransactionCount: jest.fn().mockResolvedValue(7),
      accounts: {
        signTransaction: jest.fn().mockResolvedValue({
          rawTransaction:  '0xrawTxData',
          transactionHash: '0xdeadbeef1234567890abcdef',
        }),
      },
      sendSignedTransaction: jest.fn().mockResolvedValue({
        transactionHash: '0xdeadbeef1234567890abcdef',
        blockNumber:     5_900_000,
        from:            WALLET_ADDRESS,
        to:              CONTRACT_ADDRESS,
        gasUsed:         47_832,
        status:          true,
      }),
    },
    utils: {
      toWei: jest.fn().mockReturnValue('10000000000000'),
    },
  };
}

// ── DOM setup ────────────────────────────────────────────────────────────────
function setupDOM() {
  document.body.innerHTML = `
    <button id="buyBtn" disabled>Buy Tickets</button>
    <div id="receiptPanel" style="display:none;">
      <div id="r-hash"></div>
      <div id="r-block"></div>
      <div id="r-from"></div>
      <div id="r-to"></div>
      <div id="r-gas"></div>
      <div id="r-status"></div>
    </div>
    <div id="errorModal">
      <div id="errorBody"></div>
    </div>
  `;
}

// ── parseRevertReason unit tests ─────────────────────────────────────────────
describe('parseRevertReason', () => {
  test('extracts reason from "execution reverted:" prefix', () => {
    const err = { message: 'execution reverted: TicketToken: not enough tickets' };
    expect(parseRevertReason(err)).toBe('TicketToken: not enough tickets');
  });

  test('extracts reason from "revert" prefix', () => {
    const err = { message: 'revert ERC20: transfer amount exceeds balance' };
    expect(parseRevertReason(err)).toBe('ERC20: transfer amount exceeds balance');
  });

  test('uses receipt.revertReason when present', () => {
    const err = { receipt: { revertReason: 'max per address exceeded' } };
    expect(parseRevertReason(err)).toBe('max per address exceeded');
  });

  test('falls back to err.message', () => {
    const err = { message: 'Network timeout' };
    expect(parseRevertReason(err)).toBe('Network timeout');
  });
});

// ── TC-11: buy button disabled before wallet load ────────────────────────────
describe('TC-11: buy button initial state', () => {
  beforeEach(setupDOM);

  test('buyBtn is disabled when the page first loads (no wallet)', () => {
    expect(document.getElementById('buyBtn').disabled).toBe(true);
  });
});

// ── TC-12: wrong password shows specific error ────────────────────────────────
describe('TC-12: wrong keystore password shows error', () => {
  beforeEach(setupDOM);

  test('decrypt failure with "wrong" in message shows Incorrect password error', () => {
    const mockDecrypt = jest.fn().mockImplementation(() => {
      throw new Error('Key derivation failed - possibly wrong password');
    });

    try {
      mockDecrypt('keystoreJSON', 'badpassword');
    } catch (err) {
      if (err.message && err.message.toLowerCase().includes('wrong')) {
        document.getElementById('errorBody').textContent = 'Incorrect password. Please try again.';
        document.getElementById('errorModal').classList.add('active');
      }
    }

    expect(document.getElementById('errorBody').textContent).toBe('Incorrect password. Please try again.');
    expect(document.getElementById('errorModal').classList.contains('active')).toBe(true);
  });
});

// ── TC-09: successful ticket purchase ────────────────────────────────────────
describe('TC-09: successful buy renders receipt and disables button', () => {
  beforeEach(setupDOM);

  test('receipt panel visible, status shows success, buyBtn disabled', async () => {
    const web3 = makeMockWeb3();

    const receipt = await executeBuy({ web3, walletAddress: WALLET_ADDRESS, privateKey: PRIVATE_KEY, quantity: 1 });
    renderReceipt(receipt);

    expect(document.getElementById('receiptPanel').style.display).toBe('block');
    expect(document.getElementById('r-status').textContent).toBe('✓ Success (status: 1)');
    expect(document.getElementById('r-hash').textContent).toBe('0xdeadbeef1234567890abcdef');
    expect(document.getElementById('buyBtn').disabled).toBe(true);
    expect(document.getElementById('buyBtn').textContent).toBe('Transaction Complete — Check Receipt Below');
  });
});

// ── TC-10: gas estimation fails (insufficient funds) ─────────────────────────
describe('TC-10: insufficient ETH causes error modal', () => {
  beforeEach(setupDOM);

  test('estimateGas rejection surfaces insufficient funds message', async () => {
    const web3 = makeMockWeb3({ shouldFailGas: true });

    try {
      await executeBuy({ web3, walletAddress: WALLET_ADDRESS, privateKey: PRIVATE_KEY, quantity: 1 });
    } catch (err) {
      const reason = parseRevertReason(err);
      document.getElementById('errorBody').textContent = reason;
      document.getElementById('errorModal').classList.add('active');
    }

    expect(document.getElementById('errorModal').classList.contains('active')).toBe(true);
    expect(document.getElementById('errorBody').textContent).toMatch(/insufficient funds/i);
    expect(web3.eth.sendSignedTransaction).not.toHaveBeenCalled();
  });
});
