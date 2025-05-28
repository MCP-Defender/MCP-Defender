/**
 * Icon utility functions for application icons
 */

// Mapping of application names to icon identifiers
// These will be resolved to actual images later
export const AppNameToIconPath: Record<string, string> = {
    'Cursor': './src/assets/mcp_app_icons/cursor.png',
    'Visual Studio Code': './src/assets/mcp_app_icons/vscode.png',
    'Claude Desktop': './src/assets/mcp_app_icons/claude.png',
    'Windsurf': './src/assets/mcp_app_icons/windsurf.png',
    // Add more app icons as needed
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