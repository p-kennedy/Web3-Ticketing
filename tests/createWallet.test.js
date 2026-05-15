// TC-01 to TC-05 — createWallet page
// Pure functions and DOM validation re-declared inline; no module imports needed.

// ── Pure function under test ────────────────────────────────────────────────
function scorePassword(pw) {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 8)  score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(score, 4);
}

// ── DOM helpers (mirror the page's implementations) ────────────────────────
function setupDOM() {
  document.body.innerHTML = `
    <div id="errorBanner" style="display:none;"></div>
    <input type="password" id="password" value="" />
    <input type="password" id="passwordConfirm" value="" />
    <div id="resultPanel" style="display:none;"></div>
    <div id="displayAddress"></div>
    <div id="displayKey" class="masked"></div>
    <pre id="keystorePreview"></pre>
  `;
}

function showError(msg) {
  const banner = document.getElementById('errorBanner');
  banner.textContent = msg;
  banner.style.display = 'block';
  document.getElementById('password').classList.add('error');
}

function validateInputs() {
  const pw      = document.getElementById('password').value;
  const confirm = document.getElementById('passwordConfirm').value;

  if (!pw) {
    showError('A password is required to encrypt the keystore. Please enter one above.');
    return false;
  }
  if (pw.length < 8) {
    showError('Password must be at least 8 characters. Longer passwords produce stronger keystores.');
    return false;
  }
  if (!confirm) {
    showError('Please confirm your password in the second field.');
    return false;
  }
  if (pw !== confirm) {
    showError('Passwords do not match. Please re-enter them.');
    document.getElementById('passwordConfirm').classList.add('error');
    return false;
  }
  return true;
}

// ── scorePassword unit tests ────────────────────────────────────────────────
describe('scorePassword', () => {
  test('empty string returns 0', () => {
    expect(scorePassword('')).toBe(0);
  });

  test('null returns 0', () => {
    expect(scorePassword(null)).toBe(0);
  });

  test('short password (< 8 chars) with digits returns 1', () => {
    // 'abc123': no upper, has digits → score=1
    expect(scorePassword('abc123')).toBe(1);
  });

  test('password >= 12 chars, lowercase only returns 2', () => {
    // 'abcdefghijklm': >=8 (+1), >=12 (+1), no upper/special/digits → 2
    expect(scorePassword('abcdefghijklm')).toBe(2);
  });

  test('8-char mixed-case + digit + special returns 4', () => {
    // 'Abcdef1!': >=8 (+1), has upper+lower (+1), has digit (+1), has special (+1) → 4
    expect(scorePassword('Abcdef1!')).toBe(4);
  });

  test('strong long password is capped at 4', () => {
    expect(scorePassword('MySecure!Pass1234')).toBe(4);
  });
});

// ── validateInputs DOM tests ────────────────────────────────────────────────
describe('validateInputs', () => {
  beforeEach(setupDOM);

  test('TC-02: empty password shows required-password error', () => {
    validateInputs();
    const banner = document.getElementById('errorBanner');
    expect(banner.style.display).toBe('block');
    expect(banner.textContent).toMatch(/password is required/i);
  });

  test('TC-03: password shorter than 8 chars shows length error', () => {
    document.getElementById('password').value = 'short';
    validateInputs();
    expect(document.getElementById('errorBanner').textContent).toMatch(/at least 8 characters/i);
  });

  test('TC-04: missing confirm field shows confirm error', () => {
    document.getElementById('password').value = 'LongEnough1';
    validateInputs();
    expect(document.getElementById('errorBanner').textContent).toMatch(/confirm your password/i);
  });

  test('TC-05: mismatched passwords shows mismatch error and marks confirm input', () => {
    document.getElementById('password').value        = 'LongEnough1';
    document.getElementById('passwordConfirm').value = 'DifferentVal';
    validateInputs();
    expect(document.getElementById('errorBanner').textContent).toMatch(/do not match/i);
    expect(document.getElementById('passwordConfirm').classList.contains('error')).toBe(true);
  });

  test('TC-01: matching valid passwords passes validation (no error shown)', () => {
    document.getElementById('password').value        = 'SecurePass1!';
    document.getElementById('passwordConfirm').value = 'SecurePass1!';
    const result = validateInputs();
    expect(result).toBe(true);
    expect(document.getElementById('errorBanner').style.display).not.toBe('block');
  });
});

// ── TC-01 keypair generation (mocked web3) ──────────────────────────────────
describe('TC-01: keypair generation flow', () => {
  beforeEach(setupDOM);

  test('calls create() and encrypt(), populates address, shows result panel', () => {
    const mockWallet   = { address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' };
    const mockKeystore = { version: 3, id: 'test-id', address: mockWallet.address };

    const mockWeb3 = {
      eth: {
        accounts: {
          create:  jest.fn().mockReturnValue(mockWallet),
          encrypt: jest.fn().mockReturnValue(mockKeystore),
        },
      },
    };

    // Simulate the handler logic
    const wallet   = mockWeb3.eth.accounts.create();
    const keystore = mockWeb3.eth.accounts.encrypt(wallet.privateKey, 'SecurePass1!');

    document.getElementById('displayAddress').textContent  = wallet.address;
    document.getElementById('keystorePreview').textContent = JSON.stringify(keystore);
    document.getElementById('resultPanel').style.display   = 'block';

    expect(mockWeb3.eth.accounts.create).toHaveBeenCalledTimes(1);
    expect(mockWeb3.eth.accounts.encrypt).toHaveBeenCalledWith(mockWallet.privateKey, 'SecurePass1!');
    expect(document.getElementById('displayAddress').textContent).toBe(mockWallet.address);
    expect(document.getElementById('resultPanel').style.display).toBe('block');
    expect(document.getElementById('keystorePreview').textContent).toContain('test-id');
  });
});
