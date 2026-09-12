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
  let sessionHtml = sessions.length > 0 ? sessions.map(s => `<div class="flex justify-between items-center bg-slate-800 p-3 rounded-xl mb-2 border border-slate-700"><span class="font-mono text-emerald-400">📱 \${s}</span><span class="text-xs bg-emerald-500/10 text-emerald-400 px-2.5 py-1 rounded-full font-semibold">Aktif ✅</span></div>`).join("") : '<p class="text-xs text-slate-500 text-center py-2">Belum ada nomor bot aktif.</p>';
  res.send(`<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${config.botName} Panel</title><script src="https://cdn.tailwindcss.com"></script></head><body class="bg-slate-950 text-slate-100 min-h-screen flex items-center justify-center p-4"><div class="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl"><h1 class="text-2xl font-bold text-center text-emerald-400 mb-1">🤖 ${config.botName}</h1><p class="text-xs text-center text-slate-400 mb-6">Owner: ${config.ownerName} (${config.ownerNumber})</p><div class="mb-6"><label class="block text-xs font-medium text-slate-300 mb-2">Tambah Nomor Bot (Pairing Code)</label><div class="flex gap-2"><input type="text" id="phoneNumber" placeholder="628xxxxxxxxxx" class="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500"><button onclick="requestPairing()" class="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-4 py-2.5 rounded-xl text-sm">Generate</button></div></div><div id="resultBox" class="hidden bg-slate-950 border border-emerald-500/30 rounded-xl p-4 text-center mb-6"><p class="text-xs text-slate-400 mb-1">Kode Pairing:</p><h2 id="codeDisplay" class="text-2xl font-mono font-bold text-emerald-400">------</h2></div><div class="mb-6"><h3 class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Daftar Nomor Bot Aktif:</h3><div id="sessionList">${sessionHtml}</div></div><div class="border-t border-slate-800 pt-4 text-xs space-y-1.5 text-slate-300"><p class="font-semibold text-emerald-400 mb-1">Fitur Utama:</p><div>🛡️ Anti Link (Grup/Saluran), Toxic, Media</div><div>⚙️ Welcome & Keluar (.setwelcome / .setkeluar)</div><div>🎵 Auto Download Musik YouTube (.play)</div><div>🎮 Mini Games & Perintah .bot / .menu</div></div></div><script>async function requestPairing(){const phone=document.getElementById("phoneNumber").value;if(!phone)return alert("Masukkan nomor bot!");const res=await fetch("/pairing",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone})});const data=await res.json();if(data.code){document.getElementById("resultBox").classList.remove("hidden");document.getElementById("codeDisplay").innerText=data.code;}else{alert("Gagal mengambil kode pairing.");}}</script></body></html>`);
});
app.post("/pairing", async (req, res) => {
  const phone = req.body.phone;
  if (!phone) return res.status(400).json({ error: "Nomor diperlukan" });
  try {
    const sessionPath = path.join(SESSIONS_DIR, \`session_\${phone}\`);
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();
    const sock = makeWASocket({ version, logger: pino({ level: "silent" }), auth: state });
    if (!sock.authState.creds.registered) {
      await delay(3000);
      var code = await sock.requestPairingCode(phone);
      var formattedCode = code?.match(/.{1,4}/g)?.join("-") || code;
    }
    sock.ev.on("creds.update", saveCreds);
    startBotInstance(sock, \`session_\${phone}\`);
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
    if (anu.action === "add") await sock.sendMessage(anu.id, { text: mdata.welcome.replace("@name", \`@\${anu.participants[0].split("@")[0]}\`), mentions: [anu.participants[0]] });
    else if (anu.action === "remove") await sock.sendMessage(anu.id, { text: mdata.bye.replace("@name", \`@\${anu.participants[0].split("@")[0]}\`), mentions: [anu.participants[0]] });
  });
  sock.ev.on("messages.upsert", async ({ messages }) => {
    const m = messages[0];
    if (!m.message || m.key.fromMe) return;
    const type = Object.keys(m.message)[0];
    const body = type === "conversation" ? m.message.conversation : type === "extendedTextMessage" ? m.message.extendedTextMessage.text : "";
    const sender = m.key.remoteJid;
    const isGroup = sender.endsWith("@g.us");
    if (!groupSettings[sender]) groupSettings[sender] = { antilinkgrup: false, antilinksaluran: false, antitoxic: false, welcome: "Halo @name", bye: "Dadah @name" };
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
      await sock.sendMessage(sender, { image: { url: "https://i.imgur.com/jwgaL5s.png" }, caption: \`🤖 *${config.botName}*\n\nOWNER: ${config.ownerName}\n\n"Halo teman teman saya ai dari masa depan"\` }, { quoted: m });
    } else if (cmd === "menu" || cmd === "help") {
      await sock.sendMessage(sender, { text: \`乂 *${config.botName} PANEL MENU* 乂\n\n.bot - Info bot AI\n.owner - Kontak owner\n.ping - Cek kecepatan\n.tebakangka - Main game angka\n.suit - Suit [batu/gunting/kertas]\n.play [lagu] - Download YouTube\n.antilinkgrup [on/off]\n.antitoxic [on/off]\n.setwelcome [teks]\n.setkeluar [teks]\n.kick @tag (Admin Only)\` }, { quoted: m });
    } else if (cmd === "owner") {
      await sock.sendMessage(sender, { text: \`Owner Resmi: wa.me/${config.ownerNumber} (${config.ownerName})\` }, { quoted: m });
    } else if (cmd === "ping") {
      await sock.sendMessage(sender, { text: "Pong! Bot aktif merespons 🚀" }, { quoted: m });
    } else if (cmd === "play") {
      if (!q) return sock.sendMessage(sender, { text: "Ketik judul lagu!
Contoh: .play dj remix" }, { quoted: m });
      await sock.sendMessage(sender, { text: `🔍 Mendownload lagu: *${q}*...` }, { quoted: m });
      try {
        const out = path.join(__dirname, \`\${Date.now()}.mp3\`);
        await ytdlp(\`ytsearch1:\${q}\`, { extractAudio: true, audioFormat: mp3, output: out, noCheckCertificates: true });
        if (fs.existsSync(out)) { await sock.sendMessage(sender, { audio: fs.readFileSync(out), mimetype: audio/mp4 }, { quoted: m }); fs.unlinkSync(out); }
      } catch (e) { sock.sendMessage(sender, { text: "Gagal mendownload audio dari YouTube." }, { quoted: m }); }
    } else if (cmd === "antilinkgrup") {
      settings.antilinkgrup = args[0]?.toLowerCase() === "on";
      await sock.sendMessage(sender, { text: \`Anti link grup diubah ke: ${args[0]}\` }, { quoted: m });
    } else if (cmd === "antitoxic") {
      settings.antitoxic = args[0]?.toLowerCase() === "on";
      await sock.sendMessage(sender, { text: \`Anti toxic diubah ke: ${args[0]}\` }, { quoted: m });
    } else if (cmd === "setwelcome") {
      settings.welcome = q;
      await sock.sendMessage(sender, { text: "Pesan welcome berhasil diatur!" }, { quoted: m });
    } else if (cmd === "setkeluar") {
      settings.bye = q;
      await sock.sendMessage(sender, { text: "Pesan keluar berhasil diatur!" }, { quoted: m });
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