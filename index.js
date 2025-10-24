// --- Basic server + Telegram webhook ---
const express = require('express');
const { Telegraf, Markup } = require('telegraf');

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) throw new Error('BOT_TOKEN missing');

const bot = new Telegraf(BOT_TOKEN);
const app = express();

app.use(express.json());

// Handlers simples pour tester
bot.start((ctx) =>
  ctx.reply(
    '⚡ LILBONE R2E Lottery\n\nUse the buttons below.',
    Markup.inlineKeyboard([
      [Markup.button.callback('🔗 Link Wallet', 'link_wallet')],
      [Markup.button.callback('🎟 My Ticket', 'my_ticket')]
    ])
  )
);
bot.action('link_wallet', (ctx) => ctx.reply('Send your Solana address here.'));
bot.action('my_ticket', (ctx) => ctx.reply('No ticket yet. Link your wallet first.'));

// Webhook endpoint pour Telegram
app.post('/telegram', (req, res) => {
  bot.handleUpdate(req.body, res);
});

// Petit healthcheck (Render peut le pinger)
app.get('/', (_, res) => res.status(200).send('OK LILBONE'));

// Démarre le serveur HTTP
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  const publicUrl =
    process.env.WEBHOOK_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  const webhookUrl = `${publicUrl}/telegram`;
  try {
    await bot.telegram.setWebhook(webhookUrl);
    console.log('✅ Server listening on', PORT);
    console.log('✅ Webhook set to', webhookUrl);
  } catch (e) {
    console.error('Failed to set webhook:', e);
  }
});

