/// <reference types="vite/client" />

// TypeScript declarations for environment variables provided by Vite
declare global {
    // For variables in main/preload processes
    namespace NodeJS {
        interface ProcessEnv {
            MAIN_WINDOW_VITE_DEV_SERVER_URL?: string;
            MAIN_WINDOW_VITE_NAME?: string;
            NODE_ENV?: string;
        }
    }

    // For variables directly available in the renderer
    const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
    const MAIN_WINDOW_VITE_NAME: string | undefined;
}

export { }; 