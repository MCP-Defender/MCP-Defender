import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { FolderOpen, Bug, Shield, Cog } from "lucide-react"
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
import { toast } from "sonner"


// Props interface
interface SettingsViewProps {
    standalone?: boolean;
}

// Models supported by the application
const SUPPORTED_MODELS = [
    { value: "gpt-5", label: "GPT-5", provider: "OpenAI" },
    { value: "gpt-4.1-2025-04-14", label: "GPT-4.1", provider: "OpenAI" },
    { value: "gpt-4o-mini-2024-07-18", label: "GPT-4o Mini", provider: "OpenAI" },
];


// Main SettingsView component
export default function SettingsView({ standalone = false }: SettingsViewProps) {
    // State for all settings
    const [settings, setSettings] = useState<Settings | null>(null);
    const [apiKeyInputValue, setApiKeyInputValue] = useState("");
    const [apiKeyTimer, setApiKeyTimer] = useState<NodeJS.Timeout | null>(null);
    const [isTestingSecurityAlert, setIsTestingSecurityAlert] = useState(false);

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
            } catch (error) {
                console.error('Failed to load settings:', error);
                toast.error("Failed to load application settings");
            }
        };

        loadSettings();
    }, []);



    // Handle model selection
    const handleModelChange = (model: string) => {
        if (!settings) return;

        // Find the selected model's provider
        const selectedModel = SUPPORTED_MODELS.find(m => m.value === model);
        const provider = selectedModel?.provider || '';

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


    // Return the component with our navigation example
    return (
        <div className="p-4">

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
                                    value={settings.llm.model || 'gpt-5'}
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
                            {settings.llm.provider && (
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

        </div>
    )
} 