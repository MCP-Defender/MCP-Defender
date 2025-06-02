/**
 * Settings Events types
 */
export enum SettingsEventType {
    LLM_UPDATED = 'settings:llm-update',
    SCAN_UPDATED = 'settings:scan-update',
    ONBOARDING_UPDATED = 'settings:onboarding-update',
    SETTINGS_LOADED = 'settings:loaded',
    SIGNATURES_UPDATED = 'settings:signatures-update'
}

/**
 * Scan mode enumeration
 */
export enum ScanMode {
    NONE = 'none',               // Don't verify any communications
    REQUEST_ONLY = 'request-only',   // Only verify tool call requests
    RESPONSE_ONLY = 'response-only', // Only verify tool call responses
    REQUEST_RESPONSE = 'request-response' // Verify both requests and responses
}

/**
 * Notification settings enumeration
 */
export enum NotificationSettings {
    NONE = 0,
    CONFIG_UPDATES = 1,
    ALL = 3 // Reserved for future notification types
}

/**
 * Onboarding status enumeration
 */
export enum OnboardingStatus {
    NOT_STARTED = 0,
    IN_PROGRESS = 1,
    COMPLETED = 2
}

/**
 * Complete Settings interface
 */
export interface Settings {
    user: {
        email: string;
        loginToken: string;
    }
    llm: {
        model: string;
        apiKey: string;
        provider: string;
    };
    scanMode: ScanMode;
    notificationSettings: NotificationSettings;
    onboardingCompleted: boolean;
    disabledSignatures: Set<string> | string[]; // Set in memory, string[] for serialization
    startOnLogin: boolean; // Whether to start the app when user logs into their computer
    enableSSEProxying: boolean; // Whether to proxy SSE (Server-Sent Events) transport through our server
    useMCPDefenderSecureTools: boolean; // Whether to automatically include MCP Defender Secure Tools server
}
