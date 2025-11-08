#!/usr/bin/env node

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// Tamaños de iconos para Android
const iconSizes = [
    { size: 48, folder: 'mipmap-mdpi' },
    { size: 72, folder: 'mipmap-hdpi' },
    { size: 96, folder: 'mipmap-xhdpi' },
    { size: 144, folder: 'mipmap-xxhdpi' },
    { size: 192, folder: 'mipmap-xxxhdpi' }
];

const svgPath = path.join(__dirname, 'android', 'app-icon.svg');
const resPath = path.join(__dirname, 'android', 'app', 'src', 'main', 'res');

async function generateIcons() {
    console.log('📱 Generando iconos de la aplicación...');

    for (const config of iconSizes) {
        const outputFolder = path.join(resPath, config.folder);

        // Crear carpeta si no existe
        if (!fs.existsSync(outputFolder)) {
            fs.mkdirSync(outputFolder, { recursive: true });
        }

        // Generar ic_launcher.png
        const outputPath = path.join(outputFolder, 'ic_launcher.png');

        try {
            await sharp(svgPath)
                .resize(config.size, config.size)
                .png()
                .toFile(outputPath);

            console.log(`✅ ${config.folder}/ic_launcher.png (${config.size}x${config.size})`);
        } catch (error) {
            console.error(`❌ Error generando ${config.folder}:`, error.message);
        }

        // Generar ic_launcher_round.png (mismo icono)
        const outputPathRound = path.join(outputFolder, 'ic_launcher_round.png');

        try {
            await sharp(svgPath)
                .resize(config.size, config.size)
                .png()
                .toFile(outputPathRound);

            console.log(`✅ ${config.folder}/ic_launcher_round.png (${config.size}x${config.size})`);
        } catch (error) {
            console.error(`❌ Error generando ${config.folder} round:`, error.message);
        }
    }

    // Generar splash screen (1080x1920)
    const splashPath = path.join(resPath, 'drawable', 'splash.png');
    const drawableFolder = path.join(resPath, 'drawable');

    if (!fs.existsSync(drawableFolder)) {
        fs.mkdirSync(drawableFolder, { recursive: true });
    }

    try {
        // Crear un splash screen simple (fondo verde con logo centrado)
        const splashSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920">
  <rect width="1080" height="1920" fill="#28a745"/>
  <g transform="translate(540, 960)">
    <circle cx="0" cy="0" r="200" fill="#ffffff" opacity="0.15"/>
    <g transform="scale(1.2)">
      <g transform="rotate(-45)">
        <rect x="-8" y="-100" width="16" height="140" fill="#ffffff" rx="2"/>
        <path d="M -15,-100 L -8,-120 L 8,-120 L 15,-100 Z" fill="#ffc107"/>
        <rect x="-8" y="35" width="16" height="10" fill="#ffffff"/>
      </g>
      <g transform="rotate(45)">
        <rect x="-8" y="-90" width="16" height="120" fill="#ffffff" rx="2"/>
        <path d="M -20,-90 L -20,-70 L -8,-70 L -8,-90 Z" fill="#ffffff"/>
        <path d="M 8,-90 L 8,-70 L 20,-70 L 20,-90 Z" fill="#ffffff"/>
        <circle cx="0" cy="25" r="15" fill="#ffffff"/>
        <circle cx="0" cy="25" r="8" fill="#28a745"/>
      </g>
    </g>
  </g>
  <text x="540" y="1300" font-family="Arial, sans-serif" font-size="120" font-weight="bold" fill="#ffffff" text-anchor="middle">SolucNet</text>
  <text x="540" y="1420" font-family="Arial, sans-serif" font-size="80" font-weight="normal" fill="#ffffff" text-anchor="middle" opacity="0.9">Técnicos</text>
</svg>`;

        const splashBuffer = Buffer.from(splashSvg);

        await sharp(splashBuffer)
            .resize(1080, 1920)
            .png()
            .toFile(splashPath);

        console.log(`✅ Splash screen generado (1080x1920)`);
    } catch (error) {
        console.error(`❌ Error generando splash screen:`, error.message);
    }

    console.log('\n✅ ¡Todos los iconos generados exitosamente!');
}

generateIcons().catch(console.error);
