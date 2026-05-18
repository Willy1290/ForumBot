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

client.once('ready', async () => {
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
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'delete') {

        const thread = interaction.channel;

        // cek apakah forum/thread
        if (!thread.isThread()) {
            return interaction.reply({
                content: 'Command ini hanya bisa dipakai di forum post.',
                ephemeral: true
            });
        }

        // cek owner
        const isOwner = thread.ownerId === interaction.user.id;

        // cek moderator
        const isModerator =
            interaction.member.permissions.has('ManageThreads');

        if (!isOwner && !isModerator) {
            return interaction.reply({
                content: 'Kamu bukan pemilik forum post ini.',
                ephemeral: true
            });
        }

        await interaction.reply({
            content: 'Forum post akan dihapus...',
            ephemeral: true
        });

        await thread.delete();
    }
});

client.login(TOKEN);