import { defineConfig } from 'vite';
import path from 'path';
import fs from 'fs';

// Log build environment for debugging
console.log('Building main process with environment:');
console.log('  NODE_ENV:', process.env.NODE_ENV);
console.log('  MAIN_WINDOW_VITE_DEV_SERVER_URL:', process.env.MAIN_WINDOW_VITE_DEV_SERVER_URL);
console.log('  MAIN_WINDOW_VITE_NAME:', process.env.MAIN_WINDOW_VITE_NAME);

// Copy asset files to build directory
const assetFiles = ['IconTemplate.png', 'IconTemplate@2x.png'];
const assetSrcDir = path.resolve(__dirname, 'src/assets');
const assetDestDir = path.resolve(__dirname, '.vite/build/assets');

// Create destination directory if it doesn't exist
if (!fs.existsSync(assetDestDir)) {
    fs.mkdirSync(assetDestDir, { recursive: true });
}

// Copy the files
for (const file of assetFiles) {
    const srcPath = path.join(assetSrcDir, file);
    const destPath = path.join(assetDestDir, file);

    if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, destPath);
        console.log(`Copied ${srcPath} to ${destPath}`);
    } else {
        console.warn(`Source file not found: ${srcPath}`);
    }
}

// Copy signatures directory to build
const signaturesSrcDir = path.resolve(__dirname, 'signatures');
const signaturesDestDir = path.resolve(__dirname, '.vite/build/signatures');

// Create signatures destination directory
if (!fs.existsSync(signaturesDestDir)) {
    fs.mkdirSync(signaturesDestDir, { recursive: true });
}

// Copy all signature files
if (fs.existsSync(signaturesSrcDir)) {
    const signatureFiles = fs.readdirSync(signaturesSrcDir);
    for (const file of signatureFiles) {
        if (file.endsWith('.json')) {
            const srcPath = path.join(signaturesSrcDir, file);
            const destPath = path.join(signaturesDestDir, file);
            fs.copyFileSync(srcPath, destPath);
            console.log(`Copied signature file ${srcPath} to ${destPath}`);
        }
    }
}

// https://vitejs.dev/config
export default defineConfig({
    build: {
        sourcemap: true,
        rollupOptions: {
            external: ['electron']
        }
    },
    // Ensure we preserve environment variables through Vite's bundling
    define: {
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
        // Add MAIN_WINDOW_VITE_NAME with fallback value to ensure it's available in production
        'process.env.MAIN_WINDOW_VITE_NAME': JSON.stringify(process.env.MAIN_WINDOW_VITE_NAME || 'main_window')
    }
});
