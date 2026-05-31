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

const { PrismaClient } = require('@prisma/client');

console.log("DATABASE_URL exists:", !!process.env.DATABASE_URL);

const prisma = new PrismaClient();

const app = express();

app.get('/', (req, res) => {
    res.send('Bot aktif');
});

app.listen(3000, () => {
    console.log('Web server aktif');
});

const TOKEN = process.env.TOKEN;

const CLIENT_ID = process.env.CLIENT_ID;

const GUILD_ID = process.env.GUILD_ID;

const LOG_CHANNEL_ID =
    process.env.LOG_CHANNEL_ID;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// =========================
// SLASH COMMAND
// =========================

const commands = [
    new SlashCommandBuilder()
        .setName('delete')
        .setDescription(
            'Hapus forum post milikmu'
        )
].map(command => command.toJSON());

const rest = new REST({
    version: '10'
}).setToken(TOKEN);

// =========================
// READY
// =========================

client.once('clientReady', async () => {

    console.log(
        `Login sebagai ${client.user.tag}`
    );

    try {

        await rest.put(
            Routes.applicationGuildCommands(
                CLIENT_ID,
                GUILD_ID
            ),
            {
                body: commands
            }
        );

        console.log(
            'Slash command berhasil dibuat'
        );

    } catch (error) {

        console.error(error);

    }

});

// =========================
// INTERACTION
// =========================

client.on(
    'interactionCreate',
    async interaction => {

        try {

            if (
                !interaction.isChatInputCommand()
            ) return;

            if (
                interaction.commandName !==
                'delete'
            ) return;

            const channel =
                await client.channels.fetch(
                    interaction.channelId
                );

            if (!channel) {

                return interaction.reply({
                    content:
                        'Channel tidak ditemukan.',
                    ephemeral: true
                });

            }

            // Pastikan forum/thread
            if (
                channel.type !==
                    ChannelType.PublicThread &&
                channel.type !==
                    ChannelType.PrivateThread
            ) {

                return interaction.reply({
                    content:
                        'Gunakan command ini di forum post.',
                    ephemeral: true
                });

            }

            // Owner
            const isOwner =
                channel.ownerId ===
                interaction.user.id;

            // Moderator
            const isModerator =
                interaction.member.permissions.has(
                    PermissionFlagsBits.ManageThreads
                );

            // =========================
            // UNAUTHORIZED
            // =========================

            if (!isOwner && !isModerator) {

                // Cari user
                let user =
                    await prisma.discordUser.findUnique(
                        {
                            where: {
                                id:
                                    interaction.user
                                        .id
                            }
                        }
                    );

                // Kalau belum ada
                if (!user) {

                    user =
                        await prisma.discordUser.create(
                            {
                                data: {
                                    id:
                                        interaction
                                            .user.id,

                                    username:
                                        interaction
                                            .user
                                            .tag
                                }
                            }
                        );

                }

                // Hitung violations
                const totalAttempts =
                    await prisma.warnAttempt.count(
                        {
                            where: {
                                userId:
                                    interaction
                                        .user.id
                            }
                        }
                    );

                // Simpan warn
                await prisma.warnAttempt.create(
                    {
                        data: {

                            userId:
                                interaction
                                    .user.id,

                            threadName:
                                channel.name,

                            attemptCount:
                                totalAttempts +
                                1
                        }
                    }
                );

                // Log channel
                const logChannel =
                    await client.channels.fetch(
                        LOG_CHANNEL_ID
                    );

                // Embed merah
                if (logChannel) {

                    const warnEmbed =
                        new EmbedBuilder()
                            .setColor('Red')
                            .setTitle(
                                '⚠️ Unauthorized Delete Attempt'
                            )
                            .addFields(
                                {
                                    name: 'User',
                                    value:
                                        interaction
                                            .user
                                            .tag
                                },
                                {
                                    name: 'User ID',
                                    value:
                                        interaction
                                            .user.id
                                },
                                {
                                    name: 'Thread',
                                    value:
                                        channel.name
                                },
                                {
                                    name: 'Violations',
                                    value: `${totalAttempts + 1}`
                                }
                            )
                            .setTimestamp();

                    await logChannel.send({
                        embeds: [warnEmbed]
                    });

                }

                return interaction.reply({
                    content:
                        'Kamu bukan pemilik forum post ini.',
                    ephemeral: true
                });

            }

            // =========================
            // DELETE SUCCESS
            // =========================

            await interaction.deferReply({
                ephemeral: true
            });

            const logChannel =
                await client.channels.fetch(
                    LOG_CHANNEL_ID
                );

            // Embed hijau
            if (logChannel) {

                const deleteEmbed =
                    new EmbedBuilder()
                        .setColor('Green')
                        .setTitle(
                            '🗑️ Forum Deleted'
                        )
                        .addFields(
                            {
                                name: 'Thread',
                                value:
                                    channel.name
                            },
                            {
                                name: 'Deleted By',
                                value:
                                    interaction
                                        .user.tag
                            },
                            {
                                name: 'User ID',
                                value:
                                    interaction
                                        .user.id
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

                await logChannel.send({
                    embeds: [deleteEmbed]
                });

            }

            // Hapus thread
            await channel.delete();

            console.log(
                'Forum berhasil dihapus'
            );

        } catch (error) {

            console.error(
                'ERROR:',
                error
            );

        }

    }
);

// =========================
// ERROR HANDLER
// =========================

process.on(
    'unhandledRejection',
    error => {

        console.error(
            'Unhandled promise rejection:',
            error
        );

    }
);

process.on(
    'uncaughtException',
    error => {

        console.error(
            'Uncaught exception:',
            error
        );

    }
);

// =========================
// LOGIN
// =========================

client.login(TOKEN);