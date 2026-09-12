const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, delay } = require("@whiskeysockets/baileys");
const pino = require("pino");
const express = require("express");
const fs = require("fs");
const path = require("path");
const ytdlp = require("yt-dlp-exec");
const config = require("./config");

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const SESSIONS_DIR = path.join(__dirname, "sessions");
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

const groupSettings = {};
const activeGames = {};

app.get("/", (req, res) => {
  const sessions = fs.existsSync(SESSIONS_DIR) ? fs.readdirSync(SESSIONS_DIR).filter(f => fs.statSync(path.join(SESSIONS_DIR, f)).isDirectory()) : [];
  let sessionHtml = sessions.length > 0 ? sessions.map(s => `<div style="display:flex; justify-content:space-between; align-items:center; background:#1e293b; padding:10px; border-radius:8px; margin-bottom:8px; color:#34d399; font-family:monospace;"><span>📱 ${s}</span><span style="background:rgba(52,211,153,0.1); padding:4px 8px; border-radius:999px; font-size:12px;">Aktif ✅</span></div>`).join("") : '<p style="color:#64748b; text-align:center;">Belum ada nomor bot aktif.</p>';

  res.send(`<!DOCTYPE html>
  <html lang="id">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${config.botName} Panel</title>
  </head>
  <body style="background:#020617; color:#f8fafc; font-family:sans-serif; display:flex; justify-content:center; align-items:center; min-height:100vh; margin:0; padding:15px;">
    <div style="background:#0f172a; border:1px solid #1e293b; padding:20px; border-radius:16px; width:100%; max-width:400px; box-shadow:0 10px 25px rgba(0,0,0,0.5);">
      <hh1 style="color:#34d399; text-align:center; font-size:22px; margin-bottom:5px;">🤖 ${config.botName}</h1>
      <p style="text-align:center; color:#94a3b8; font-size:12px; margin-bottom:20px;">Owner: ${config.ownerName} (${config.ownerNumber})</p>
      
      <div style="margin-bottom:15px;">
        <label style="font-size:12px; color:#cbd5e1; display:block; margin-bottom:5px;">Tambah Nomor Bot (Pairing Code)</label>
        <div style="display:flex; gap:8px;">
          <input type="text" id="phoneNumber" placeholder="628xxxxxxxxxx" style="flex:1; background:#020617; border:1px solid #334155; color:#fff; padding:10px; border-radius:8px; outline:none;">
          <button onclick="requestPairing()" style="background:#059669; color:#fff; border:none; padding:10px 15px; border-radius:8px; font-weight:bold; cursor:pointer;">Generate</button>
        </div>
      </div>

      <div id="resultBox" style="display:none; background:#020617; border:1px solid rgba(52,211,153,0.3); padding:12px; border-radius:8px; text-align:center; margin-bottom:15px;">
        <p style="font-size:11px; color:#94a3b8; margin:0 0 5px 0;">Kode Pairing:</p>
        <h2 id="codeDisplay" style="color:#34d399; font-family:monospace; margin:0; font-size:24px;">------</h2>
      </div>

      <div>
        <h3 style="font-size:12px; color:#94a3b8; text-transform:uppercase; margin-bottom:8px;">Daftar Bot Aktif:</h3>
        <div id="sessionList">${sessionHtml}</div>
      </div>
    </div>

    <script>
      async function requestPairing() {
        const phone = document.getElementById("phoneNumber").value;
        if(!phone) return alert("Masukkan nomor bot!");
        const res = await fetch("/pairing", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({ phone }) });
        const data = await res.json();
        if(data.code) {
          document.getElementById("resultBox").style.display = "block";
          document.getElementById("codeDisplay").innerText = data.code;
        } else {
          alert("Gagal mengambil kode pairing.");
        }
      }
    </script>
  </body>
  </html>`);
});

app.post("/pairing", async (req, res) => {
  const phone = req.body.phone;
  if (!phone) return res.status(400).json({ error: "Nomor diperlukan" });
  try {
    const sessionPath = path.join(SESSIONS_DIR, `session_${phone}`);
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();
    const sock = makeWASocket({ version, logger: pino({ level: "silent" }), auth: state });
    if (!sock.authState.creds.registered) {
      await delay(3000);
      var code = await sock.requestPairingCode(phone);
      var formattedCode = code?.match(/.{1,4}/g)?.join("-") || code;
    }
    sock.ev.on("creds.update", saveCreds);
    startBotInstance(sock, `session_${phone}`);
    res.json({ code: formattedCode || "SUDAH_REGISTERED" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

function startBotInstance(sock, sessionName) {
  sock.ev.on("connection.update", (update) => {
    const { connection } = update;
    if (connection === "close") setTimeout(() => initBot(), 5000);
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const m = messages[0];
    if (!m.message || m.key.fromMe) return;
    const type = Object.keys(m.message)[0];
    const body = type === "conversation" ? m.message.conversation : type === "extendedTextMessage" ? m.message.extendedTextMessage.text : "";
    const sender = m.key.remoteJid;
    const isGroup = sender.endsWith("@g.us");

    if (!groupSettings[sender]) groupSettings[sender] = { antilinkgrup: false, antitoxic: false };
    const settings = groupSettings[sender];

    if (isGroup) {
      const lower = body.toLowerCase();
      if (settings.antilinkgrup && (lower.includes("chat.whatsapp.com") || lower.includes("wa.me/"))) return sock.sendMessage(sender, { delete: m.key });
      if (settings.antitoxic && (lower.includes("anjing") || lower.includes("kontol"))) return sock.sendMessage(sender, { delete: m.key });
    }

    if (!body.startsWith(config.prefix)) return;
    const args = body.slice(config.prefix.length).trim().split(/ +/);
    const cmd = args.shift().toLowerCase();
    const q = args.join(" ");

    if (cmd === "bot" || cmd === "mchlern") {
      await sock.sendMessage(sender, { image: { url: "https://i.imgur.com/jwgaL5s.png" }, caption: `🤖 *${config.botName}*\n\nOWNER: ${config.ownerName}\n\n"Halo teman teman saya ai dari masa depan"` }, { quoted: m });
    } else if (cmd === "menu" || cmd === "help") {
      await sock.sendMessage(sender, { text: `乂 *${config.botName} PANEL MENU* 乂\n\n.bot - Info bot AI\n.owner - Kontak owner\n.ping - Cek kecepatan\n.play [lagu] - Download YouTube\n.antilinkgrup [on/off]\n.antitoxic [on/off]\n.kick @tag (Admin Only)` }, { quoted: m });
    } else if (cmd === "owner") {
      await sock.sendMessage(sender, { text: `Owner Resmi: wa.me/${config.ownerNumber} (${config.ownerName})` }, { quoted: m });
    } else if (cmd === "ping") {
      await sock.sendMessage(sender, { text: "Pong! Bot aktif merespons 🚀" }, { quoted: m });
    } else if (cmd === "play") {
      if (!q) return sock.sendMessage(sender, { text: "Ketik judul lagu!\nContoh: .play dj remix" }, { quoted: m });
      await sock.sendMessage(sender, { text: `🔍 Mendownload lagu: *${q}*...` }, { quoted: m });
      try {
        const out = path.join(__dirname, `${Date.now()}.mp3`);
        await ytdlp(`ytsearch1:${q}`, { extractAudio: true, audioFormat: 'mp3', output: out, noCheckCertificates: true });
        if (fs.existsSync(out)) { await sock.sendMessage(sender, { audio: fs.readFileSync(out), mimetype: 'audio/mp4' }, { quoted: m }); fs.unlinkSync(out); }
      } catch (e) { sock.sendMessage(sender, { text: "Gagal mendownload audio dari YouTube." }, { quoted: m }); }
    } else if (cmd === "antilinkgrup") {
      settings.antilinkgrup = args[0]?.toLowerCase() === "on";
      await sock.sendMessage(sender, { text: `Anti link grup diubah ke: ${args[0]}` }, { quoted: m });
    } else if (cmd === "antitoxic") {
      settings.antitoxic = args[0]?.toLowerCase() === "on";
      await sock.sendMessage(sender, { text: `Anti toxic diubah ke: ${args[0]}` }, { quoted: m });
    } else if (cmd === "kick" && isGroup) {
      const target = m.message.extendedTextMessage?.contextInfo?.participant;
      if (target) await sock.groupParticipantsUpdate(sender, [target], "remove");
    }
  });
}

function initBot() {
  if (fs.existsSync(SESSIONS_DIR)) {
    fs.readdirSync(SESSIONS_DIR).filter(f => fs.statSync(path.join(SESSIONS_DIR, f)).isDirectory()).forEach(async (s) => {
      const sessionPath = path.join(SESSIONS_DIR, s);
      const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
      const { version } = await fetchLatestBaileysVersion();
      const sock = makeWASocket({ version, logger: pino({ level: "silent" }), auth: state });
      sock.ev.on("creds.update", saveCreds);
      startBotInstance(sock, s);
    });
  }
}

app.listen(PORT, () => { console.log(`Server running on port ${PORT}`); initBot(); });
