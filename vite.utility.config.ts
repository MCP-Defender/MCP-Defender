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
            // Make sure to preserve the file extension for the MCP server files
            external: [
                /node_modules/,
            ]
        }
    },
    // Ensures that ESM imports with .js extensions work properly with TypeScript
    resolve: {
        extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json']
    }
}); 