const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const fs = require('fs-extra');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const express = require('express');
const path = require('path');

const sewaPath = './sewa.json';
const DURASI_PERMANEN = 9999999999999;
const owner = '6282333014459@s.whatsapp.net';

if (!fs.existsSync(sewaPath)) fs.writeJSONSync(sewaPath, {});

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    auth: state
  });

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) qrcode.generate(qr, { small: true });
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) startBot();
    }
    if (connection === 'open') console.log('✅ Bot tersambung!');
  });

  sock.ev.on('creds.update', saveCreds);

  setInterval(async () => {
  const sewa = fs.readJSONSync(sewaPath);
  const now = new Date();
  const jam = now.getHours().toString().padStart(2, '0') + ':' +
              now.getMinutes().toString().padStart(2, '0');
  const tanggal = now.toISOString().split('T')[0]; // yyyy-mm-dd

  for (let groupId in sewa) {
    const fitur = sewa[groupId].features;
    if (!fitur.autoOpen && !fitur.autoClose) continue;

    try {
      const meta = await sock.groupMetadata(groupId);
      const botId = sock.user.id.split(':')[0] + '@s.whatsapp.net';
      const bot = meta.participants.find(p => p.id === botId);
      if (!bot?.admin) continue;

      // Tutup grup
      if (fitur.autoClose === jam && fitur.lastClose !== tanggal) {
        await sock.groupSettingUpdate(groupId, 'announcement');
        await sock.sendMessage(groupId, { text: '🔒 Grup ditutup otomatis oleh bot.' });
        fitur.lastClose = tanggal;
      }

      // Buka grup
      if (fitur.autoOpen === jam && fitur.lastOpen !== tanggal) {
        await sock.groupSettingUpdate(groupId, 'not_announcement');
        await sock.sendMessage(groupId, { text: '🔓 Grup dibuka otomatis oleh bot.' });
        fitur.lastOpen = tanggal;
      }

    } catch (e) {
      console.error(`❌ Gagal update grup ${groupId}:`, e.message);
    }
  }

  fs.writeJSONSync(sewaPath, sewa);
}, 60 * 1000);

  // Notifikasi welcome, perpisahan, promosi/demote
  sock.ev.on('group-participants.update', async update => {
    const sewa = fs.readJSONSync(sewaPath);
    const { id, participants, action } = update;
    const botId = sock.user.id.split(':')[0] + '@s.whatsapp.net';

    // Bot admin
    if (participants.includes(botId)) {
      const meta = await sock.groupMetadata(id);
      const botInfo = meta.participants.find(p => p.id === botId);
      const isBotAdmin = botInfo?.admin;
      if (action === 'promote' && isBotAdmin) {
        sock.sendMessage(id, { text: '✅ Bot sekarang *admin* di grup ini.' });
      }
      if (action === 'demote' && !isBotAdmin) {
        sock.sendMessage(id, { text: '⚠️ Bot bukan admin lagi.' });
      }
    }

    // Welcome
    if (action === 'add' && sewa[id]?.features?.welcome) {
      for (let user of participants) {
        sock.sendMessage(id, {
          text: `👋 Selamat datang @${user.split('@')[0]}!`,
          mentions: [user]
        });
      }
    }

    // Goodbye
    if (action === 'remove' && sewa[id]?.features?.welcome) {
      for (let user of participants) {
        sock.sendMessage(id, {
          text: `👋 Selamat tinggal @${user.split('@')[0]}!`,
          mentions: [user]
        });
      }
    }
  });

  // Daftar kata kasar/porno (versi ringan)
  const kataTerlarang = ['bokep', 'sex', 'xnxx', 'video viral'];

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const senderRaw = msg.key.participant || msg.key.remoteJid;
    const sender = senderRaw.includes('@s.whatsapp.net') ? senderRaw : senderRaw + '@s.whatsapp.net';
    const isGroup = from.endsWith('@g.us');
    const sewa = fs.readJSONSync(sewaPath);
    const now = Date.now();

   // Ambil teks atau title polling
let text = '';
if (msg.message.conversation) text = msg.message.conversation;
else if (msg.message.extendedTextMessage?.text) text = msg.message.extendedTextMessage.text;
else if (msg.message.pollCreationMessage?.name) text = msg.message.pollCreationMessage.name;

// Fitur Promote
if (text.startsWith('#promote')) {
  const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;
  if (!mentioned || mentioned.length === 0) {
    return sock.sendMessage(from, {
      text: '⚠️ Tag @user yang mau dipromosikan.',
      quoted: msg
    });
  }

  try {
    await sock.groupParticipantsUpdate(from, mentioned, 'promote');
    return sock.sendMessage(from, {
      text: `✅ Sukses promote:\n${mentioned.map(u => `@${u.split('@')[0]}`).join('\n')}`,
      mentions: mentioned,
      quoted: msg
    });
  } catch (e) {
    return sock.sendMessage(from, {
      text: '❌ Gagal promote. Pastikan bot admin dan user belum admin.',
      quoted: msg
    });
  }
}

// Fitur Demote
if (text.startsWith('#demote')) {
  const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;

  if (!mentioned || mentioned.length === 0) {
    return sock.sendMessage(from, {
      text: '⚠️ Tag @user yang mau diturunkan dari admin.',
      quoted: msg
    });
  }

  try {
    await sock.groupParticipantsUpdate(from, mentioned, 'demote');
    return sock.sendMessage(from, {
      text: `✅ Sukses demote:\n${mentioned.map(u => `@${u.split('@')[0]}`).join('\n')}`,
      mentions: mentioned,
      quoted: msg
    });
  } catch (e) {
    return sock.sendMessage(from, {
      text: '❌ Gagal demote. Pastikan bot adalah admin dan user tersebut adalah admin.',
      quoted: msg
    });
  }
}

    // === ANTI TOXIC ===
const kataToxic = ['kontol', 'memek', 'ngentot', 'bangsat', 'anjing', 'asu', 'tolol']; // bisa kamu tambah

if (isGroup && sewa[from] && text) {
  const lower = text.toLowerCase();
  if (kataToxic.some(kata => lower.includes(kata))) {
    const userId = sender;
    warningData[from] = warningData[from] || {};
    warningData[from][userId] = (warningData[from][userId] || 0) + 1;
    const jumlah = warningData[from][userId];

    fs.writeJSONSync(warningPath, warningData);

    if (jumlah >= 3) {
      await sock.sendMessage(from, {
        text: `🚫 @${sender.split('@')[0]} telah toxic sebanyak 3x dan akan dikeluarkan.`,
        mentions: [sender]
      });
      delete warningData[from][userId];
      fs.writeJSONSync(warningPath, warningData);
      return await sock.groupParticipantsUpdate(from, [sender], 'remove');
    } else {
      return sock.sendMessage(from, {
        text: `⚠️ @${sender.split('@')[0]}, jangan toxic!\nPeringatan: ${jumlah}/3`,
        mentions: [sender]
      });
    }
  }
}

    // Deteksi konten porno → kick tanpa gambar
    if (isGroup && sewa[from] && text) {
      const lower = text.toLowerCase();
      if (kataTerlarang.some(k => lower.includes(k))) {
        const meta = await sock.groupMetadata(from);
        const isAdmin = meta.participants.find(p => p.id === sender)?.admin || false;
        if (!isAdmin && sender !== owner) {
          await sock.sendMessage(from, { text: `🚫 @${sender.split('@')[0]} mengirim konten terlarang.`, mentions: [sender] });
          return await sock.groupParticipantsUpdate(from, [sender], 'remove');
        }
      }
    }

    // Cek admin grup
    let isAdmin = false;
    if (isGroup) {
      const meta = await sock.groupMetadata(from);
      isAdmin = meta.participants.find(p => p.id === sender)?.admin || false;
    }

    // Fitur: Pesan perkenalan saat pertama kali chat pribadi
if (!isGroup) {
  const senderNumber = sender.replace('@s.whatsapp.net', '');
  const sentBeforePath = './sentPrivate.json';

  if (!fs.existsSync(sentBeforePath)) fs.writeJSONSync(sentBeforePath, []);

  const sentBefore = fs.readJSONSync(sentBeforePath);

  if (!sentBefore.includes(senderNumber)) {
    sentBefore.push(senderNumber);
    fs.writeJSONSync(sentBeforePath, sentBefore);

    await sock.sendMessage(from, {
      text:
        `✨ *Mau sewa bot murah?*\n` +
        `Kenalin aku *Tacatic* 🤖\n\n` +
        `📌 Ketik *#sewabot* untuk info\n` +
        `📞 Atau langsung chat owner:\nwa.me/${owner.replace('@s.whatsapp.net', '')}`
    });
  }
}

if (!isGroup && text === '#sewabot') {
  return sock.sendMessage(from, {
    text:
`🤖 *SEWA BOT TACATIC!*

📌 *Harga Sewa:*
- 7 Hari : 3.000
- 30 Hari: 5.000
- Permanen: 10.000

📋 *Syarat & Ketentuan:*
1. Bot harus sudah masuk grup kamu
2. Jadikan bot sebagai *admin grup*
3. Aktivasi hanya bisa dilakukan oleh *owner bot*
4. Gunakan perintah *#aktifkanbot1 / #aktifkanbot2 / #aktifkanbot3* sesuai durasi
5. Fitur hanya bisa digunakan oleh admin grup

🛍️ *Tertarik Sewa?*
Silakan hubungi owner:
📞 wa.me/${owner.replace('@s.whatsapp.net', '')}

Terima kasih telah memilih *Tacatic Bot* 💗`
  });
}

    // Anti virtex
    if (
      text.length > 5000 ||
      /[\u202e\u2066\u2067\u2068\u2069]/.test(text)
    ) {
      await sock.sendMessage(from, { delete: msg.key });
      return;
    }

    // Menu pribadi
    if (!isGroup && text === '#menu') {
      return sock.sendMessage(from, {
        text:
          `👤 *MENU PRIBADI:*\n` +
          `#owner - Lihat kontak owner bot\n`,
        quoted: msg
      });
    }

    // Menu admin grup
    if (isGroup && text === '#menu' && (isAdmin || sender === owner)) {
      return sock.sendMessage(from, {
        text:
  `👥 *MENU GRUP TACATIC:*\n\n` +
  `📢 *Mention Semua:*\n` +
  `- #tagall (mention semua tanpa pesan)\n` +
  `- #tagall [pesan] (mention semua + kirim pesan)\n\n` +
  `👢 *Kelola Anggota:*\n` +
  `- #kick @user\n` +
  `- #promote @user (jadikan admin)\n` +
  `- #demote @user (turunkan admin)\n\n` +
  `🙋 *Fitur Sambutan:*\n` +
  `- #welcome on / off\n\n` +
  `🔗 *Anti Link:*\n` +
  `- #antilinkh1 on / off (hapus link)\n` +
  `- #antilink22 on / off (kick jika kirim link)\n\n` +
  `🕐 *Pengaturan Grup:*\n` +
  `- #tutupgrup sekarang / [HH.MM]\n` +
  `- #bukagrup sekarang / [HH.MM]`,
quoted: msg
      });
    }

    // #owner (pribadi & grup)
    if (text === '#owner') {
      return sock.sendMessage(from, {
        text: `👑 Owner bot:\nwa.me/${owner.replace('@s.whatsapp.net', '')}`,
        quoted: msg
      });
    }

   // AKTIVASI BOT (hanya owner, hanya di grup, bot wajib admin)
    if (['#aktifkanbot1', '#aktifkanbot2', '#aktifkanbot3'].includes(text)) {
      if (sender !== owner) {
        return sock.sendMessage(from, {
          text: '🚫 *Hanya owner bot yang bisa mengaktifkan bot di grup ini.*',
          quoted: msg
        });
      }

      if (!isGroup) {
        return sock.sendMessage(from, {
          text: '🚫 Perintah ini hanya bisa digunakan di dalam grup.',
          quoted: msg
        });
      }

      if (sewa[from]) {
        return sock.sendMessage(from, {
          text: '✅ *Bot sudah aktif di grup ini.*',
          quoted: msg
        });
      }

      let meta;
      try {
        meta = await sock.groupMetadata(from);
      } catch (e) {
        return sock.sendMessage(from, {
          text: '❌ Gagal aktivasi. Grup tidak valid atau bot belum masuk.',
          quoted: msg
        });
      }

      const botId = sock.user.id.split(':')[0] + '@s.whatsapp.net';
      const botIsAdmin = meta.participants.find(p => p.id === botId)?.admin;

      if (!botIsAdmin) {
        return sock.sendMessage(from, {
          text: '❌ Bot harus menjadi *admin grup* terlebih dahulu.',
          quoted: msg
        });
      }

      const durasi = text === '#aktifkanbot1' ? 7 : text === '#aktifkanbot2' ? 30 : null;
      const label = durasi ? `${durasi} hari` : 'PERMANEN';
      const expire = durasi ? now + durasi * 86400000 : DURASI_PERMANEN;

      sewa[from] = {
  expire,
  features: {
    welcome: true,
    antilinkh1: false,
    antilink22: false,
    autoOpen: null,
    autoClose: null,
    lastAutoUpdate: null // ← Tambahkan ini
  }
};
      fs.writeJSONSync(sewaPath, sewa);

      return sock.sendMessage(from, {
        text:
          `✅ *Bot berhasil diaktifkan!*\n\n` +
          `📌 *ID Grup:* ${from}\n` +
          `⏳ *Durasi:* ${label}\n\n` +
          `⚠️ *Catatan:*\n` +
          `- Hanya *owner* yang bisa aktivasi.\n` +
          `- Bot harus jadi *admin*.\n` +
          `- Fitur hanya untuk *admin grup*.` ,
        quoted: msg
      });
    }

    // Cek masa sewa & keluar jika habis
    const expire = sewa[from]?.expire;
    if (isGroup && expire && now > expire) {
      await sock.sendMessage(from, { text: '⏰ Masa sewa habis. Bot keluar.' });
      delete sewa[from];
      fs.writeJSONSync(sewaPath, sewa);
      return sock.groupLeave(from);
    }

    // Abai jika grup belum aktif
    if (isGroup && !sewa[from]) return;

    // FITUR ADMIN (hanya admin grup atau owner)
    const fitur = sewa[from]?.features;
if (!fitur) return;
    const reply = m => ({ quoted: msg });

    // Anti link khusus untuk member (bukan admin/owner)
if (text.includes('chat.whatsapp.com')) {
  const meta = await sock.groupMetadata(from);
  const isSenderAdmin = meta.participants.find(p => p.id === sender)?.admin;

  if (sender !== owner && !isSenderAdmin) {
    // Kick jika fitur antilink22 aktif
    if (fitur.antilink22) {
      await sock.sendMessage(from, {
        text: `🚫 @${sender.split('@')[0]} mengirim link dan telah dikick.`,
        mentions: [sender]
      });
      return await sock.groupParticipantsUpdate(from, [sender], 'remove');
    }

    // Hapus pesan jika fitur antilinkh1 aktif
    if (fitur.antilinkh1) {
      return sock.sendMessage(from, { delete: msg.key });
    }
  }
}

    // Setelah antilink, baru filter admin
    if (isGroup && sender !== owner && !isAdmin) return;

    if (text === '#menu') {
      return sock.sendMessage(from, {
        text:
          `📋 *MENU ADMIN:*\n` +
          `#tagall [pesan]\n` +
          `#kick @user\n` +
          `#welcome on/off\n` +
          `#antilinkh1 on/off\n` +
          `#antilink22 on/off\n` +
          `#tutupgrup sekarang / [HH.MM]\n` +
          `#bukagrup sekarang / [HH.MM]` ,
        ...reply(msg)
      });
    }

    // Tagall
    if (text.startsWith('#tagall')) {
      const meta = await sock.groupMetadata(from);
      const mentions = meta.participants.map(p => p.id);
      const pesan = text.split(' ').slice(1).join(' ').trim() || '';
      return sock.sendMessage(from, { text: pesan, mentions, ...reply(msg) });
    }

    // Kick via reply atau @mention
if (text.startsWith('#kick')) {
  let toKick = [];

  // Jika reply
  if (msg.message?.extendedTextMessage?.contextInfo?.participant) {
    toKick = [msg.message.extendedTextMessage.contextInfo.participant];
  }

  // Jika pakai @mention
  const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
  if (mentioned?.length) {
    toKick = mentioned;
  }

  if (toKick.length === 0) {
    return sock.sendMessage(from, { text: '❌ Tag atau reply orang yang ingin di-kick.', ...reply(msg) });
  }

  await sock.groupParticipantsUpdate(from, toKick, 'remove');
  return sock.sendMessage(from, { text: '✅ Berhasil kick.', ...reply(msg) });
}


    // Welcome toggle
    if (text === '#welcome on') { fitur.welcome = true; fs.writeJSONSync(sewaPath, sewa); return sock.sendMessage(from, { text: '✅ Welcome aktif.', ...reply(msg) }); }
    if (text === '#welcome off') { fitur.welcome = false; fs.writeJSONSync(sewaPath, sewa); return sock.sendMessage(from, { text: '❌ Welcome nonaktif.', ...reply(msg) }); }

    // Antilink hapus
if (text === '#antilinkh1 on') {
  if (fitur.antilink22) {
    return sock.sendMessage(from, {
      text: '⚠️ Matikan dulu *antilink-kick* sebelum mengaktifkan antilink-hapus.',
      ...reply(msg)
    });
  }
  fitur.antilinkh1 = true;
  fs.writeJSONSync(sewaPath, sewa);
  return sock.sendMessage(from, { text: '✅ Antilink-hapus aktif.', ...reply(msg) });
}

if (text === '#antilinkh1 off') {
  fitur.antilinkh1 = false;
  fs.writeJSONSync(sewaPath, sewa);
  return sock.sendMessage(from, { text: '❌ Antilink-hapus mati.', ...reply(msg) });
}

// Antilink kick
if (text === '#antilink22 on') {
  if (fitur.antilinkh1) {
    return sock.sendMessage(from, {
      text: '⚠️ Matikan dulu *antilink-hapus* sebelum mengaktifkan antilink-kick.',
      ...reply(msg)
    });
  }
  fitur.antilink22 = true;
  fs.writeJSONSync(sewaPath, sewa);
  return sock.sendMessage(from, { text: '✅ Antilink-kick aktif.', ...reply(msg) });
}

if (text === '#antilink22 off') {
  fitur.antilink22 = false;
  fs.writeJSONSync(sewaPath, sewa);
  return sock.sendMessage(from, { text: '❌ Antilink-kick mati.', ...reply(msg) });
}

    // Tutup / buka sekarang
    if (text === '#tutupgrup sekarang') { await sock.groupSettingUpdate(from, 'announcement'); return sock.sendMessage(from, { text: '🔒 Grup ditutup sekarang.', ...reply(msg) }); }
    if (text === '#bukagrup sekarang') { await sock.groupSettingUpdate(from, 'not_announcement'); return sock.sendMessage(from, { text: '🔓 Grup dibuka sekarang.', ...reply(msg) }); }

    // Set jadwal tutup/buka harian
    if (text.startsWith('#tutupgrup ')) {
      const jam = text.split(' ')[1];
      if (!/^\d{2}\.\d{2}$/.test(jam)) return sock.sendMessage(from, { text: 'Format: #tutupgrup HH.MM' });
      fitur.autoClose = jam.replace('.', ':');
      fs.writeJSONSync(sewaPath, sewa);
      return sock.sendMessage(from, { text: `✅ Grup akan *ditutup otomatis* hari ini pukul ${jam}.`, ...reply(msg) });
    }

    if (text.startsWith('#bukagrup ')) {
      const jam = text.split(' ')[1];
      if (!/^\d{2}\.\d{2}$/.test(jam)) return sock.sendMessage(from, { text: 'Format: #bukagrup HH.MM' });
      fitur.autoOpen = jam.replace('.', ':');
      fs.writeJSONSync(sewaPath, sewa);
      return sock.sendMessage(from, { text: `✅ Grup akan *dibuka otomatis* hari ini pukul ${jam}.`, ...reply(msg) });
    }
  });
}

// Mulai bot
startBot();

const warningPath = './warning.json';
if (!fs.existsSync(warningPath)) fs.writeJSONSync(warningPath, {});
let warningData = fs.readJSONSync(warningPath);


// === Express server untuk panel owner ===
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname)); // supaya bisa akses owner.html

app.get('/sewa.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'sewa.json'));
});

app.listen(PORT, () => {
  console.log(`🌐 Web owner aktif di http://localhost:${PORT}`);
});
