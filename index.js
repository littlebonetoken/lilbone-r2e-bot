// LILBONE R2E Lottery Bot — wallet check + ticket

const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const Database = require('better-sqlite3');
const { Connection, PublicKey } = require('@solana/web3.js');
const { getAssociatedTokenAddress, getAccount } = require('@solana/spl-token');

// --- ENV
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = Number(process.env.ADMIN_CHAT_ID);
const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const TOKEN_MINT = process.env.TOKEN_MINT; // LILBONE mint
const MIN_HOLD = Number(process.env.MIN_HOLD || 400000);
const DECIMALS = Number(process.env.TOKEN_DECIMALS || 9); // ajuste si besoin

if (!BOT_TOKEN) throw new Error('BOT_TOKEN missing');
if (!TOKEN_MINT) throw new Error('TOKEN_MINT missing');
if (!ADMIN_CHAT_ID) console.warn('⚠️ ADMIN_CHAT_ID is empty: admin notifications disabled.');

const bot = new Telegraf(BOT_TOKEN);
const app = express();
app.use(express.json());

// --- DB (SQLite file in working dir)
const db = new Database('lilbone.db');
db.exec(`
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  username TEXT,
  wallet TEXT UNIQUE,
  ticket_no TEXT UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

// --- Solana
const conn = new Connection(RPC_URL, 'confirmed');
const MINT_PK = new PublicKey(TOKEN_MINT);

// --- tiny in-memory state for expecting wallet (avoid extra deps)
const expectingWallet = new Map(); // key: user_id -> true/false

// --- helpers
const isValidSolAddress = (a) => {
  try { new PublicKey(a); return true; } catch { return false; }
};

const genTicketNo = () =>
  'LB-' + Math.random().toString(36).slice(2, 6).toUpperCase() + '-' +
  Math.random().toString(36).slice(2, 6).toUpperCase();

async function getTokenBalance(ownerStr) {
  const owner = new PublicKey(ownerStr);
  const ata = await getAssociatedTokenAddress(MINT_PK, owner, false);
  try {
    const acc = await getAccount(conn, ata);
    const bal = Number(acc.amount) / 10 ** DECIMALS;
    return bal;
  } catch (e) {
    // No token account = 0
    return 0;
  }
}

// --- UI
const homeKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('🔗 Link Wallet', 'link_wallet')],
  [Markup.button.callback('🎟 My Ticket', 'my_ticket')]
]);

bot.start((ctx) =>
  ctx.reply(
    '⚡ LILBONE R2E Lottery\n\n' +
    'Link your wallet to get your Golden Ticket (holders only).\n' +
    `Requirement: hold ≥ ${MIN_HOLD.toLocaleString()} $LILBONE`,
    homeKeyboard
  )
);

bot.action('link_wallet', async (ctx) => {
  try { await ctx.answerCbQuery(); } catch {}
  expectingWallet.set(ctx.from.id, true);
  return ctx.reply(
    '🔗 Send your **Solana wallet address** (Phantom/Solflare…)\n' +
    `⚠️ You must hold **≥ ${MIN_HOLD.toLocaleString()} $LILBONE**.`,
    { parse_mode: 'Markdown' }
  );
});

bot.action('my_ticket', async (ctx) => {
  try { await ctx.answerCbQuery(); } catch {}
  const row = db.prepare('SELECT ticket_no, wallet FROM tickets WHERE user_id=?').get(ctx.from.id);
  if (!row) return ctx.reply('❌ No ticket found. Link your wallet first.', homeKeyboard);
  return ctx.reply(`🎟 Your Golden Ticket: **${row.ticket_no}**\n🔗 Wallet: \`${row.wallet}\``,
    { parse_mode: 'Markdown' });
});

// --- text handler: capture wallet when expected
bot.on('text', async (ctx) => {
  const wait = expectingWallet.get(ctx.from.id);
  if (!wait) return; // ignore unrelated messages

  const address = ctx.message.text.trim();
  if (!isValidSolAddress(address)) {
    return ctx.reply('❌ Invalid Solana address. Please send a valid address.');
  }

  // already has ticket?
  const exists = db.prepare('SELECT * FROM tickets WHERE user_id=? OR wallet=?').get(ctx.from.id, address);
  if (exists) {
    expectingWallet.delete(ctx.from.id);
    return ctx.reply(`✅ You already have a ticket: **${exists.ticket_no}**`,
      { parse_mode: 'Markdown' });
  }

  try {
    await ctx.reply('⏳ Verifying your $LILBONE balance…');
    const bal = await getTokenBalance(address);

    if (bal < MIN_HOLD) {
      expectingWallet.delete(ctx.from.id);
      return ctx.reply(
        `❌ Not enough $LILBONE.\n` +
        `You hold **${Math.floor(bal).toLocaleString()}**, need **${MIN_HOLD.toLocaleString()}+**.`,
        { parse_mode: 'Markdown' }
      );
    }

    const ticketNo = genTicketNo();
    db.prepare('INSERT INTO tickets (user_id, username, wallet, ticket_no) VALUES (?, ?, ?, ?)')
      .run(ctx.from.id, ctx.from.username || '', address, ticketNo);

    // Notify user
    await ctx.reply(
      `🎉 **Golden Ticket created!**\n\n` +
      `🎟 Ticket: **${ticketNo}**\n` +
      `🔗 Wallet: \`${address}\`\n\n` +
      `Good luck for Jan 1st!`,
      { parse_mode: 'Markdown' }
    );

    // Notify admin
    if (ADMIN_CHAT_ID) {
      await bot.telegram.sendMessage(
        ADMIN_CHAT_ID,
        `🟡 New Golden Ticket\nUser: @${ctx.from.username || 'unknown'} (${ctx.from.id})\nWallet: ${address}\nTicket: ${ticketNo}`
      );
    }

    expectingWallet.delete(ctx.from.id);

  } catch (e) {
    console.error(e);
    expectingWallet.delete(ctx.from.id);
    ctx.reply('⚠️ Error while verifying. Please try again later.');
  }
});

// --- Express webhook + health
app.post('/telegram', (req, res) => bot.handleUpdate(req.body, res));
app.get('/', (_, res) => res.status(200).send('OK LILBONE'));

// --- Start server & set webhook automatically on Render
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
