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
        "1010010101111000110110100011001001100000100011100011010000100101",
        "1101001011000000100110100001111000101110001111100110100001100010",
        "1101001011000000100110100001111000101110001111100110100001100010",
        "0011000111001100110011011011001101101011110100111010111111001110",
        "1000000111010001011100010111100100001110100111101000111001110001",
        "1001100100110110001101101001101100100110101100110011011000100110",
        "1101100111000110001001101101100100110110110101100000100100001001",
        "1111000101000110001011101101000100011001101010000000111011110000",
        "1010010100001110010000111010110110101101000100101111000011100001",
        "1101001011101101001011010001001000101101100101001001101000100101",
        "0011000111001110110011101010011000110010011001101100111100111001",
        "1110000111000001000111100001110100111100011000001100000010000001",
        "1100010000011011100111001111110110011011110001000001101110000101",
        "1101101111000100001001001101101100100100111001001101101100000000",
        "0110011001100011100110011100011010010001110010010000101001100110",
        "1000111000111100100001000111011101110011011100110111001101110001",
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
// =========================
// AUTO MODERATION GAMBAR: DATASET + CROSS-CHANNEL
// =========================
const ATTACHMENT_WINDOW_MS = 2 * 1000;
const MIN_CHANNELS = 3;
// In-memory tracker; reset ketika bot restart/redeploy.
const attachmentTracker = new Map();
// Mencegah dua listener memproses pesan yang sama secara bersamaan.
const processingMessages = new Set();
const processingUsers = new Set();

function isImageAttachment(file) {
  return Boolean(file.contentType?.startsWith('image/')) || /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(file.name || '');
}

async function getMemberForMessage(message) {
  if (!message.guild) return null;
  return message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
}

function isExemptFromAutoModeration(message, member) {
  if (!message.guild || !member) return false;
  if (message.author.id === message.guild.ownerId) return true;
  return member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageThreads);
}

async function getLogChannel() {
  if (!LOG_CHANNEL_ID) throw new Error('LOG_CHANNEL_ID belum diatur.');
  const channel = await client.channels.fetch(LOG_CHANNEL_ID);
  if (!channel || !channel.isTextBased() || !channel.send) {
    throw new Error('LOG_CHANNEL_ID bukan channel teks yang dapat mengirim pesan.');
  }
  return channel;
}

function makeImageEvidenceEmbed(record, title, color, extraFields = []) {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .addFields(
      { name: 'User', value: `${record.authorTag || 'Unknown'} (${record.userId})` },
      { name: 'Channel', value: `<#${record.channelId}>` },
      { name: 'Message ID', value: record.messageId },
      { name: 'Waktu', value: `<t:${Math.floor(record.timestamp / 1000)}:F>` },
      { name: 'pHash', value: `\`${record.hash}\`` },
      ...extraFields
    )
    .setTimestamp(new Date(record.timestamp));
  if (record.imageUrl) embed.setImage(record.imageUrl);
  return embed;
}

async function logEvidenceBeforeAction(title, color, records, extraFieldsByIndex = []) {
  const logChannel = await getLogChannel();
  const embeds = records.map((record, index) => makeImageEvidenceEmbed(
    record, title, color, extraFieldsByIndex[index] || []
  ));
  // Kirim bukti dahulu. Jika log gagal, caller tidak boleh menghapus/softban.
  await logChannel.send({ embeds });
}

async function deleteTrackedMessages(records) {
  const failures = [];
  for (const record of records) {
    try {
      const channel = await client.channels.fetch(record.channelId);
      const msg = await channel.messages.fetch(record.messageId);
      await msg.delete();
    } catch (error) {
      failures.push(`${record.messageId}: ${error.message}`);
      console.error(`[AutoMod] Gagal menghapus pesan ${record.messageId}:`, error.message);
    }
  }
  return failures;
}

async function softbanUser(guild, userId, reason) {
  // Softban = ban tanpa menghapus histori pesan secara massal, lalu langsung unban.
  await guild.members.ban(userId, { deleteMessageSeconds: 0, reason });
  try {
    await guild.members.unban(userId, `Softban selesai: ${reason}`);
    return { success: true, unbanFailed: false };
  } catch (error) {
    console.error(`[AutoMod] User ${userId} berhasil diban tetapi gagal di-unban:`, error.message);
    return { success: false, unbanFailed: true, error: error.message };
  }
}

async function handleDatasetMatch(message, record, match) {
  const member = await getMemberForMessage(message);
  if (isExemptFromAutoModeration(message, member)) {
    console.log(`[pHash] Dataset match, tetapi user exempt: ${message.author.tag} (${message.author.id})`);
    return;
  }
  if (PHASH_DRY_RUN) {
    console.log(`[pHash] DRY RUN: dataset match ${message.id}; tidak ada tindakan.`);
    return;
  }

  const reference = REFERENCE_HASHES.reduce((best, hash) => {
    const d = distance(record.hash, hash);
    return !best || d < best.distance ? { hash, distance: d } : best;
  }, null);
  const extra = [[
    { name: 'Tipe Deteksi', value: 'Dataset pHash' },
    { name: 'Reference pHash', value: `\`${reference?.hash || 'Tidak diketahui'}\`` },
    { name: 'Jarak pHash', value: `${match.distance} (batas ${PHASH_THRESHOLD})` },
    { name: 'Tindakan', value: 'Bukti dicatat → pesan dihapus → softban' }
  ]];
  await logEvidenceBeforeAction('🚨 PHASH MATCH — DATASET', 'Red', [record], extra);

  const deleteFailures = await deleteTrackedMessages([record]);
  const banResult = await softbanUser(message.guild, message.author.id, `Softban otomatis: gambar cocok dataset pHash (jarak ${match.distance})`);
  const logChannel = await getLogChannel();
  await logChannel.send({ embeds: [new EmbedBuilder()
    .setColor(banResult.success ? 'DarkRed' : 'Orange')
    .setTitle('Hasil Tindakan — PHASH MATCH')
    .addFields(
      { name: 'User ID', value: message.author.id },
      { name: 'Pesan berhasil dihapus', value: deleteFailures.length ? `Tidak semua: ${deleteFailures.join('\n').slice(0, 900)}` : 'Ya' },
      { name: 'Softban', value: banResult.success ? 'Berhasil (ban lalu unban)' : `Tidak tuntas: ${banResult.error || 'gagal unban'}` }
    ).setTimestamp()] });
}

async function handleCrossChannelMatch(guild, userId, records, pairDistances) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (isExemptFromAutoModeration({ guild, author: { id: userId } }, member)) {
    console.log(`[Cross-channel] User exempt, tidak dimoderasi: ${userId}`);
    return;
  }

  const extras = records.map((record, index) => {
    const comparisons = pairDistances
      .filter(pair => pair.a === index || pair.b === index)
      .map(pair => `Gambar ${pair.a + 1} ↔ ${pair.b + 1}: ${pair.distance}`)
      .join('\n') || '—';
    return [
      { name: 'Tipe Deteksi', value: 'Cross-channel pHash (bukan dataset)' },
      { name: 'Jumlah channel unik', value: `${new Set(records.map(r => r.channelId)).size}` },
      { name: 'Jarak pHash antar-gambar', value: comparisons },
      { name: 'Window waktu', value: `${ATTACHMENT_WINDOW_MS / 1000} detik` }
    ];
  });
  await logEvidenceBeforeAction('🚨 CROSS-CHANNEL MATCH — 3 GAMBAR MIRIP', 'DarkRed', records, extras);

  const deleteFailures = await deleteTrackedMessages(records);
  const result = await softbanUser(guild, userId, `Softban otomatis: ${records.length} gambar mirip di ${new Set(records.map(r => r.channelId)).size} channel dalam 2 detik`);
  const logChannel = await getLogChannel();
  await logChannel.send({ embeds: [new EmbedBuilder()
    .setColor(result.success ? 'DarkRed' : 'Orange')
    .setTitle('Hasil Tindakan — CROSS-CHANNEL MATCH')
    .addFields(
      { name: 'User ID', value: userId },
      { name: 'Pesan berhasil dihapus', value: deleteFailures.length ? `Tidak semua: ${deleteFailures.join('\n').slice(0, 900)}` : 'Semua pesan target berhasil dihapus' },
      { name: 'Softban', value: result.success ? 'Berhasil (ban lalu unban)' : `Tidak tuntas: ${result.error || 'gagal unban'}` }
    ).setTimestamp()] });
}

client.on('messageCreate', async message => {
  if (message.author.bot) return;

  // Perintah manual untuk memperoleh pHash referensi.
  if (message.content.trim() === '!phash') {
    const attachment = message.attachments.find(isImageAttachment);
    if (!attachment) {
      await message.reply('Lampirkan satu gambar bersama perintah !phash.');
      return;
    }
    try {
      const hash = await getImageHash(attachment.url);
      await message.reply({ content: `Hash gambar referensi:\n\`${hash}\``, allowedMentions: { repliedUser: false } });
    } catch (error) {
      console.error('Gagal menghitung hash:', error);
      await message.reply('Gagal menghitung hash gambar.');
    }
    return;
  }

  if (!message.guild || message.attachments.size === 0 || processingMessages.has(message.id)) return;
  const images = [...message.attachments.values()].filter(isImageAttachment);
  if (!images.length) return;
  processingMessages.add(message.id);

  try {
    const member = await getMemberForMessage(message);
    if (isExemptFromAutoModeration(message, member)) return;

    // Proses gambar untuk dataset dan simpan pHash agar bisa dibandingkan lintas channel.
    const newRecords = [];
    for (const image of images) {
      try {
        const hash = await getImageHash(image.url);
        const timestamp = message.createdTimestamp || Date.now();
        const record = {
          userId: message.author.id,
          authorTag: message.author.tag,
          guildId: message.guild.id,
          channelId: message.channelId,
          channelName: message.channel?.name || message.channelId,
          messageId: message.id,
          timestamp,
          imageUrl: image.url,
          hash
        };
        newRecords.push(record);
        const datasetMatch = findMatchingHash(hash);
        if (datasetMatch.matched) {
          // Hindari beberapa tindakan bersamaan untuk user yang sama.
          if (processingUsers.has(message.author.id)) return;
          processingUsers.add(message.author.id);
          try { await handleDatasetMatch(message, record, datasetMatch); }
          finally { processingUsers.delete(message.author.id); }
          return;
        }
      } catch (error) {
        console.error(`[pHash] Gagal memproses gambar ${image.name || image.id}:`, error.message);
      }
    }

    if (!newRecords.length) return;
    const userId = message.author.id;
    const now = Date.now();
    let records = (attachmentTracker.get(userId) || [])
      .filter(record => now - record.timestamp <= ATTACHMENT_WINDOW_MS && record.guildId === message.guild.id);
    records.push(...newRecords);
    // Maksimal satu rekaman per message/image untuk analisis; hanya butuh tiga gambar.
    records = records.slice(-12);
    attachmentTracker.set(userId, records);

    if (processingUsers.has(userId)) return;
    const candidate = records.filter(record => record.timestamp >= now - ATTACHMENT_WINDOW_MS);
    const uniqueChannels = new Set(candidate.map(record => record.channelId));
    if (uniqueChannels.size < MIN_CHANNELS) return;

    // Cari kombinasi tiga gambar dari tiga channel berbeda yang semuanya mirip satu sama lain.
    let found = null;
    for (let i = 0; i < candidate.length && !found; i++) {
      for (let j = i + 1; j < candidate.length && !found; j++) {
        if (candidate[i].channelId === candidate[j].channelId) continue;
        const d1 = distance(candidate[i].hash, candidate[j].hash);
        if (d1 > PHASH_THRESHOLD) continue;
        for (let k = j + 1; k < candidate.length; k++) {
          if (new Set([candidate[i].channelId, candidate[j].channelId, candidate[k].channelId]).size !== 3) continue;
          const d2 = distance(candidate[i].hash, candidate[k].hash);
          const d3 = distance(candidate[j].hash, candidate[k].hash);
          if (d2 <= PHASH_THRESHOLD && d3 <= PHASH_THRESHOLD) {
            found = { records: [candidate[i], candidate[j], candidate[k]], distances: [
              { a: 0, b: 1, distance: d1 }, { a: 0, b: 2, distance: d2 }, { a: 1, b: 2, distance: d3 }
            ] };
            break;
          }
        }
      }
    }
    if (!found) return;

    processingUsers.add(userId);
    attachmentTracker.delete(userId);
    try {
      await handleCrossChannelMatch(message.guild, userId, found.records, found.distances);
    } catch (error) {
      // Jika log bukti gagal, fungsi belum menghapus/softban; jangan lanjutkan tindakan.
      console.error('[Cross-channel] Deteksi/tindakan gagal:', error.message);
    } finally {
      processingUsers.delete(userId);
    }
  } catch (error) {
    console.error('[AutoMod] Error pada messageCreate:', error);
  } finally {
    processingMessages.delete(message.id);
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