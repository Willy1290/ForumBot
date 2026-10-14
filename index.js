const {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    REST,
    Routes,
    PermissionFlagsBits,
    EmbedBuilder,
    ChannelType
} = require('discord.js');

const express = require('express');
const phash = require("sharp-phash");
const distance = require("sharp-phash/distance");
const { PrismaClient } = require('@prisma/client');
const { PrismaNeon } = require('@prisma/adapter-neon');
const { Pool } = require('@neondatabase/serverless');


const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

const adapter = new PrismaNeon(pool);

const prisma = new PrismaClient({ adapter });

console.log('DATABASE_URL exists:', !!process.env.DATABASE_URL);

const app = express();

app.get('/', (req, res) => {
    res.send('Bot aktif');
});

app.listen(3000, () => {
    console.log('Web server aktif');
});

// =========================
// KEEP-ALIVE (anti-sleep Render)
// =========================

const RENDER_URL = process.env.RENDER_URL || 'http://localhost:3000';

setInterval(async () => {
    try {
        const res = await fetch(RENDER_URL);
        console.log(`[Keep-alive] Ping OK — ${new Date().toISOString()}`);
    } catch (error) {
        console.error('[Keep-alive] Ping gagal:', error.message);
    }
}, 60 * 1000); // setiap 1 menit

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        // Diperlukan lagi untuk fitur anti-spam attachment lintas channel:
        // bot perlu baca pesan & attachment yang masuk di semua channel.
        // PENTING: Aktifkan "MESSAGE CONTENT INTENT" di Discord Developer
        // Portal -> Bot -> Privileged Gateway Intents, atau bot akan error saat login.
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

console.log(require('@prisma/client/package.json').version);

const REFERENCE_HASHES = [
  "0011110101111001011000110000100010000110100101100111000001110001",
  "1010010100001110010000111010110110101101000100101111000011100001",
  "1101001011101101001011010001001000101101100101001001101000100101",
  "0011000111001110110011101010011000110010011001101100111100111001",
];;

// Semakin kecil nilainya, semakin ketat pencocokannya.
const PHASH_THRESHOLD = 3;

// true = hanya mendeteksi dan mencatat, belum menghapus.
const PHASH_DRY_RUN = false;

// Menghitung pHash dari URL gambar.
async function getImageHash(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Gagal mengambil gambar: HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";

  if (!contentType.startsWith("image/")) {
    throw new Error("URL tersebut bukan file gambar.");
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  // Batasi ukuran gambar agar bot tidak memproses file terlalu besar.
  if (buffer.length > 8 * 1024 * 1024) {
    throw new Error("Ukuran gambar melebihi 8 MB.");
  }

  return await phash(buffer);
}

// Mencari referensi dengan jarak hash paling kecil.
function findMatchingHash(newHash) {
  let bestDistance = Infinity;

  for (const referenceHash of REFERENCE_HASHES) {
    if (!/^[01]{64}$/.test(referenceHash)) {
      console.warn("Ada hash referensi yang formatnya tidak valid.");
      continue;
    }

    const currentDistance = distance(newHash, referenceHash);

    if (currentDistance < bestDistance) {
      bestDistance = currentDistance;
    }
  }

  return {
    matched: bestDistance <= PHASH_THRESHOLD,
    distance: bestDistance,
  };
}

// =========================
// SLASH COMMAND
// =========================

const commands = [

    new SlashCommandBuilder()
        .setName('delete')
        .setDescription('Hapus forum post milikmu'),

    new SlashCommandBuilder()
        .setName('search')
        .setDescription('Cari riwayat pelanggaran user')
        .addStringOption(option =>
            option
                .setName('user')
                .setDescription('User ID atau username')
                .setRequired(true)
        )
        // Hanya terlihat & bisa dipakai oleh Mod (ManageThreads) atau Admin
        // User biasa tidak akan melihat command ini sama sekali
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageThreads |
            PermissionFlagsBits.Administrator
        )

].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

// =========================
// READY
// =========================

client.once('ready', async () => { // FIX 2: 'clientReady' → 'ready' (nama event yang benar)

    console.log(`Login sebagai ${client.user.tag}`);

    try {

        await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
            { body: commands }
        );

        console.log('Slash command berhasil dibuat');

    } catch (error) {

        // FIX 3: Hapus referensi 'interaction' yang tidak ada di scope ini.
        // Di sini hanya log error saja, tidak ada interaction yang bisa direply.
        console.error('ERROR registrasi command:', error);

    }

});

// =========================
// INTERACTION
// =========================

client.on('interactionCreate', async interaction => {

    try {

        if (!interaction.isChatInputCommand()) return;

        // =========================
        // COMMAND: SEARCH
        // =========================

        if (interaction.commandName === 'search') {

            // Hanya admin
            if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return interaction.reply({
                    content: 'Hanya admin yang dapat menggunakan command ini.',
                    ephemeral: true
                });
            }

            const query = interaction.options.getString('user');

            const user = await prisma.discordUser.findFirst({
                where: {
                    OR: [
                        { id: query },
                        { username: { contains: query } }
                    ]
                }
            });

            if (!user) {
                return interaction.reply({
                    content: 'User tidak ditemukan dalam database.',
                    ephemeral: true
                });
            }

            const totalAttempts = await prisma.warnAttempt.count({
                where: { userId: user.id }
            });

            const history = await prisma.warnAttempt.findMany({
                where: { userId: user.id },
                orderBy: { createdAt: 'desc' },
                take: 10
            });

            let historyText = '';

            if (history.length === 0) {
                historyText = 'Tidak ada riwayat.';
            } else {
                history.forEach((attempt, index) => {
                    historyText +=
                        `${index + 1}. ${attempt.threadName}\n` +
                        `Count: ${attempt.attemptCount}\n` +
                        `Date: <t:${Math.floor(attempt.createdAt.getTime() / 1000)}:F>\n\n`;
                });
            }

            const embed = new EmbedBuilder()
                .setColor('Orange')
                .setTitle('🔍 Violation Search')
                .addFields(
                    { name: 'Username', value: user.username },
                    { name: 'User ID', value: user.id },
                    { name: 'Total Delete Attempts', value: `${totalAttempts}` },
                    { name: 'Recent History', value: historyText.slice(0, 1024) }
                )
                .setTimestamp();

            return interaction.reply({ embeds: [embed], ephemeral: true });

        }

        // =========================
        // COMMAND: DELETE
        // =========================

        // FIX 4: Hapus double check yang redundant (ada dua if !== 'delete' berturut-turut)
        if (interaction.commandName !== 'delete') return;

        const channel = await client.channels.fetch(interaction.channelId);

        if (!channel) {
            return interaction.reply({
                content: 'Channel tidak ditemukan.',
                ephemeral: true
            });
        }

        // Pastikan forum/thread
        if (
            channel.type !== ChannelType.PublicThread &&
            channel.type !== ChannelType.PrivateThread
        ) {
            return interaction.reply({
                content: 'Gunakan command ini di forum post.',
                ephemeral: true
            });
        }

        const isOwner = channel.ownerId === interaction.user.id;
        const isModerator = interaction.member.permissions.has(PermissionFlagsBits.ManageThreads);

        // =========================
        // UNAUTHORIZED
        // =========================

        if (!isOwner && !isModerator) {

            // Cari atau buat user
            let user = await prisma.discordUser.findUnique({
                where: { id: interaction.user.id }
            });

            if (!user) {
                user = await prisma.discordUser.create({
                    data: {
                        id: interaction.user.id,
                        username: interaction.user.tag
                    }
                });
            }

            const totalAttempts = await prisma.warnAttempt.count({
                where: { userId: interaction.user.id }
            });

            await prisma.warnAttempt.create({
                data: {
                    userId: interaction.user.id,
                    threadName: channel.name,
                    attemptCount: totalAttempts + 1
                }
            });

            const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);

            if (logChannel) {
                const warnEmbed = new EmbedBuilder()
                    .setColor('Red')
                    .setTitle('⚠️ Unauthorized Delete Attempt')
                    .addFields(
                        { name: 'User', value: interaction.user.tag },
                        { name: 'User ID', value: interaction.user.id },
                        { name: 'Thread', value: channel.name },
                        { name: 'Violations', value: `${totalAttempts + 1}` }
                    )
                    .setTimestamp();

                await logChannel.send({ embeds: [warnEmbed] });
            }

            return interaction.reply({
                content: 'Kamu bukan pemilik forum post ini.',
                ephemeral: true
            });

        }
		
		
        // =========================
        // DELETE SUCCESS
        // =========================

        await interaction.deferReply({ ephemeral: true });

        const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);

        // FIX 5: Kirim log SEBELUM delete channel, karena setelah channel
        // dihapus kita masih bisa kirim ke logChannel (channel berbeda).
        // Dan channel.delete() hanya dipanggil SEKALI (sebelumnya dipanggil dua kali).
        if (logChannel) {
            const deleteEmbed = new EmbedBuilder()
                .setColor('Green')
                .setTitle('🗑️ Forum Deleted')
                .addFields(
                    { name: 'Thread', value: channel.name },
                    { name: 'Deleted By', value: interaction.user.tag },
                    { name: 'User ID', value: interaction.user.id },
                    { name: 'Moderator', value: `${isModerator}` },
                    { name: 'Owner', value: `${isOwner}` }
                )
                .setTimestamp();

            await logChannel.send({ embeds: [deleteEmbed] });
        }

        // Edit reply dulu sebelum channel dihapus
        await interaction.editReply({ content: 'Forum berhasil dihapus.' });

        // Hapus channel — hanya sekali
        await channel.delete();

        console.log('Forum berhasil dihapus');

    } catch (error) {
        console.error(error);
    }

});
client.on("messageCreate", async (message) => {
  // Abaikan pesan dari bot.
  if (message.author.bot) return;

  // Mode percobaan: kirim !phash bersama satu gambar.
  if (message.content.trim() === "!phash") {
    const attachment = message.attachments.find((file) =>
      file.contentType?.startsWith("image/")
    );

    if (!attachment) {
      await message.reply("Lampirkan satu gambar bersama perintah !phash.");
      return;
    }

    try {
      const hash = await getImageHash(attachment.url);

      await message.reply({
        content: `Hash gambar referensi:\n\`${hash}\``,
        allowedMentions: { repliedUser: false },
      });
    } catch (error) {
      console.error("Gagal menghitung hash:", error);
      await message.reply("Gagal menghitung hash gambar.");
    }

    return;
  }

  // Periksa gambar yang dikirim dalam pesan biasa.
  const images = message.attachments.filter((file) =>
    file.contentType?.startsWith("image/")
  );

  if (images.size === 0 || REFERENCE_HASHES.length === 0) return;

  for (const image of images.values()) {
    try {
      const newHash = await getImageHash(image.url);
      const result = findMatchingHash(newHash);

      if (!result.matched) continue;

      console.log(
        `[pHash] Gambar mirip terdeteksi! ` +
        `User: ${message.author.tag}, ` +
        `Jarak hash: ${result.distance}, ` +
        `Pesan: ${message.id}`
      );

      if (PHASH_DRY_RUN) {
        console.log("[pHash] DRY RUN: pesan belum dihapus.");
        continue;
      }

      // Penghapusan otomatis akan diaktifkan pada tahap berikutnya.
      await message.delete();
      break;
    } catch (error) {
      console.error("[pHash] Gagal memproses gambar:", error);
    }
  }
});


// =========================
// ANTI-SPAM: Attachment Lintas Channel
// =========================
// Jika satu user kirim attachment ke 2+ channel berbeda dalam 5 detik,
// dianggap spam/scam bot -> ban permanen + hapus semua pesan attachment tadi.

const ATTACHMENT_WINDOW_MS = 2 * 1000; 
const MIN_CHANNELS = 2;                

// Menyimpan jejak attachment per user: userId -> [{ channelId, messageId, timestamp }]
const attachmentTracker = new Map();

client.on('messageCreate', async message => {

    try {

        // Abaikan bot & pesan tanpa attachment
        if (message.author.bot) return;
        if (message.attachments.size === 0) return;

        const userId = message.author.id;
        const now = Date.now();

        // Ambil/inisialisasi jejak user ini
        let records = attachmentTracker.get(userId) || [];

        // Buang record yang sudah lewat window waktu
        records = records.filter(r => now - r.timestamp <= ATTACHMENT_WINDOW_MS);

        // Tambah record baru untuk pesan ini
        records.push({
            channelId: message.channelId,
            messageId: message.id,
            timestamp: now
        });

        attachmentTracker.set(userId, records);

        // Hitung jumlah channel UNIK dalam window waktu
        const uniqueChannels = new Set(records.map(r => r.channelId));

        if (uniqueChannels.size >= MIN_CHANNELS) {

            // Hapus jejak user supaya tidak ke-trigger berkali-kali
            attachmentTracker.delete(userId);

            // Hapus semua pesan attachment yang terdeteksi tadi
            for (const record of records) {
                try {
                    const ch = await client.channels.fetch(record.channelId);
                    const msg = await ch.messages.fetch(record.messageId);
                    await msg.delete();
                } catch (deleteError) {
                    console.error(
                        `Gagal hapus pesan ${record.messageId} di channel ${record.channelId}:`,
                        deleteError.message
                    );
                }
            }

            // Ban permanen
            try {
                await message.guild.members.ban(userId, {
                    reason: `Auto-ban: spam attachment di ${uniqueChannels.size} channel berbeda dalam ${ATTACHMENT_WINDOW_MS / 1000} detik`
                });
            } catch (banError) {
                console.error('Gagal ban user:', banError.message);
            }

            // Log ke channel log
            const logChannel = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);

            if (logChannel) {
                const spamEmbed = new EmbedBuilder()
                    .setColor('DarkRed')
                    .setTitle('Auto-Ban: Spam Attachment Terdeteksi')
                    .addFields(
                        { name: 'User', value: message.author.tag },
                        { name: 'User ID', value: userId },
                        { name: 'Jumlah Channel', value: `${uniqueChannels.size}` },
                        { name: 'Pesan Dihapus', value: `${records.length}` },
                        { name: 'Window Waktu', value: `${ATTACHMENT_WINDOW_MS / 1000} detik` }
                    )
                    .setTimestamp();

                await logChannel.send({ embeds: [spamEmbed] });
            }

            console.log(`Auto-ban: ${message.author.tag} (${userId}) — spam attachment di ${uniqueChannels.size} channel`);

        }

    } catch (error) {
        console.error('Error di anti-spam attachment:', error);
    }

});

// =========================
// ERROR HANDLER
// =========================

process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', error => {
    console.error('Uncaught exception:', error);
});

// =========================
// LOGIN
// =========================

client.login(TOKEN);