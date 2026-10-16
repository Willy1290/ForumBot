const fs = require("fs");
const path = require("path");
const phash = require("sharp-phash");

const IMAGE_DIR = path.join(__dirname, "images");

const SUPPORTED_EXTENSIONS = [
    ".jpg", ".jpeg", ".png", ".webp", ".bmp"
];

async function main() {
    if (!fs.existsSync(IMAGE_DIR)) {
        console.error(`Folder tidak ditemukan: ${IMAGE_DIR}`);
        process.exitCode = 1;
        return;
    }

    const files = fs.readdirSync(IMAGE_DIR)
        .filter(file =>
            SUPPORTED_EXTENSIONS.includes(
                path.extname(file).toLowerCase()
            )
        );

    const hashes = [];

    for (const file of files) {
        try {
            const hash = await phash(path.join(IMAGE_DIR, file));

            hashes.push(hash);
            console.log(`Diproses: ${file}`);
        } catch (error) {
            console.error(`Gagal memproses ${file}:`, error.message);
        }
    }

    console.log("\nconst REFERENCE_HASHES = [");
	for (const hash of hashes){
		console.log(`	"${hash}",`);
	}
	console.log("];");
	console.log(`\nSelesai! ${hashes.length} gambar diproses.`);
}
main().catch(console.error);