const express = require('express');
const app = express();
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
const {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    REST,
    Routes,
	PermissionFlagsBits,
	EmbedBuilder
} = require('discord.js');

app.get('/health', (_, res) => {
    res.status(30000).send('Bot aktif');
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
const deleteAttempts = new Map();
client.on('interactionCreate', async interaction => {

    try {

        if (!interaction.isChatInputCommand()) return;

        if (interaction.commandName !== 'delete') return;

        // Ambil forum post/thread
        const channel = interaction.channel;

        console.log(channel);

        // Kalau gagal ambil channel
        if (!channel) {

            return interaction.reply({
                content: 'Channel tidak ditemukan.',
                ephemeral: true
            });

        }

        // Cek apakah thread/forum post
        if (
            channel.type !== 11 &&
            channel.type !== 12
        ) {

            return interaction.reply({
                content: 'Gunakan command ini di dalam forum post.',
                ephemeral: true
            });

        }

        // Cek owner
        const isOwner =
            channel.ownerId === interaction.user.id;

        // Cek moderator
        const isModerator =
            interaction.member.permissions.has(
                PermissionFlagsBits.ManageThreads
            );

        // Kalau bukan owner/mod
        if (!isOwner && !isModerator) {

			const current =
				deleteAttempts.get(interaction.user.id) || 0;

			deleteAttempts.set(
				interaction.user.id,
				current + 1
			);

			const logChannel =
				await client.channels.fetch(LOG_CHANNEL_ID);

			if (logChannel) {
				const warnEmbed = new EmbedBuilder()
					.setColor('Red')
					.setTitle('⚠️ Unauthorized Delete Attempt')
					.addFields(
						{
							name: 'User',
							value: interaction.user.tag
						},
						{
							name: 'User ID',
							value: interaction.user.id
						},
						{
							name: 'Thread',
							value: channel.name
						},
						{
							name: 'Attempts',
							value: `${current + 1}`
						}
					)
					.setTimestamp();

				await logChannel.send({
					embeds: [warnEmbed]
				});
			}

			return interaction.reply({
				content: 'Kamu bukan pemilik forum post ini.',
				ephemeral: true
			});

		}

		await interaction.deferReply({
            ephemeral: true
        });
		const logChannel =
    await client.channels.fetch(LOG_CHANNEL_ID);

		if (logChannel) {
			const deleteEmbed = new EmbedBuilder()
				.setColor('Green')
				.setTitle('🗑️ Forum Deleted')
				.addFields(
					{
						name: 'Thread',
						value: channel.name
					},
					{
						name: 'Deleted By',
						value: `${interaction.user.tag}`
					},
					{
						name: 'User ID',
						value: interaction.user.id
					},
					{
						name: 'Moderator',
						value: `${isModerator}`
					},
					{
						name: 'Owner',
						value: `${isOwner}`
					}
				)
				.setTimestamp();
			await logChannel.send({embeds: [deleteEmbed]
			});
		}

        // Hapus forum post
        await channel.delete();
		console.log('Forum post akan dihapus');

    } catch (error) {

        console.error('ERROR:', error);
    }
});

process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', error => {
    console.error('Uncaught exception:', error);
});

setInterval(async () => {

    try {
        const response = await fetch(
            'https://forumbot-dqqe.onrender.com/'
        );
        console.log(
            `Self ping: ${response.status}`
        );
    } catch (error) {
        console.error('Self ping error:', error);
    }

}, 300000);

client.login(TOKEN);