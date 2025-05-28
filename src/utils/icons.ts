/**
 * Icon utility functions for application icons
 */

// Import icon assets for Vite development
import cursorIcon from '../assets/mcp_app_icons/cursor.png';
import vscodeIcon from '../assets/mcp_app_icons/vscode.png';
import claudeIcon from '../assets/mcp_app_icons/claude.png';
import windsurfIcon from '../assets/mcp_app_icons/windsurf.png';
import clineIcon from '../assets/mcp_app_icons/cline.png';

// Icon mapping for development (using Vite imports)
const developmentIconPaths = {
    'Cursor': cursorIcon,
    'Visual Studio Code': vscodeIcon,
    'Claude Desktop': claudeIcon,
    'Windsurf': windsurfIcon,
    'Cline': clineIcon,
};

// Base icon paths for production (without the resource protocol)
const productionIconPaths = {
    'Cursor': 'mcp_app_icons/cursor.png',
    'Visual Studio Code': 'mcp_app_icons/vscode.png',
    'Claude Desktop': 'mcp_app_icons/claude.png',
    'Windsurf': 'mcp_app_icons/windsurf.png',
    'Cline': 'mcp_app_icons/cline.png',
    // Add more app icons as needed
};

/**
 * Get the resolved path for an app icon
 * @param appName Name of the application
 * @returns Promise that resolves to the full path to the icon, or undefined if not found
 */
export async function getAppIconPath(appName: string): Promise<string | undefined> {
    // Check if we have an icon for this app
    const devIcon = developmentIconPaths[appName as keyof typeof developmentIconPaths];
    const prodIconPath = productionIconPaths[appName as keyof typeof productionIconPaths];

    if (!devIcon && !prodIconPath) return undefined;

    // In development, use the imported asset URLs
    if (import.meta.env.DEV) {
        return devIcon;
    }

    // In production, use the utility API to get the proper resource path
    if (typeof window !== 'undefined' && (window as any).utilityAPI) {
        try {
            return await (window as any).utilityAPI.getResourcePath(prodIconPath);
        } catch (error) {
            console.error('Failed to resolve icon path:', error);
            return undefined;
        }
    }

    // Fallback 
    return undefined;
}

// Legacy mapping for backwards compatibility
export const AppNameToIconPath: Record<string, string> = {
    'Cursor': 'mcp_app_icons/cursor.png',
    'Visual Studio Code': 'mcp_app_icons/vscode.png',
    'Claude Desktop': 'mcp_app_icons/claude.png',
    'Windsurf': 'mcp_app_icons/windsurf.png',
    'Cline': 'mcp_app_icons/cline.png',
};

/**
 * Generate initials for an app name, for use in avatar fallbacks
 * @param appName Name of the application
 * @returns 1-2 characters representing the app's initials
 */
export function getAppInitials(appName: string): string {
    if (!appName) return '?';

    // Split by spaces or hyphens and get first letter of each part
    const parts = appName.split(/[\s-]+/);

    if (parts.length === 1) {
        // Just return first 1-2 chars of the name
        return appName.substring(0, 2).toUpperCase();
    }

    // Otherwise return initials (first letter of first two words)
    return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
} 