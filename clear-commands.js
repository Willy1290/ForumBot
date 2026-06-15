// Jalankan sekali: node clear-commands.js
// Setelah selesai, hapus file ini dan restart bot normal

const { REST, Routes } = require('discord.js');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
    try {
        console.log('Menghapus semua command...');

        // Hapus semua guild command
        await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
            { body: [] }
        );

        // Hapus semua global command (kalau ada)
        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            { body: [] }
        );

        console.log('Semua command berhasil dihapus.');
        console.log('Sekarang restart bot utama untuk register ulang command yang baru.');

    } catch (error) {
        console.error('Error:', error);
    }
})();
