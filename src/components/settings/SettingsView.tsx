import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { LogOut, User, RefreshCw, AlertCircle, FolderOpen, Bug, Shield, Cog, UserCheck } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select"
import { useState, useEffect } from "react"
import { ScanMode, Settings, NotificationSettings } from "../../services/settings/types"
import { LoginDialog } from "../LoginDialog"
import { Progress } from "@/components/ui/progress"
import { EmailVerificationDialog } from "../EmailVerificationDialog"
import { toast } from "sonner"


// Props interface
interface SettingsViewProps {
    standalone?: boolean;
}

// Models supported by the application
const SUPPORTED_MODELS = [
    { value: "mcp-defender", label: "MCP Defender (Most Secure)", provider: "mcp-defender" },
    { value: "gpt-4.1-2025-04-14", label: "GPT-4.1", provider: "OpenAI" },
    { value: "gpt-4o-mini-2024-07-18", label: "GPT-4o Mini", provider: "OpenAI" },
];

// Account details interface
interface AccountDetails {
    email: string;
    plan: string;
    usage: number;
    limit: number;
}

// Login state enum for clearer state management
enum LoginState {
    NOT_LOGGED_IN,
    LOGGING_IN,
    VERIFYING_EMAIL,
    LOGGED_IN,
    LOADING_DETAILS,
    ERROR
}

// Main SettingsView component
export default function SettingsView({ standalone = false }: SettingsViewProps) {
    // State for all settings
    const [settings, setSettings] = useState<Settings | null>(null);
    const [isLoginDialogOpen, setIsLoginDialogOpen] = useState(false);
    const [isVerificationDialogOpen, setIsVerificationDialogOpen] = useState(false);
    const [tempEmail, setTempEmail] = useState("");
    const [isLoggingOut, setIsLoggingOut] = useState(false);
    const [accountDetails, setAccountDetails] = useState<AccountDetails | null>(null);
    const [apiKeyInputValue, setApiKeyInputValue] = useState("");
    const [apiKeyTimer, setApiKeyTimer] = useState<NodeJS.Timeout | null>(null);
    const [isTestingSecurityAlert, setIsTestingSecurityAlert] = useState(false);

    // Login state management
    const [loginState, setLoginState] = useState<LoginState>(LoginState.NOT_LOGGED_IN);
    const [errorMessage, setErrorMessage] = useState<string>("");

    // Check if user is logged in based on settings
    const isLoggedIn = !!(settings?.user?.email && settings?.user?.loginToken);

    // Set initial API key value when settings load
    useEffect(() => {
        if (settings?.llm?.apiKey) {
            setApiKeyInputValue(settings.llm.apiKey);
        }
    }, [settings?.llm?.apiKey]);

    // Load saved settings on component mount
    useEffect(() => {
        const loadSettings = async () => {
            try {
                // Request settings from the main process
                const settings = await window.settingsAPI.getAll();
                setSettings(settings);

                // Determine initial login state based on settings
                if (settings?.user?.email && settings?.user?.loginToken) {
                    setLoginState(LoginState.LOGGED_IN);
                } else {
                    setLoginState(LoginState.NOT_LOGGED_IN);
                }
            } catch (error) {
                console.error('Failed to load settings:', error);
                toast.error("Failed to load application settings");
                setLoginState(LoginState.ERROR);
                setErrorMessage("Could not load settings. Please restart the application.");
            }
        };

        loadSettings();
    }, []);

    // Load account details when settings are loaded and user is logged in
    useEffect(() => {
        const loadAccountDetails = async () => {
            if (isLoggedIn) {
                setLoginState(LoginState.LOADING_DETAILS);

                try {
                    const response = await window.accountAPI.getDetails();
                    if (response.success && response.details) {
                        setAccountDetails(response.details);
                        setLoginState(LoginState.LOGGED_IN);
                    } else {
                        console.error("Could not load account details:", response.error);
                        toast.error("Failed to load account details");
                        setLoginState(LoginState.ERROR);
                        setErrorMessage("Could not load account details");
                    }
                } catch (error) {
                    console.error('Failed to load account details:', error);
                    toast.error("Failed to load account details");
                    setLoginState(LoginState.ERROR);
                    setErrorMessage("Could not load account details");
                }
            }
        };

        loadAccountDetails();
    }, [isLoggedIn, settings?.user?.loginToken]);

    // Listen for deep links
    useEffect(() => {
        const unsubscribe = window.accountAPI.onDeepLinkReceived(async (url: string) => {
            try {
                // Process the deep link
                const result = await window.accountAPI.processDeepLink(url);

                if (result.success) {
                    // Reload settings and account details
                    const updatedSettings = await window.settingsAPI.getAll();

                    // Automatically set model to MCP Defender after successful login
                    if (updatedSettings?.user?.email && updatedSettings?.user?.loginToken) {
                        await window.settingsAPI.update({
                            llm: {
                                ...updatedSettings.llm,
                                model: 'mcp-defender',
                                provider: 'mcp-defender'
                            }
                        });

                        // Refresh the settings after update
                        const finalSettings = await window.settingsAPI.getAll();
                        setSettings(finalSettings);
                    } else {
                        setSettings(updatedSettings);
                    }

                    toast.success("Email verification successful");

                    // Close verification dialog if it's open
                    setIsVerificationDialogOpen(false);
                } else {
                    console.error("Login verification failed:", result.error);
                    toast.error("Email verification failed");
                }
            } catch (error) {
                console.error('Deep link processing error:', error);
                toast.error("Failed to process login link");
            }
        });

        return () => unsubscribe();
    }, []);

    // Handle model selection
    const handleModelChange = (model: string) => {
        if (!settings) return;

        // Find the selected model's provider
        const selectedModel = SUPPORTED_MODELS.find(m => m.value === model);
        const provider = selectedModel?.provider || '';

        // If MCP Defender is selected and user is not logged in, initiate login flow
        if (provider === 'mcp-defender' && !isLoggedIn) {
            setIsLoginDialogOpen(true);
        }

        updateSettings({
            llm: {
                ...settings.llm,
                model,
                provider
            }
        });
    };

    // Handle API key input changes (with debounce)
    const handleApiKeyInputChange = (value: string) => {
        // Update the input field immediately for responsive UI
        setApiKeyInputValue(value);

        // Clear any existing timer
        if (apiKeyTimer) {
            clearTimeout(apiKeyTimer);
        }

        // Set a new timer to update the API key after delay
        const timer = setTimeout(() => {
            if (settings) {
                updateSettings({
                    llm: {
                        ...settings.llm,
                        apiKey: value
                    }
                });
            }
        }, 800); // 800ms debounce

        setApiKeyTimer(timer);
    };

    // Clean up timer on unmount
    useEffect(() => {
        return () => {
            if (apiKeyTimer) {
                clearTimeout(apiKeyTimer);
            }
        };
    }, [apiKeyTimer]);

    // Auto-save any settings changes
    const updateSettings = async (updates: Partial<Settings>) => {
        if (!settings) return;

        try {
            // Update settings via API
            await window.settingsAPI.update(updates);

            // Update local state
            setSettings({
                ...settings,
                ...updates
            });

            // Show subtle success indicator
            toast.success("Settings saved", {
                duration: 1500
            });
        } catch (error) {
            console.error('Failed to save settings:', error);
            toast.error("Failed to save settings");
        }
    };

    // Handle scan mode checkboxes
    const handleScanModeChange = (type: 'request' | 'response', checked: boolean) => {
        if (!settings) return;

        let newMode = ScanMode.NONE;

        // Current state
        const hasRequest = settings.scanMode === ScanMode.REQUEST_ONLY ||
            settings.scanMode === ScanMode.REQUEST_RESPONSE;
        const hasResponse = settings.scanMode === ScanMode.RESPONSE_ONLY ||
            settings.scanMode === ScanMode.REQUEST_RESPONSE;

        // Update based on which checkbox changed
        const willHaveRequest = type === 'request' ? checked : hasRequest;
        const willHaveResponse = type === 'response' ? checked : hasResponse;

        // Determine new mode based on combinations
        if (willHaveRequest && willHaveResponse) {
            newMode = ScanMode.REQUEST_RESPONSE;
        } else if (willHaveRequest) {
            newMode = ScanMode.REQUEST_ONLY;
        } else if (willHaveResponse) {
            newMode = ScanMode.RESPONSE_ONLY;
        } else {
            newMode = ScanMode.NONE;
        }

        updateSettings({ scanMode: newMode });
    };

    // Handle logout
    const handleLogout = async () => {
        if (!isLoggedIn) return;

        setIsLoggingOut(true);
        try {
            const result = await window.accountAPI.logout();

            if (result.success) {
                // Update local settings
                const updatedSettings = await window.settingsAPI.getAll();
                setSettings(updatedSettings);
                setLoginState(LoginState.NOT_LOGGED_IN);
                setAccountDetails(null);

                toast.success("Logged out successfully");
            } else {
                console.error("Logout failed", result.error);
                toast.error("Logout failed");
            }
        } catch (error) {
            console.error('Logout error:', error);
            toast.error("Failed to log out");
        } finally {
            setIsLoggingOut(false);
        }
    };

    // Handle upgrading to Pro
    const handleUpgrade = async () => {
        try {
            // Get the checkout link
            const result = await window.accountAPI.createCheckoutLink();

            if (result.success && result.url) {
                // Open the URL in the user's default browser
                await window.settingsAPI.openExternalUrl(result.url);
                toast.info("Opening checkout page in your browser");
            } else {
                console.error("Failed to generate checkout link", result.error);
                toast.error("Failed to generate checkout link");
            }
        } catch (error) {
            console.error('Upgrade error:', error);
            toast.error("Failed to process upgrade request");
        }
    };

    // Handler for retrying account details loading
    const handleRetryLoadDetails = async () => {
        if (!isLoggedIn) return;

        setLoginState(LoginState.LOADING_DETAILS);
        try {
            const response = await window.accountAPI.getDetails();
            if (response.success && response.details) {
                setAccountDetails(response.details);
                setLoginState(LoginState.LOGGED_IN);
                toast.success("Account details loaded successfully");
            } else {
                console.error("Could not load account details:", response.error);
                toast.error("Failed to load account details");
                setLoginState(LoginState.ERROR);
            }
        } catch (error) {
            console.error('Failed to load account details:', error);
            toast.error("Failed to load account details");
            setLoginState(LoginState.ERROR);
        }
    };

    // Handler for email login submit
    const handleEmailSubmit = async (email: string) => {
        try {
            setLoginState(LoginState.LOGGING_IN);
            // Close the login dialog
            setIsLoginDialogOpen(false);

            // Store the email temporarily
            setTempEmail(email);

            // Call the login API
            const result = await window.accountAPI.login(email);

            if (result.success) {
                // Show verification dialog
                setIsVerificationDialogOpen(true);
                setLoginState(LoginState.VERIFYING_EMAIL);
                toast.success("Login link sent successfully");
            } else {
                console.error("Login request failed", result.error);
                toast.error("Failed to send login link");
                setLoginState(LoginState.NOT_LOGGED_IN);
            }
        } catch (error) {
            console.error('Login error:', error);
            toast.error("Failed to process login request");
            setLoginState(LoginState.NOT_LOGGED_IN);
        }
    };

    // Handler for resend email
    const handleResendEmail = async () => {
        if (!tempEmail) return;

        try {
            toast.info("Resending login link...");
            // Call the login API again with the same email
            const result = await window.accountAPI.login(tempEmail);

            if (!result.success) {
                console.error("Failed to resend login email", result.error);
                toast.error("Failed to resend login link");
            } else {
                toast.success("Login link resent successfully");
            }
        } catch (error) {
            console.error('Resend email error:', error);
            toast.error("Failed to resend login link");
        }
    };

    // Handle opening signatures directory
    const handleOpenLogsDirectory = async () => {
        try {
            await window.settingsAPI.openLogsDirectory();
            toast.info("Logs directory opened");
        } catch (error) {
            console.error('Failed to open logs directory:', error);
            toast.error("Failed to open logs directory");
        }
    };

    // Handle test security alert
    const handleTestSecurityAlert = async () => {
        if (isTestingSecurityAlert) return;

        setIsTestingSecurityAlert(true);
        try {
            toast.info("Triggering test security alert...");
            const result = await window.settingsAPI.triggerTestSecurityAlert();

            if (result.success) {
                const decision = result.allowed ? 'ALLOWED' : 'BLOCKED';
                toast.success(`Test security alert completed. Decision: ${decision}`);
            } else {
                console.error('Failed to trigger test security alert:', result.error);
                toast.error("Failed to trigger test security alert");
            }
        } catch (error) {
            console.error('Error triggering test security alert:', error);
            toast.error("Error triggering test security alert");
        } finally {
            setIsTestingSecurityAlert(false);
        }
    };

    // If settings aren't loaded yet, show loading state
    if (!settings) {
        return <div className="p-4">Loading settings...</div>;
    }

    // Determine scan mode checkbox states
    const requestEnabled = settings.scanMode === ScanMode.REQUEST_ONLY ||
        settings.scanMode === ScanMode.REQUEST_RESPONSE;
    const responseEnabled = settings.scanMode === ScanMode.RESPONSE_ONLY ||
        settings.scanMode === ScanMode.REQUEST_RESPONSE;

    // Render account section based on login state
    const renderAccountSection = () => {
        switch (loginState) {
            case LoginState.NOT_LOGGED_IN:
                return (
                    <div className="flex flex-col items-center justify-center py-4">
                        <User className="h-12 w-12 text-muted-foreground mb-4" />
                        <p className="text-center mb-4">
                            Log in to access your MCP Defender account and verify AI workflows.
                        </p>
                        <Button onClick={() => setIsLoginDialogOpen(true)}>
                            Log in with Email
                        </Button>
                    </div>
                );

            case LoginState.LOGGING_IN:
                return (
                    <div className="flex flex-col items-center justify-center py-4">
                        <div className="animate-pulse flex flex-col items-center gap-4">
                            <User className="h-12 w-12 text-muted-foreground" />
                            <p className="text-center">Logging in...</p>
                        </div>
                    </div>
                );

            case LoginState.VERIFYING_EMAIL:
                return (
                    <div className="flex flex-col items-center justify-center py-4">
                        <div className="flex flex-col items-center gap-4">
                            <User className="h-12 w-12 text-muted-foreground" />
                            <p className="text-center">
                                Please check your email and click the verification link.
                            </p>
                        </div>
                    </div>
                );

            case LoginState.LOADING_DETAILS:
                return (
                    <div className="flex flex-col items-center justify-center py-4">
                        <div className="animate-pulse flex flex-col items-center gap-4">
                            <User className="h-12 w-12 text-muted-foreground" />
                            <p className="text-center">Loading account details...</p>
                        </div>
                    </div>
                );

            case LoginState.ERROR:
                return (
                    <div className="space-y-4">
                        <div className="py-2 text-yellow-600">
                            {errorMessage || "Could not load account details."}
                        </div>
                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                onClick={handleRetryLoadDetails}
                                className="flex items-center gap-2"
                            >
                                <RefreshCw className="h-4 w-4" />
                                Retry
                            </Button>
                            <Button
                                onClick={() => setIsLoginDialogOpen(true)}
                            >
                                Log in Again
                            </Button>
                        </div>
                    </div>
                );

            case LoginState.LOGGED_IN:
                return accountDetails ? (
                    <div className="space-y-4">
                        <div className="grid md:grid-cols-2 gap-4">
                            <div>
                                <Label className="text-sm text-muted-foreground">Email</Label>
                                <p className="font-medium">{accountDetails.email}</p>
                            </div>
                            <div>
                                <Label className="text-sm text-muted-foreground">Plan</Label>
                                <p className="font-medium">{accountDetails.plan}</p>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <div className="flex justify-between">
                                <Label className="text-sm text-muted-foreground">Usage</Label>
                                <span className="text-sm">
                                    {accountDetails.usage} / {accountDetails.limit}
                                </span>
                            </div>
                            <Progress
                                value={(accountDetails.usage / accountDetails.limit) * 100}
                                className="h-2"
                            />
                        </div>

                        <div className="flex flex-col sm:flex-row gap-2 mt-4">
                            {accountDetails.plan === "Free" && (
                                <Button
                                    onClick={handleUpgrade}
                                    className="flex items-center gap-2"
                                >
                                    Upgrade to Pro
                                </Button>
                            )}
                            <Button
                                variant="outline"
                                onClick={handleLogout}
                                disabled={isLoggingOut}
                            >
                                <LogOut className="mr-2 h-4 w-4" />
                                {isLoggingOut ? "Logging out..." : "Log out"}
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center py-4">
                        <div className="animate-pulse">
                            <p className="text-center">Loading account details...</p>
                        </div>
                    </div>
                );

            default:
                return (
                    <div className="py-2 text-yellow-600">
                        Unknown state. Please refresh the application.
                    </div>
                );
        }
    };

    // Return the component with our navigation example
    return (
        <div className="p-4">
            {/* Account Settings Card */}
            <Card className="mb-4">
                <CardHeader>
                    <div className="flex items-start gap-3">
                        <UserCheck className="h-6 w-6 text-primary mt-0.5" />
                        <div>
                            <CardTitle>Account</CardTitle>
                            <CardDescription>
                                {isLoggedIn
                                    ? "Manage your MCP Defender account"
                                    : "Log in to access MCP Defender services"}
                            </CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {renderAccountSection()}
                </CardContent>
            </Card>

            {/* Verification Settings Card */}
            <Card className="mb-4">
                <CardHeader>
                    <div className="flex items-start gap-3">
                        <Shield className="h-6 w-6 text-primary mt-0.5" />
                        <div>
                            <CardTitle>Verification</CardTitle>
                            <CardDescription>Configure AI model and verification settings for security scanning</CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-col gap-6">
                        {/* Model Selection Section */}
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="llm-model" className="text-base">AI Model</Label>
                                <Select
                                    value={settings.llm.model || ''}
                                    onValueChange={handleModelChange}
                                >
                                    <SelectTrigger id="llm-model" className="w-full">
                                        <SelectValue placeholder="Select a model for verification" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {SUPPORTED_MODELS.map(model => (
                                            <SelectItem key={model.value} value={model.value}>
                                                {model.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <p className="text-sm text-muted-foreground">
                                    Choose the AI model that will verify your tool calls and responses.
                                </p>
                            </div>

                            {/* Provider-specific settings */}
                            {settings.llm.provider && settings.llm.provider !== 'mcp-defender' && (
                                <div className="border-t pt-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="api-key">{settings.llm.provider} API Key</Label>
                                        <Input
                                            id="api-key"
                                            type="password"
                                            placeholder="sk-..."
                                            value={apiKeyInputValue}
                                            onChange={(e) => handleApiKeyInputChange(e.target.value)}
                                            className="flex-1"
                                        />
                                        <p className="text-sm text-muted-foreground">
                                            API key will be stored locally and securely.
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* MCP Defender not logged in warning */}
                            {settings.llm.provider === 'mcp-defender' && !isLoggedIn && (
                                <Alert variant="destructive">
                                    <AlertCircle className="h-4 w-4" />
                                    <AlertTitle>Error</AlertTitle>
                                    <AlertDescription>
                                        <div> You need to log in to use MCP Defender verification.</div>
                                        <Button variant="destructive" size="sm" className="mt-2" onClick={() => setIsLoginDialogOpen(true)}>
                                            Log in now
                                        </Button>
                                    </AlertDescription>
                                </Alert>
                            )}
                        </div>

                        {/* Verification Mode Section */}
                        <div className="border-t pt-4 space-y-4">
                            <div>
                                <Label className="text-base">Verification Mode</Label>
                                <p className="text-sm text-muted-foreground">
                                    Choose which MCP communications should be verified against security signatures.
                                </p>
                            </div>
                            <div className="space-y-3">
                                <div className="flex items-center space-x-2">
                                    <Checkbox
                                        id="verify-request"
                                        checked={requestEnabled}
                                        onCheckedChange={(checked) => handleScanModeChange('request', !!checked)}
                                    />
                                    <Label htmlFor="verify-request">Verify tool requests</Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <Checkbox
                                        id="verify-response"
                                        checked={responseEnabled}
                                        onCheckedChange={(checked) => handleScanModeChange('response', !!checked)}
                                    />
                                    <Label htmlFor="verify-response">Verify tool responses</Label>
                                </div>
                            </div>
                            {settings.scanMode === ScanMode.NONE && (
                                <div className="mt-2 p-3 bg-yellow-50 text-yellow-800 rounded-md text-sm">
                                    <strong>Warning:</strong> When verification is disabled, all tool calls and responses
                                    will be allowed without security checks. Only use this setting when security is not a concern.
                                </div>
                            )}
                        </div>

                        {/* Transport Settings Section - commenting this out for now*/}
                        {/* <div className="border-t pt-4 space-y-4">
                            <div>
                                <Label className="text-base">Transport Settings</Label>
                                <p className="text-sm text-muted-foreground">
                                    Configure how MCP communications are handled
                                </p>
                            </div>
                            <div className="flex items-center justify-between space-x-2">
                                <div>
                                    <Label htmlFor="enable-sse-proxying" className="text-sm">Enable SSE Proxying</Label>
                                    <p className="text-xs text-muted-foreground">
                                        Proxy Server-Sent Events (SSE) transport through MCP Defender.
                                        Disable if experiencing connection issues with SSE-based MCP servers.
                                    </p>
                                </div>
                                <Switch
                                    id="enable-sse-proxying"
                                    checked={settings.enableSSEProxying}
                                    onCheckedChange={(checked) => {
                                        updateSettings({ enableSSEProxying: checked });
                                    }}
                                />
                            </div>
                            {!settings.enableSSEProxying && (
                                <div className="mt-2 p-3 bg-blue-50 text-blue-800 rounded-md text-sm">
                                    <strong>Note:</strong> SSE servers will not be protected when SSE proxying is disabled.
                                    Only STDIO-based MCP servers will be monitored for security threats.
                                </div>
                            )}
                        </div> */}
                    </div>
                </CardContent>
            </Card>

            {/* MCP Secure Tools Card */}
            <Card className="mb-4">
                <CardHeader>
                    <div className="flex items-start gap-3">
                        <Shield className="h-6 w-6 text-primary mt-0.5" />
                        <div>
                            <CardTitle>MCP Secure Tools</CardTitle>
                            <CardDescription>
                                Enable MCP Defender's built-in secure tools for common operations like file system access,
                                web requests, and system commands with enhanced security verification
                            </CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center justify-between space-x-2">
                        <div>
                            <Label htmlFor="use-secure-tools" className="text-sm">Use MCP Defender Secure Tools</Label>
                            <p className="text-xs text-muted-foreground">
                                Automatically include MCP Defender's secure tools server in your MCP configuration.
                                These tools provide safer alternatives to standard file, network, and system operations.
                            </p>
                        </div>
                        <Switch
                            id="use-secure-tools"
                            checked={settings.useMCPDefenderSecureTools}
                            onCheckedChange={(checked) => {
                                updateSettings({ useMCPDefenderSecureTools: checked });
                            }}
                        />
                    </div>
                </CardContent>
            </Card>

            {/* General Settings Card */}
            <Card className="mb-4">
                <CardHeader>
                    <div className="flex items-start gap-3">
                        <Cog className="h-6 w-6 text-primary mt-0.5" />
                        <div>
                            <CardTitle>General</CardTitle>
                            <CardDescription>Application and system settings</CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-col gap-6">
                        {/* Notifications Section */}
                        <div className="space-y-4">
                            <div>
                                <Label className="text-base">Notifications</Label>
                                <p className="text-sm text-muted-foreground">
                                    Configure when to show notifications
                                </p>
                            </div>
                            <div className="flex items-center justify-between space-x-2">
                                <div>
                                    <Label htmlFor="notify-config-updates" className="text-sm">Configuration Updates</Label>
                                    <p className="text-xs text-muted-foreground">
                                        Show notifications when application configurations change
                                    </p>
                                </div>
                                <Switch
                                    id="notify-config-updates"
                                    checked={!!(settings.notificationSettings & NotificationSettings.CONFIG_UPDATES)}
                                    onCheckedChange={(checked) => {
                                        const newSettings = checked
                                            ? settings.notificationSettings | NotificationSettings.CONFIG_UPDATES
                                            : settings.notificationSettings & ~NotificationSettings.CONFIG_UPDATES;

                                        updateSettings({ notificationSettings: newSettings });
                                    }}
                                />
                            </div>
                        </div>

                        {/* System Integration Section */}
                        <div className="border-t pt-4 space-y-4">
                            <div>
                                <Label className="text-base">System Integration</Label>
                                <p className="text-sm text-muted-foreground">
                                    Configure how MCP Defender integrates with your system
                                </p>
                            </div>
                            <div className="flex items-center justify-between space-x-2">
                                <div>
                                    <Label htmlFor="start-on-login" className="text-sm">Start on Login</Label>
                                    <p className="text-xs text-muted-foreground">
                                        Automatically start MCP Defender when you log into your computer
                                    </p>
                                </div>
                                <Switch
                                    id="start-on-login"
                                    checked={settings.startOnLogin}
                                    onCheckedChange={(checked) => {
                                        updateSettings({ startOnLogin: checked });
                                    }}
                                />
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Developer Card */}
            <Card className="mb-4">
                <CardHeader>
                    <div className="flex items-start gap-3">
                        <Bug className="h-6 w-6 text-primary mt-0.5" />
                        <div>
                            <CardTitle>Developer</CardTitle>
                            <CardDescription>Development and testing tools</CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-col gap-4">
                        <div className="space-y-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <Button
                                    variant="outline"
                                    onClick={handleOpenLogsDirectory}
                                    className="flex items-center gap-2"
                                >
                                    <FolderOpen className="h-4 w-4" />
                                    Open Logs Directory
                                </Button>
                                <Button
                                    variant="outline"
                                    onClick={handleTestSecurityAlert}
                                    disabled={isTestingSecurityAlert}
                                    className="flex items-center gap-2"
                                >
                                    <Shield className="h-4 w-4" />
                                    {isTestingSecurityAlert ? "Testing..." : "Test Security Alert"}
                                </Button>
                            </div>
                            <div className="text-sm text-muted-foreground">
                                <p>
                                    <strong>Test Security Alert:</strong> Triggers a mock security violation to test the alert system.
                                    This simulates a potentially harmful tool call being blocked by MCP Defender.
                                </p>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Login Dialog */}
            <LoginDialog
                open={isLoginDialogOpen}
                onOpenChange={setIsLoginDialogOpen}
                onEmailSubmit={handleEmailSubmit}
            />

            {/* Email Verification Dialog */}
            <EmailVerificationDialog
                open={isVerificationDialogOpen}
                onOpenChange={setIsVerificationDialogOpen}
                email={tempEmail}
                onResendEmail={handleResendEmail}
            />
        </div>
    )
} 