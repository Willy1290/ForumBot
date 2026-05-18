const express = require('express');
const app = express();
const {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    REST,
    Routes
} = require('discord.js');
app.get('/', (req, res) => {
    res.send('Bot aktif');
});

app.listen(3000, () => {
    console.log('Web server aktif');
});

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages
    ]
});

client.once('clientReady', async () => {
    console.log(`Login sebagai ${client.user.tag}`);

    const commands = [
        new SlashCommandBuilder()
            .setName('delete')
            .setDescription('Hapus forum post milikmu')
            .toJSON()
    ];

    const rest = new REST({ version: '10' }).setToken(TOKEN);

    try {
        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            { body: commands }
        );

        console.log('Slash command berhasil dibuat');
    } catch (err) {
        console.error(err);
    }
});

client.on('interactionCreate', async interaction => {

    try {

        if (!interaction.isChatInputCommand()) return;

        if (interaction.commandName !== 'delete') return;

        // Ambil channel langsung
        const channel = interaction.channel;

        console.log(channel);

        // Cek apakah channel ada
        if (!channel) {

            return interaction.reply({
                content: 'Channel tidak ditemukan.',
                ephemeral: true
            });

        }

        // Cek apakah forum/thread
        if (
            channel.type !== 11 &&
            channel.type !== 12
        ) {

            return interaction.reply({
                content: 'Gunakan command ini di dalam forum post.',
                ephemeral: true
            });

        }

        // Owner forum post
        const isOwner =
            channel.ownerId === interaction.user.id;

        // Moderator
        const isModerator =
            interaction.member.permissions.has(
                PermissionFlagsBits.ManageThreads
            );

        // Bukan owner/mod
        if (!isOwner && !isModerator) {

            return interaction.reply({
                content: 'Kamu bukan pemilik forum post ini.',
                ephemeral: true
            });

        }

        await interaction.reply({
            content: '🗑️ Forum post akan dihapus...',
            ephemeral: true
        });

        // Hapus forum post
        await channel.delete();

    } catch (error) {

        console.error(error);

    }
});

client.login(TOKEN);