const fs = require("node:fs");
const path = require("node:path");
const phash = require("sharp-phash");

async function main() {
  const imageFiles = [
    "mrbeast1.png",
    "mrbeast2.png",
    "mrbeast3.png",
    "mrbeast4.png",
  ];

  const hashes = [];

  for (const file of imageFiles) {
    const imagePath = path.join("images", file);

    try {
      const buffer = fs.readFileSync(imagePath);
      const hash = await phash(buffer);

      hashes.push(hash);
      console.log(`${file}: ${hash}`);
    } catch (error) {
      console.error(`Gagal memproses ${file}:`, error.message);
    }
  }

  console.log("\nSalin ke index.js:\n");
  console.log("const REFERENCE_HASHES = [");

  for (const hash of hashes) {
    console.log(`  "${hash}",`);
  }

  console.log("];");
}

main();