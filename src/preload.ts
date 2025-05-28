// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from 'electron';
import { DefenderServiceEvent, DefenderState } from './services/defender/types';
import { MCPApplication } from './services/configurations/types';
import { ScanResult } from './services/scans/types';
import { Settings } from './services/settings/types';

// Define TypeScript interfaces for our APIs
// This ensures type safety and consistency with the main process

// Scan API
contextBridge.exposeInMainWorld('scanAPI', {
  // Get scan results
  getScanResults: () => ipcRenderer.invoke('scanAPI:getScanResults'),

  // Get scan by ID
  getScanById: (scanId: string) => ipcRenderer.invoke('scanAPI:getScanById', scanId),

  // Open a scan detail window
  openScanDetailWindow: (scanId: string) => ipcRenderer.invoke('scanAPI:openScanDetailWindow', scanId),

  // Get number of open scan detail windows
  getScanDetailWindowCount: () => ipcRenderer.invoke('scanAPI:getScanDetailWindowCount'),

  // Focus all scan detail windows
  focusAllScanDetailWindows: () => ipcRenderer.invoke('scanAPI:focusAllScanDetailWindows'),

  // Close all scan detail windows
  closeAllScanDetailWindows: () => ipcRenderer.invoke('scanAPI:closeAllScanDetailWindows'),

  // Listen for updates to scan results
  onScanResultsUpdate: (callback: (results: ScanResult[]) => void) => {
    const subscription = (_: any, results: ScanResult[]) => callback(results);
    ipcRenderer.on('scan:results-update', subscription);
    return () => {
      ipcRenderer.removeListener('scan:results-update', subscription);
    };
  },

  // Get temporary scan results by ID (for security alerts)
  getTemporaryScanById: (scanId: string) => {
    return ipcRenderer.invoke('scanAPI:getTemporaryScanById', scanId);
  }
});

// Account API
contextBridge.exposeInMainWorld('accountAPI', {
  // Login with email
  login: (email: string) => ipcRenderer.invoke('accountAPI:login', email),

  // Verify login token
  verifyLogin: () => ipcRenderer.invoke('accountAPI:verifyLogin'),

  // Get account details
  getDetails: () => ipcRenderer.invoke('accountAPI:getDetails'),

  // Logout
  logout: () => ipcRenderer.invoke('accountAPI:logout'),

  // Process deep link
  processDeepLink: (url: string) => ipcRenderer.invoke('accountAPI:processDeepLink', url),

  // Create checkout link
  createCheckoutLink: () => ipcRenderer.invoke('accountAPI:createCheckoutLink'),

  // Handle deep link received
  onDeepLinkReceived: (callback: (url: string) => void) => {
    const subscription = (_: any, url: string) => callback(url);
    ipcRenderer.on('app:deep-link', subscription);
    return () => {
      ipcRenderer.removeListener('app:deep-link', subscription);
    };
  },

  // Handle toast notifications from the main process
  onToastReceived: (callback: (data: { type: string, message: string }) => void) => {
    const subscription = (_: any, data: { type: string, message: string }) => callback(data);
    ipcRenderer.on('app:toast', subscription);
    return () => {
      ipcRenderer.removeListener('app:toast', subscription);
    };
  }
});

// Defender API
contextBridge.exposeInMainWorld('defenderAPI', {
  // Get current defender state
  getState: () => ipcRenderer.invoke('defenderAPI:getState'),

  // Listen for defender state updates
  onStateUpdate: (callback: (state: DefenderState) => void) => {
    const subscription = (_: any, state: DefenderState) => callback(state);
    ipcRenderer.on(DefenderServiceEvent.STATUS, subscription);
    return () => {
      ipcRenderer.removeListener(DefenderServiceEvent.STATUS, subscription);
    };
  }
});

// Configuration API
contextBridge.exposeInMainWorld('configurationAPI', {
  getApplications: () => ipcRenderer.invoke('configurationAPI:getApplications'),

  onApplicationUpdate: (callback: (app: MCPApplication) => void) => {
    const subscription = (_: any, app: MCPApplication) => callback(app);
    ipcRenderer.on('configurations:application-update', subscription);
    return () => {
      ipcRenderer.removeListener('configurations:application-update', subscription);
    };
  },

  onAllApplicationsUpdate: (callback: (apps: MCPApplication[]) => void) => {
    const subscription = (_: any, apps: MCPApplication[]) => callback(apps);
    ipcRenderer.on('configurations:all-applications-update', subscription);
    return () => {
      ipcRenderer.removeListener('configurations:all-applications-update', subscription);
    };
  },

  discoverAllServerTools: () =>
    ipcRenderer.invoke('configuration:discover-all-tools')
});

// Tray API
contextBridge.exposeInMainWorld('trayAPI', {
  // Listen for tab switching events
  onSwitchTab: (callback: (tabName: string) => void) => {
    const subscription = (_: any, tabName: string) => callback(tabName);
    ipcRenderer.on('switch-tab', subscription);
    return () => {
      ipcRenderer.removeListener('switch-tab', subscription);
    };
  },

  // Listen for open settings events
  onOpenSettings: (callback: () => void) => {
    const subscription = (_: any) => callback();
    ipcRenderer.on('open-settings', subscription);
    return () => {
      ipcRenderer.removeListener('open-settings', subscription);
    };
  },

  // Manually trigger a tab switch (useful for navigation within the app)
  switchTab: (tabName: string) => ipcRenderer.invoke('trayAPI:switchTab', tabName),

  // Open settings view
  openSettings: () => ipcRenderer.invoke('trayAPI:openSettings')
});

// Settings API
contextBridge.exposeInMainWorld('settingsAPI', {
  getAll: () => ipcRenderer.invoke('settingsAPI:getAll'),

  update: (settings: Partial<Settings>) =>
    ipcRenderer.invoke('settingsAPI:update', settings),

  openSignaturesDirectory: () => ipcRenderer.invoke('settingsAPI:openSignaturesDirectory'),

  openLogsDirectory: () => ipcRenderer.invoke('settingsAPI:openLogsDirectory'),

  saveDisabledSignatures: (signatureIds: string[]) =>
    ipcRenderer.invoke('settingsAPI:saveDisabledSignatures', signatureIds),

  openSettingsWindow: () => ipcRenderer.invoke('settingsAPI:openSettingsWindow'),

  closeSettingsWindow: () => ipcRenderer.invoke('settingsAPI:closeSettingsWindow'),

  setNotificationSettings: (settings: number) =>
    ipcRenderer.invoke('settingsAPI:setNotificationSettings', settings),

  getLoginItemSettings: () => ipcRenderer.invoke('settingsAPI:getLoginItemSettings'),

  // Trigger test security alert
  triggerTestSecurityAlert: () => ipcRenderer.invoke('settingsAPI:triggerTestSecurityAlert'),
});

// Onboarding API
contextBridge.exposeInMainWorld('onboardingAPI', {
  // Send verification email
  sendEmail: (email: string) => ipcRenderer.invoke('onboardingAPI:sendEmail', email),

  // Verify token from email
  verifyToken: (token: string) => ipcRenderer.invoke('onboardingAPI:verifyToken', token),

  // Skip email verification and complete onboarding directly
  skipEmailOnboarding: () => ipcRenderer.invoke('onboardingAPI:skipEmailOnboarding'),

  // Complete onboarding after email verification
  completeLoginOnboarding: () => ipcRenderer.invoke('onboardingAPI:completeLoginOnboarding'),

  // Handle token from deep link
  onTokenReceived: (callback: (token: string) => void) => {
    const subscription = (_: any, token: string) => callback(token);
    ipcRenderer.on('onboarding:token', subscription);
    return () => {
      ipcRenderer.removeListener('onboarding:token', subscription);
    };
  },

  // Handle verification error
  onVerificationError: (callback: () => void) => {
    const subscription = (_: any) => callback();
    ipcRenderer.on('onboarding:verification-error', subscription);
    return () => {
      ipcRenderer.removeListener('onboarding:verification-error', subscription);
    };
  }
});

// Signatures API
contextBridge.exposeInMainWorld('signaturesAPI', {
  // Get all signatures
  getSignatures: () => ipcRenderer.invoke('signaturesAPI:getSignatures'),

  // Open signatures directory
  openSignaturesDirectory: () => ipcRenderer.invoke('signaturesAPI:openSignaturesDirectory'),

  // Listen for signature updates
  onSignaturesUpdate: (callback: (signatures: any[]) => void) => {
    const subscription = (_: any, signatures: any[]) => callback(signatures);
    ipcRenderer.on('signatures:update', subscription);
    return () => {
      ipcRenderer.removeListener('signatures:update', subscription);
    };
  }
});

// Create SecurityAPI for responding to security alerts
contextBridge.exposeInMainWorld('securityAPI', {
  // Send decision from the security alert window
  sendDecision: (scanId: string, allowed: boolean, remember: boolean) => {
    return ipcRenderer.send('security-alert-decision', { scanId, allowed, remember });
  }
});
