import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config
export default defineConfig({
    plugins: [react()],
    build: {
        sourcemap: true
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src')
        }
    },
    // Ensure assets are available during development
    publicDir: 'src/assets',
    // Make sure environment variables are passed to the renderer process
    // The Electron Forge plugin sets MAIN_WINDOW_VITE_NAME but we need to ensure it works
    define: {
        // These variables will be statically replaced at build time
        'process.env.RENDERER_VITE_NAME': JSON.stringify('index'),
        // If you have other environment variables you need to expose to the renderer, add them here
    }
});
