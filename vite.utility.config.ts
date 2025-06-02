import { defineConfig } from 'vite';
import path from 'path';
import fs from 'fs';

const destDir = path.resolve(__dirname, '.vite/build');

// Create destination directory if it doesn't exist
if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
}

// https://vitejs.dev/config
export default defineConfig({
    build: {
        sourcemap: true,
        minify: false,
        emptyOutDir: false,
        rollupOptions: {
            // Only mark Node.js built-ins as external, bundle npm packages
            external: [
                // Node.js built-in modules (these should not be bundled)
                'node:http',
                'node:https',
                'node:url',
                'node:fs',
                'node:path',
                'node:crypto',
                'node:process',
                'node:events',
                'node:util',
                'node:stream',
                'node:buffer',
                'node:os',
                'node:net',
                'node:child_process',
                'node:readline',
                'node:zlib',
                'http',
                'https',
                'url',
                'fs',
                'path',
                'crypto',
                'process',
                'events',
                'util',
                'stream',
                'buffer',
                'os',
                'net',
                'child_process',
                'readline',
                'zlib',
                'electron'
            ]
        }
    },
    // Ensures that ESM imports with .js extensions work properly with TypeScript
    resolve: {
        extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json']
    }
}); 