import type { ForgeConfig } from '@electron-forge/shared-types';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import process from 'process';

const secrets_dir = path.join(process.cwd(), '..', '_secrets');

// Ensure the absolute path set for APPLE_API_KEY in app_store_api.json file
// points to the mcp_defender_app_store_key.p8 file in the same secrets_mcp_defender directory
const app_store_api_json = path.join(secrets_dir, 'app_store_api.json');
let app_store_api_data = {};
try {
  app_store_api_data = JSON.parse(fs.readFileSync(app_store_api_json, 'utf8'));
} catch (error) {
  console.warn('Failed to read app_store_api.json, using empty object:', error.message);
}

const github_api_json = path.join(secrets_dir, 'github_api.json');
let github_api_data = {};
try {
  github_api_data = JSON.parse(fs.readFileSync(github_api_json, 'utf8'));
} catch (error) {
  console.warn('Failed to read github_api.json, using empty object:', error.message);
}

// Get directory name in ES module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Custom hook to build the CLI tool
const buildCLI = async () => {
  console.log('Building CLI helper...');

  // Ensure dist/bin directory exists
  const binDir = path.resolve(process.cwd(), 'dist/bin');
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  // Import and run the build function from our utility config
  const { build } = await import('esbuild');
  await build({
    entryPoints: [path.resolve(process.cwd(), 'src/cli.ts')],
    bundle: true,
    platform: 'node',
    target: 'node18',
    outfile: path.resolve(process.cwd(), 'dist/bin/cli.js'),
    external: [
      // Mark common Node.js modules as external
      'fs', 'path', 'os', 'net', 'child_process', 'util', 'events',
      // Don't mark MCP SDK as external to ensure it's bundled
    ],
    minify: process.env.NODE_ENV === 'production',
    sourcemap: process.env.NODE_ENV !== 'production',
    // Don't need a banner since cli.ts already includes the shebang
  });

  // Make the output file executable
  const outFile = path.resolve(process.cwd(), 'dist/bin/cli.js');
  fs.chmodSync(outFile, '755');

  console.log('✅ CLI built successfully!');

  return true;
};

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    extraResource: [
      './src/assets/IconTemplate.png',
      './src/assets/IconTemplate@2x.png',
      './src/assets/1024x1024_logo.icns',
      './src/assets/mcp_app_icons',
      './signatures',
      './dist/bin/cli.js' // CLI helper will be at Contents/Resources/cli.js
    ],
    icon: 'src/assets/1024x1024_logo', // The actual file must have .icns extension, but the .icns is omitted here.
    appBundleId: 'com.mcpdefender.app',
    appCategoryType: 'public.app-category.developer-tools',
    // Override the name to remove version from filename
    name: 'MCP Defender',
    protocols: [
      {
        name: 'MCP Defender',
        schemes: ['mcp-defender']
      }
    ],
    osxSign: {}, // This must exist even if empty for notarization to work.
    // Only include notarization if SKIP_NOTARIZE is not set
    ...(process.env.SKIP_NOTARIZE !== 'true' && {
      osxNotarize: {
        appleApiKey: app_store_api_data["APPLE_API_KEY"],
        appleApiKeyId: app_store_api_data["APPLE_API_KEY_ID"],
        appleApiIssuer: app_store_api_data["APPLE_API_ISSUER"]
      }
    }),
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {},
    },
    {
      name: '@electron-forge/maker-zip',
      config: {},
    },
    {
      name: '@electron-forge/maker-deb',
      config: {
        mimeType: ["x-scheme-handler/mcp-defender"]
      },
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {},
    },
  ],
  publishers: [
    {
      name: '@electron-forge/publisher-github',
      config: {
        // Managed here: https://github.com/settings/personal-access-tokens
        authToken: github_api_data["GITHUB_TOKEN"],
        repository: {
          owner: 'MCP-Defender',
          name: 'MCP-Defender'
        },
        prerelease: true
      }
    }
  ],
  hooks: {
    // Build the CLI before packaging
    packageAfterPrune: async (_config, buildPath) => {
      await buildCLI();

      // Copy the CLI to the build path for packaging
      const cliSource = path.resolve(process.cwd(), 'dist/bin/cli.js');
      const cliDest = path.join(buildPath, 'dist/bin/cli.js');

      // Ensure directory exists
      const binDir = path.dirname(cliDest);
      if (!fs.existsSync(binDir)) {
        fs.mkdirSync(binDir, { recursive: true });
      }

      // Copy file
      fs.copyFileSync(cliSource, cliDest);
      fs.chmodSync(cliDest, '755');
    }
  },
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
        {
          // Build the proxy server directly with main target
          entry: 'src/defender/defender-controller.ts',
          config: 'vite.utility.config.ts',
          target: 'main',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
