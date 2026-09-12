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
  let sessionHtml = sessions.length > 0 ? sessions.map(s => `<div style="display:flex; justify-content:space-between; align-items:center; background:#1e293b; padding:10px; border-radius:8px; margin-bottom:8px; color:#34d399; font-family:monospace;"><span>📱 ${s}</span><span style="background:rgba(52,211,153,0.1); padding:4px 8px; border-radius:999px; font-size:12px;">Aktif ✅</span></div>`).join("") : '<p style="color:#64748b; text-align:center; font-size:13px;">Belum ada nomor bot aktif.</p>';

  res.send(`<!DOCTYPE html>
  <html lang="id">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${config.botName} - Panel Dashboard</title>
  </head>
  <body style="background:#020617; color:#f8fafc; font-family:sans-serif; display:flex; justify-content:center; align-items:center; min-height:100vh; margin:0; padding:15px;">
    <div style="background:#0f172a; border:1px solid #1e293b; padding:24px; border-radius:16px; width:100%; max-width:460px; box-shadow:0 10px 25px rgba(0,0,0,0.5);">
      <h1 style="color:#34d399; text-align:center; font-size:24px; margin-bottom:5px;">🤖 ${config.botName}</h1>
      <p style="text-align:center; color:#94a3b8; font-size:12px; margin-bottom:20px;">Owner: ${config.ownerName} (${config.ownerNumber})</p>
      
      <div style="margin-bottom:15px;">
        <label style="font-size:12px; color:#cbd5e1; display:block; margin-bottom:5px; font-weight:bold;">Tambah Nomor Bot Baru (Pairing Code)</label>
        <div style="display:flex; gap:8px;">
          <input type="text" id="phoneNumber" placeholder="628xxxxxxxxxx" style="flex:1; background:#020617; border:1px solid #334155; color:#fff; padding:10px; border-radius:8px; outline:none; font-size:14px;">
          <button onclick="requestPairing()" style="background:#059669; color:#fff; border:none; padding:10px 16px; border-radius:8px; font-weight:bold; cursor:pointer;">Generate</button>
        </div>
      </div>

      <div id="resultBox" style="display:none; background:#020617; border:1px solid rgba(52,211,153,0.3); padding:12px; border-radius:8px; text-align:center; margin-bottom:15px;">
        <p style="font-size:11px; color:#94a3b8; margin:0 0 5px 0;">Kode Pairing WhatsApp:</p>
        <h2 id="codeDisplay" style="color:#34d399; font-family:monospace; margin:0; font-size:26px; letter-spacing:2px;">------</h2>
      </div>

      <div style="margin-bottom:20px;">
        <h3 style="font-size:12px; color:#94a3b8; text-transform:uppercase; margin-bottom:8px; letter-spacing:0.5px;">Daftar Nomor Bot Aktif:</h3>
        <div id="sessionList">${sessionHtml}</div>
      </div>

      <div style="border-top:1px solid #1e293b; padding-top:15px;">
        <h3 style="font-size:12px; color:#34d399; text-transform:uppercase; margin-bottom:8px;">Daftar Fitur Bot & Panduan:</h3>
        <div style="font-size:11px; color:#cbd5e1; line-height:1.6; max-height:160px; overflow-y:auto; padding-right:5px;">
          <p>🤖 <b>.bot / .mchlern</b> - Munculkan info AI & foto</p>
          <p>🎮 <b>.tebakangka / .suit</b> - Mini games interaktif</p>
          <p>🎵 <b>.play [judul]</b> - Auto download musik YouTube</p>
          <p>🛡️ <b>.antilinkgrup on/off</b> - Blokir link grup WhatsApp</p>
          <p>🛡️ <b>.antilinksaluran on/off</b> - Blokir link saluran</p>
          <p>🤬 <b>.antitoxic on/off</b> - Sensor kata kasar otomatis</p>
          <p>👋 <b>.setwelcome [teks]</b> - Custom pesan sambutan member baru</p>
          <p>🚪 <b>.setkeluar [teks]</b> - Custom pesan member keluar</p>
          <p>👢 <b>.kick</b> - Keluarkan member (Tag orangnya)</p>
          <p>👤 <b>.owner</b> - Kontak owner resmi (${config.ownerNumber})</p>
        </div>
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

  sock.ev.on("group-participants.update", async (anu) => {
    const mdata = groupSettings[anu.id] || { welcome: "Halo @name, selamat datang!", bye: "Sampai jumpa @name!" };
    if (anu.action === "add") {
      let text = mdata.welcome.replace("@name", `@${anu.participants[0].split("@")[0]}`);
      await sock.sendMessage(anu.id, { text, mentions: [anu.participants[0]] });
    } else if (anu.action === "remove") {
      let text = mdata.bye.replace("@name", `@${anu.participants[0].split("@")[0]}`);
      await sock.sendMessage(anu.id, { text, mentions: [anu.participants[0]] });
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const m = messages[0];
    if (!m.message || m.key.fromMe) return;
    const type = Object.keys(m.message)[0];
    const body = type === "conversation" ? m.message.conversation : type === "extendedTextMessage" ? m.message.extendedTextMessage.text : "";
    const sender = m.key.remoteJid;
    const isGroup = sender.endsWith("@g.us");

    if (!groupSettings[sender]) {
      groupSettings[sender] = {
        antilinkgrup: false,
        antilinksaluran: false,
        antitoxic: false,
        welcome: "Halo @name, selamat datang di grup kami!",
        bye: "Sampai jumpa @name, semoga kembali lagi ya!"
      };
    }
    const settings = groupSettings[sender];

    if (isGroup) {
      const lower = body.toLowerCase();
      if (settings.antilinkgrup && (lower.includes("chat.whatsapp.com") || lower.includes("wa.me/"))) return sock.sendMessage(sender, { delete: m.key });
      if (settings.antilinksaluran && lower.includes("whatsapp.com/channel/")) return sock.sendMessage(sender, { delete: m.key });
      if (settings.antitoxic && (lower.includes("anjing") || lower.includes("kontol") || lower.includes("babi"))) return sock.sendMessage(sender, { delete: m.key });
    }

    if (!body.startsWith(config.prefix)) {
      if (activeGames[sender] && activeGames[sender].game === "tebakangka") {
        const guess = parseInt(body);
        if (guess === activeGames[sender].answer) {
          await sock.sendMessage(sender, { text: `🎉 *Tebakanmu Benar!* Angkanya adalah ${activeGames[sender].answer}` }, { quoted: m });
          delete activeGames[sender];
        } else if (!isNaN(guess)) {
          await sock.sendMessage(sender, { text: guess > activeGames[sender].answer ? "📉 Terlalu tinggi!" : "📈 Terlalu rendah!" }, { quoted: m });
        }
      }
      return;
    }

    const args = body.slice(config.prefix.length).trim().split(/ +/);
    const cmd = args.shift().toLowerCase();
    const q = args.join(" ");

    if (cmd === "bot" || cmd === "mchlern") {
      await sock.sendMessage(sender, {
        image: { url: "https://i.imgur.com/jwgaL5s.png" },
        caption: `🤖 *${config.botName}*\n\nOWNER: ${config.ownerName}\n\n"Halo teman teman saya ai dari masa depan"`
      }, { quoted: m });
    } else if (cmd === "menu" || cmd === "help") {
      await sock.sendMessage(sender, { text: `乂 *${config.botName} PANEL MENU* 乂\n\n` +
        `🤖 .bot - Info Bot AI\n` +
        `👤 .owner - Kontak Owner (${config.ownerNumber})\n` +
        `🏓 .ping - Cek kecepatan bot\n` +
        `🎮 .tebakangka - Main tebak angka\n` +
        `✂️ .suit [batu/gunting/kertas] - Adu suit\n` +
        `🎵 .play [judul] - Auto download YouTube\n` +
        `🛡️ .antilinkgrup [on/off]\n` +
        `🛡️ .antilinksaluran [on/off]\n` +
        `🤬 .antitoxic [on/off]\n` +
        `👋 .setwelcome [pesan @name]\n` +
        `🚪 .setkeluar [pesan @name]\n` +
        `👢 .kick (Tag member target)\n\n` +
        `_Ketik perintah sesuai format!_`
      }, { quoted: m });
    } else if (cmd === "owner") {
      await sock.sendMessage(sender, { text: `Owner Resmi Bot:\nWa.me/${config.ownerNumber} (${config.ownerName})` }, { quoted: m });
    } else if (cmd === "ping") {
      await sock.sendMessage(sender, { text: "Pong! Bot aktif merespons 🚀" }, { quoted: m });
    } else if (cmd === "tebakangka") {
      activeGames[sender] = { game: "tebakangka", answer: Math.floor(Math.random() * 10) + 1 };
      await sock.sendMessage(sender, { text: "🎮 Tebak Angka (1-10) dimulai! Silakan ketik angka tebakanmu." }, { quoted: m });
    } else if (cmd === "suit") {
      const userChoice = args[0]?.toLowerCase();
      const choices = ["batu", "gunting", "kertas"];
      if (!choices.includes(userChoice)) return await sock.sendMessage(sender, { text: "Format salah! Ketik: .suit batu / gunting / kertas" }, { quoted: m });
      const botChoice = choices[Math.floor(Math.random() * choices.length)];
      let resText = userChoice === botChoice ? "Seri!" : ((userChoice === "batu" && botChoice === "gunting") || (userChoice === "gunting" && botChoice === "kertas") || (userChoice === "kertas" && botChoice === "batu")) ? "Kamu MENANG! 🎉" : "Kamu KALAH! 🤖";
      await sock.sendMessage(sender, { text: `${resText}\nBot memilih: *${botChoice}*` }, { quoted: m });
    } else if (cmd === "play") {
      if (!q) return await sock.sendMessage(sender, { text: "Masukkan judul lagu!\nContoh: .play dj remix terbaru" }, { quoted: m });
      await sock.sendMessage(sender, { text: `🔍 Sedang mendownload audio untuk: *${q}*...` }, { quoted: m });
      try {
        const out = path.join(__dirname, `${Date.now()}.mp3`);
        await ytdlp(`ytsearch1:${q}`, { extractAudio: true, audioFormat: 'mp3', output: out, noCheckCertificates: true });
        if (fs.existsSync(out)) {
          await sock.sendMessage(sender, { audio: fs.readFileSync(out), mimetype: 'audio/mp4' }, { quoted: m });
          fs.unlinkSync(out);
        }
      } catch (e) {
        await sock.sendMessage(sender, { text: "Gagal mendownload audio dari YouTube." }, { quoted: m });
      }
    } else if (cmd === "antilinkgrup") {
      if (!isGroup) return;
      settings.antilinkgrup = args[0]?.toLowerCase() === "on";
      await sock.sendMessage(sender, { text: `Anti Link Grup diubah ke: *${args[0]}*` }, { quoted: m });
    } else if (cmd === "antilinksaluran") {
      if (!isGroup) return;
      settings.antilinksaluran = args[0]?.toLowerCase() === "on";
      await sock.sendMessage(sender, { text: `Anti Link Saluran diubah ke: *${args[0]}*` }, { quoted: m });
    } else if (cmd === "antitoxic") {
      if (!isGroup) return;
      settings.antitoxic = args[0]?.toLowerCase() === "on";
      await sock.sendMessage(sender, { text: `Anti Toxic diubah ke: *${args[0]}*` }, { quoted: m });
    } else if (cmd === "setwelcome") {
      if (!q) return await sock.sendMessage(sender, { text: "Gunakan format:\n`.setwelcome Halo @name selamat datang`" }, { quoted: m });
      settings.welcome = q;
      await sock.sendMessage(sender, { text: "Pesan welcome berhasil diatur!" }, { quoted: m });
    } else if (cmd === "setkeluar") {
      if (!q) return await sock.sendMessage(sender, { text: "Gunakan format:\n`.setkeluar Dadah @name`" }, { quoted: m });
      settings.bye = q;
      await sock.sendMessage(sender, { text: "Pesan keluar berhasil diatur!" }, { quoted: m });
    } else if (cmd === "kick" && isGroup) {
      const target = m.message.extendedTextMessage?.contextInfo?.participant;
      if (!target) return await sock.sendMessage(sender, { text: "Tag member yang ingin di-kick!" }, { quoted: m });
      await sock.groupParticipantsUpdate(sender, [target], "remove");
      await sock.sendMessage(sender, { text: "Berhasil mengeluarkan member." }, { quoted: m });
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
