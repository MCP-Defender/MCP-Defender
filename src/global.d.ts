import { DefenderState } from './services/defender/types';
import { MCPApplication, ConfigOperationResult } from './services/configurations/types';
import { ScanResult } from './services/scans/types';
import { Settings, OnboardingStatus } from './services/settings/types';
import { Signature } from './services/signatures/types';

// Define the LLM settings interface
interface LLMSettings {
  enabled: boolean;
  model: string;
  apiKey: string;
}

// Define onboarding state type from settings
interface OnboardingState {
  status: OnboardingStatus;
  email?: string;
}

// Define account details interface
interface AccountDetails {
  email: string;
  plan: string;
  usage: number;
  limit: number;
}

declare global {
  interface Window {
    // Scan API
    scanAPI: {
      // Get scan results
      getScanResults: () => Promise<ScanResult[]>;

      // Get scan by ID
      getScanById: (scanId: string) => Promise<ScanResult | null>;

      // Open a scan detail window
      openScanDetailWindow: (scanId: string) => Promise<void>;

      // Get number of open scan detail windows
      getScanDetailWindowCount: () => Promise<number>;

      // Focus all scan detail windows
      focusAllScanDetailWindows: () => Promise<boolean>;

      // Close all scan detail windows
      closeAllScanDetailWindows: () => Promise<boolean>;

      // Listen for updates to scan results
      onScanResultsUpdate: (callback: (results: ScanResult[]) => void) => () => void;

      // Get temporary scan by ID (for security alerts)
      getTemporaryScanById: (scanId: string) => Promise<ScanResult | null>;
    }

    // Security API for security alert decision handling
    securityAPI: {
      // Send user decision from security alert
      sendDecision: (scanId: string, allowed: boolean, remember: boolean) => void;
    }

    // Tray API for app navigation and window management
    trayAPI: {
      // Tab switching events
      onSwitchTab: (callback: (tabName: string) => void) => () => void;

      // Listen for settings open events
      onOpenSettings: (callback: () => void) => () => void;

      // Manually trigger a tab switch
      switchTab: (tabName: string) => Promise<void>;

      // Open settings view
      openSettings: () => Promise<boolean>;
    }

    // Account API
    accountAPI: {
      // Login with email
      login: (email: string) => Promise<{ success: boolean; error?: string }>;

      // Verify login token
      verifyLogin: () => Promise<{ success: boolean; error?: string }>;

      // Get account details
      getDetails: () => Promise<{
        success: boolean;
        details?: AccountDetails;
        error?: string
      }>;

      // Logout
      logout: () => Promise<{ success: boolean; error?: string }>;

      // Process deep link
      processDeepLink: (url: string) => Promise<{ success: boolean; error?: string }>;

      // Create checkout link
      createCheckoutLink: () => Promise<{ success: boolean; url?: string; error?: string }>;

      // Handle deep link received
      onDeepLinkReceived: (callback: (url: string) => void) => () => void;

      // Handle toast notifications
      onToastReceived: (callback: (data: { type: string; message: string }) => void) => () => void;
    }

    // MCP Configuration API
    configurationAPI: {
      // Get all applications
      getApplications: () => Promise<MCPApplication[]>;

      // Listen for individual application updates
      onApplicationUpdate: (callback: (app: MCPApplication) => void) => () => void;

      // Listen for all applications update
      onAllApplicationsUpdate: (callback: (apps: MCPApplication[]) => void) => () => void;

      // Discover tools for all servers without tools
      discoverAllServerTools: () => Promise<{ success: boolean, error?: string }>;
    }

    // Settings API
    settingsAPI: {
      // Get all settings
      getAll: () => Promise<Settings>;

      // Update settings (partial update)
      update: (settings: Partial<Settings>) => Promise<boolean>;

      // Open signatures directory
      openSignaturesDirectory: () => Promise<boolean>;

      // Open logs directory
      openLogsDirectory: () => Promise<boolean>;

      // Open external URL in default browser
      openExternalUrl: (url: string) => Promise<boolean>;

      // Save disabled signatures
      saveDisabledSignatures: (signatureIds: string[]) => Promise<boolean>;

      // Open settings window
      openSettingsWindow: () => Promise<boolean>;

      // Close settings window 
      closeSettingsWindow: () => Promise<boolean>;

      // Set notification settings
      setNotificationSettings: (settings: number) => Promise<boolean>;

      // Get login item settings from system
      getLoginItemSettings: () => Promise<{ openAtLogin: boolean; openAsHidden: boolean }>;

      // Trigger test security alert
      triggerTestSecurityAlert: () => Promise<{ success: boolean; allowed?: boolean; error?: string }>;
    }

    // Onboarding API
    onboardingAPI: {
      // Send verification email
      sendEmail: (email: string) => Promise<{ success: boolean, link?: string, error?: string }>;

      // Verify token from email
      verifyToken: (token: string) => Promise<{ valid: boolean }>;

      // Skip email verification and complete onboarding directly
      skipEmailOnboarding: () => Promise<{ success: boolean }>;

      // Complete onboarding after email verification
      completeLoginOnboarding: () => Promise<{ success: boolean }>;

      // Listen for onboarding status changes
      onStatusChanged: (callback: (state: OnboardingState) => void) => () => void;

      // Handle token from deep link
      onTokenReceived: (callback: (token: string) => void) => () => void;

      // Handle verification error
      onVerificationError: (callback: () => void) => () => void;
    }

    // Signatures API
    signaturesAPI: {
      // Get all signatures
      getSignatures: () => Promise<Signature[]>;

      // Open signatures directory
      openSignaturesDirectory: () => Promise<boolean>;
    }

    // Defender API
    defenderAPI: {
      // Get current defender state
      getState: () => Promise<DefenderState>;
      // Listen for defender state updates
      onStateUpdate: (callback: (state: DefenderState) => void) => () => void;
    }

    // Utility API
    utilityAPI: {
      // Get the correct path to a resource
      getResourcePath: (resourcePath: string) => Promise<string>;
    }
  }
} 