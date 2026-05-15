// TC-13 to TC-14 — vendorTransfer page
// executeTransfer is the pure async logic extracted from the jQuery click handler.

const WALLET_ADDRESS   = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const PRIVATE_KEY      = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const CONTRACT_ADDRESS = '0x1234567890123456789012345678901234567890';

// ── Testable transfer-flow function (dependency-injected, no jQuery) ──────────
async function executeTransfer({ contract, web3, walletAddress, privateKey }) {
  const senderBalance = parseInt(await contract.methods.balanceOf(walletAddress).call());

  if (senderBalance < 1) {
    throw new Error(
      'Your wallet holds 0 TKT. There is no ticket to return.\n' +
      `Address checked: ${walletAddress}`
    );
  }

  const encoded     = contract.methods.transfer(CONTRACT_ADDRESS, 1).encodeABI();
  const nonce       = await web3.eth.getTransactionCount(walletAddress, 'pending');
  const gasEstimate = await web3.eth.estimateGas({ from: walletAddress, to: CONTRACT_ADDRESS, data: encoded });

  const tx = {
    from:  walletAddress,
    to:    CONTRACT_ADDRESS,
    gas:   Math.ceil(gasEstimate * 1.2),
    nonce,
    data:  encoded,
  };

  const signed  = await web3.eth.accounts.signTransaction(tx, privateKey);
  const receipt = await web3.eth.sendSignedTransaction(signed.rawTransaction);

  // Re-query both balances after confirmation (mirrors the page's Promise.all)
  const [newSenderBalance, newContractBalance] = await Promise.all([
    contract.methods.balanceOf(walletAddress).call(),
    contract.methods.balanceOf(CONTRACT_ADDRESS).call(),
  ]);

  return { receipt, newSenderBalance, newContractBalance };
}

// ── DOM balance/receipt renderer (mirrors renderPostTransactionState) ─────────
function renderPostTransfer(receipt, newSenderBalance, newContractBalance) {
  document.getElementById('senderBalance').textContent  = newSenderBalance;
  document.getElementById('contractBalance').textContent = newContractBalance;
  document.getElementById('r-status').textContent       = receipt.status ? '✓ Success (status: 1)' : '✗ Failed (status: 0)';
  document.getElementById('balancePanel').style.display = 'block';

  const btn      = document.getElementById('transferBtn');
  btn.textContent = 'Transfer Complete';
  btn.disabled    = true;
}

// ── DOM setup ────────────────────────────────────────────────────────────────
function setupDOM() {
  document.body.innerHTML = `
    <button id="transferBtn" disabled>Sign &amp; Send Transfer</button>
    <div id="balancePanel" style="display:none;">
      <div id="senderBalance">—</div>
      <div id="contractBalance">—</div>
      <div id="r-status"></div>
    </div>
    <div id="errorModal">
      <div id="errorBody"></div>
    </div>
  `;
}

// ── Mock factories ────────────────────────────────────────────────────────────
function makeSuccessReceipt() {
  return {
    transactionHash: '0xabc123',
    blockNumber:     5_900_001,
    from:            WALLET_ADDRESS,
    to:              CONTRACT_ADDRESS,
    gasUsed:         52_000,
    status:          true,
  };
}

function makeMockContractWithBalances(balances) {
  // balances is consumed in order across all .call() invocations
  let idx = 0;
  const callFn = jest.fn().mockImplementation(() => Promise.resolve(balances[idx++]));
  return {
    methods: {
      balanceOf: jest.fn().mockReturnValue({ call: callFn }),
      transfer:  jest.fn().mockReturnValue({ encodeABI: jest.fn().mockReturnValue('0xtransferdata') }),
    },
    _callFn: callFn,
  };
}

function makeMockWeb3() {
  return {
    eth: {
      getTransactionCount: jest.fn().mockResolvedValue(3),
      estimateGas:         jest.fn().mockResolvedValue(45_000),
      accounts: {
        signTransaction: jest.fn().mockResolvedValue({
          rawTransaction:  '0xrawTx',
          transactionHash: '0xabc123',
        }),
      },
      sendSignedTransaction: jest.fn().mockResolvedValue(makeSuccessReceipt()),
    },
  };
}

// ── TC-13: sufficient tokens → transfer succeeds ──────────────────────────────
describe('TC-13: sender holds ≥1 TKT — transfer completes', () => {
  beforeEach(setupDOM);

  test('balance panel visible, sender balance decremented, contract balance incremented, button locked', async () => {
    // Sequential call() responses:
    //   1st  → pre-flight sender balance  = '1'
    //   2nd  → post-tx sender balance     = '0'
    //   3rd  → post-tx contract balance   = '2'
    const contract = makeMockContractWithBalances(['1', '0', '2']);
    const web3     = makeMockWeb3();

    const { receipt, newSenderBalance, newContractBalance } = await executeTransfer({
      contract, web3, walletAddress: WALLET_ADDRESS, privateKey: PRIVATE_KEY,
    });

    renderPostTransfer(receipt, newSenderBalance, newContractBalance);

    expect(document.getElementById('balancePanel').style.display).toBe('block');
    expect(document.getElementById('senderBalance').textContent).toBe('0');
    expect(document.getElementById('contractBalance').textContent).toBe('2');
    expect(document.getElementById('r-status').textContent).toBe('✓ Success (status: 1)');
    expect(document.getElementById('transferBtn').textContent).toBe('Transfer Complete');
    expect(document.getElementById('transferBtn').disabled).toBe(true);
    expect(web3.eth.sendSignedTransaction).toHaveBeenCalledTimes(1);
  });
});

// ── TC-14: zero tokens → pre-flight blocks the transfer ──────────────────────
describe('TC-14: sender holds 0 TKT — pre-flight error, transfer blocked', () => {
  beforeEach(setupDOM);

  test('shows "holds 0 TKT" error, balance panel hidden, sendSignedTransaction never called', async () => {
    // Only one call() needed — pre-flight returns 0 and throws immediately
    const contract = makeMockContractWithBalances(['0']);
    const web3     = makeMockWeb3();

    try {
      await executeTransfer({ contract, web3, walletAddress: WALLET_ADDRESS, privateKey: PRIVATE_KEY });
    } catch (err) {
      document.getElementById('errorBody').textContent = err.message;
      document.getElementById('errorModal').classList.add('active');

      const btn      = document.getElementById('transferBtn');
      btn.disabled   = false;
      btn.textContent = 'Sign & Send Transfer';
    }

    expect(document.getElementById('errorModal').classList.contains('active')).toBe(true);
    expect(document.getElementById('errorBody').textContent).toMatch(/holds 0 TKT/i);
    expect(document.getElementById('balancePanel').style.display).toBe('none');
    expect(document.getElementById('transferBtn').disabled).toBe(false);
    expect(web3.eth.sendSignedTransaction).not.toHaveBeenCalled();
  });
});
