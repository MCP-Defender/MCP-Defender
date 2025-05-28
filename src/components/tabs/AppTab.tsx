import { Button } from "@/components/ui/button"
import {
    Settings2,
    FileJson,
    AlertCircle,
    ShieldCheck,
    ShieldAlert,
    ShieldOff,
    ShieldX,
    AlertTriangle,
    RefreshCw,
    Shield
} from "lucide-react"
import {
    Card,
    CardContent,
    CardFooter,
    CardHeader,
    CardTitle,
    CardDescription,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useState, useEffect, useCallback, useRef } from "react"
import {
    MCPApplication,
    ProtectionStatus,
    ProtectedServerConfig,
    ServerTool,
    MCPDefenderEnvVar
} from "@/services/configurations/types"

import { AppIcon } from "@/components/ui/app-icon"
import { TextShimmer } from "@/components/ui/text-shimmer"

// Main AppTab component
export default function AppTab() {
    // Add state for MCP applications
    const [applications, setApplications] = useState<MCPApplication[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Track if we've already triggered discovery to prevent loops
    const discoveryTriggeredRef = useRef(false);

    // Check for all servers without tools and trigger discovery
    const discoverAllServerTools = useCallback(() => {
        // Skip if not loaded or already triggered discovery
        if (isLoading || discoveryTriggeredRef.current) return;

        console.log("Checking for servers without tools...");

        // Mark that we've triggered discovery
        discoveryTriggeredRef.current = true;

        // Discover tools for all servers without tools
        window.configurationAPI.discoverAllServerTools()
            .then(result => {
                console.log("Tool discovery triggered:", result);
            })
            .catch(error => {
                console.error("Error starting tool discovery:", error);
                // Reset the flag on error so it can be retried
                discoveryTriggeredRef.current = false;
            });
    }, [isLoading]); // Removed applications dependency to prevent loop

    // Fetch initial applications and subscribe to updates
    useEffect(() => {
        let applicationUpdateUnsubscribe: (() => void) | undefined;
        let allApplicationsUpdateUnsubscribe: (() => void) | undefined;

        // Initial fetch of applications
        if (window.configurationAPI) {
            window.configurationAPI.getApplications()
                .then(apps => {
                    console.log("Initial applications:", apps);
                    setApplications(apps);
                    setIsLoading(false);
                })
                .catch(error => {
                    console.error("Error fetching applications:", error);
                    setIsLoading(false);
                });

            // Subscribe to individual application updates
            applicationUpdateUnsubscribe = window.configurationAPI.onApplicationUpdate((app) => {
                console.log("Application update:", app);
                setApplications(prev => {
                    // Replace the updated application in the array
                    const index = prev.findIndex(a => a.name === app.name);
                    if (index >= 0) {
                        const newApps = [...prev];
                        newApps[index] = app;
                        return newApps;
                    }
                    // Or add it if it doesn't exist
                    return [...prev, app];
                });
            });

            // Subscribe to all applications updates for more efficient updates
            allApplicationsUpdateUnsubscribe = window.configurationAPI.onAllApplicationsUpdate((apps) => {
                console.log("All applications update:", apps);
                setApplications(apps);
            });
        }

        // Cleanup on unmount
        return () => {
            if (applicationUpdateUnsubscribe) applicationUpdateUnsubscribe();
            if (allApplicationsUpdateUnsubscribe) allApplicationsUpdateUnsubscribe();
        };
    }, []);

    // Trigger tool discovery only once when applications are initially loaded
    useEffect(() => {
        if (!isLoading && !discoveryTriggeredRef.current) {
            discoverAllServerTools();
        }
    }, [isLoading, discoverAllServerTools]);

    return (
        <div className="p-4">
            <div className="grid grid-cols-1 gap-4">
                {/* Show loading state if needed */}
                {isLoading ? (
                    <div className="flex justify-center items-center h-32">
                        <div className="animate-spin text-2xl">⟳</div>
                        <span className="ml-2">Loading applications...</span>
                    </div>
                ) : (
                    /* Render each application card */
                    applications.map(app => (
                        <Card key={app.name} className={app.status === ProtectionStatus.Protected ? "border-green-500" : ""}>
                            <CardHeader>
                                <div className="flex flex-row justify-between">
                                    <div className="flex flex-row gap-2">
                                        <AppIcon appName={app.name} />
                                        <div className="flex flex-col">
                                            <div className="text font-semibold">
                                                {app.name}
                                            </div>
                                            <div className="flex flex-row items-center gap-2 pt-2">
                                                <StatusBadge
                                                    status={app.status}
                                                    message={app.statusMessage}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </CardHeader>
                            {app.servers.length > 0 && (
                                <MCPServerCards servers={app.servers} />
                            )}
                        </Card>
                    ))
                )}
            </div>
        </div>
    );
}

// UI Components
const StatusBadge = ({ status, message }: { status: ProtectionStatus, message?: string }) => (
    <div className="flex flex-row items-center gap-2">
        {status === ProtectionStatus.Protected && (
            <Badge variant="success" className="bg-green-500">Protected</Badge>
        )}
        {status === ProtectionStatus.Loading && (
            <Badge variant="secondary">Loading</Badge>
        )}
        {status === ProtectionStatus.Error && (
            <Badge variant="destructive">Error</Badge>
        )}

        {message && (
            <span className="text-xs text-muted-foreground">{message}</span>
        )}
    </div>
);

const MCPServerCards = ({ servers }: { servers: ProtectedServerConfig[] }) => {
    // Skip if no servers
    if (servers.length === 0) {
        return null;
    }

    return (
        <CardContent>
            <div className="grid grid-cols-1 gap-4 mt-4">
                {servers.map((server) => {
                    const serverConfig = server.config;

                    // Helper to get original URL or command
                    const getOriginalValue = () => {
                        if ('url' in serverConfig) {
                            // For SSE servers, get the original URL from env
                            return serverConfig.env?.[MCPDefenderEnvVar.OriginalUrl] || serverConfig.url;
                        } else {
                            // For STDIO servers, get original command and args from env or current config
                            const originalCmd = serverConfig.env?.[MCPDefenderEnvVar.OriginalCommand] || serverConfig.command;
                            const originalArgs = serverConfig.env?.[MCPDefenderEnvVar.OriginalArgs] ?
                                JSON.parse(serverConfig.env[MCPDefenderEnvVar.OriginalArgs]) :
                                serverConfig.args;

                            return `${originalCmd} ${Array.isArray(originalArgs) ? originalArgs.join(' ') : ''}`;
                        }
                    };

                    return (
                        <Card key={server.serverName} className="bg-muted/30">
                            <CardHeader className="py-3">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <CardTitle className="text-base">{server.serverName}</CardTitle>
                                        <CardDescription>
                                            <div className="flex gap-1">
                                                <span className="text-xs font-semibold">
                                                    {'url' in serverConfig ? 'SSE:' : 'STDIO:'}
                                                </span>
                                                <p className="text-xs font-mono line-clamp-2">
                                                    {getOriginalValue()}
                                                </p>
                                            </div>
                                        </CardDescription>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent className="">
                                {/* Show discovering state with shimmer effect */}
                                {server.isDiscovering && (
                                    <div className="mb-2">
                                        <TextShimmer className="text-sm font-semibold">
                                            Discovering tools...
                                        </TextShimmer>
                                    </div>
                                )}

                                {/* Show tools if available */}
                                {server.tools && server.tools.length > 0 && (
                                    <div className="">
                                        <div className="flex flex-wrap items-center gap-1">
                                            {server.tools.map((tool: ServerTool) => (
                                                <Badge key={tool.name} variant="outline" className="text-xs bg-muted/50">
                                                    {tool.name}
                                                </Badge>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Show message if no tools and not discovering */}
                                {(!server.tools || server.tools.length === 0) && !server.isDiscovering && (
                                    <div className="text-sm text-muted-foreground">
                                        No tools detected
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    );
                })}
            </div>
        </CardContent>
    );
};
