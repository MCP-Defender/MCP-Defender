import React, { useState, useEffect } from "react";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
    CardFooter
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AppIcon } from "@/components/ui/app-icon";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table";
import {
    Shield,
    AlertTriangle,
    Clock,
    Check,
    X,
    ShieldAlert,
    Timer
} from "lucide-react";
import { ScanResult, SignatureVerification } from "@/services/scans/types";
import { Progress } from "@/components/ui/progress";

// Component for the security alert view in a new window
export default function SecurityAlertView() {
    const [scan, setScan] = useState<ScanResult | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [secondsRemaining, setSecondsRemaining] = useState(30);
    const [remember, setRemember] = useState(false);

    useEffect(() => {
        // Fetch the scan ID from the URL
        const hash = window.location.hash;
        const scanId = hash.replace(/^#\/security-alert\//, '');

        if (!scanId) {
            setError("Scan ID not found in URL");
            setIsLoading(false);
            return;
        }

        // Fetch scan details using the scan ID
        if (window.scanAPI) {
            window.scanAPI.getTemporaryScanById(scanId)
                .then((result: ScanResult | null) => {
                    if (result) {
                        setScan(result);
                    } else {
                        setError(`Scan with ID ${scanId} not found`);
                    }
                    setIsLoading(false);
                })
                .catch((err: Error) => {
                    console.error("Error fetching scan details:", err);
                    setError("Failed to load scan details");
                    setIsLoading(false);
                });
        } else {
            setError("Scan API not available");
            setIsLoading(false);
        }

        // Set up countdown timer
        const timer = setInterval(() => {
            setSecondsRemaining(prev => {
                if (prev <= 1) {
                    // Time's up, send the default decision (block)
                    handleDecision(false);
                    clearInterval(timer);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        // Clean up timer on unmount
        return () => clearInterval(timer);
    }, []);

    // Extract failed signature verifications from the map for display
    const extractFailedVerifications = (scan: ScanResult): SignatureVerification[] => {
        if (!scan || !scan.signatureVerifications) return [];

        const verifications: SignatureVerification[] = [];

        // Iterate through each signature ID
        Object.keys(scan.signatureVerifications).forEach(signatureId => {
            // For each signature ID, iterate through model verifications
            const modelVerifications = scan.signatureVerifications[signatureId];
            Object.keys(modelVerifications).forEach(modelName => {
                const verification = modelVerifications[modelName];
                if (!verification.allowed) {
                    verifications.push(verification);
                }
            });
        });

        return verifications;
    };

    // Handle the decision (allow or block)
    const handleDecision = (allowed: boolean) => {
        if (!scan) return;

        // Get the scan ID from the URL
        const hash = window.location.hash;
        const scanId = hash.replace(/^#\/security-alert\//, '');

        // Send the decision to the main process
        if (window.securityAPI) {
            console.log(`Sending decision for ${scanId}: ${allowed ? 'ALLOW' : 'BLOCK'}, remember: ${remember}`);
            window.securityAPI.sendDecision(scanId, allowed, remember);

            // Close the window immediately - the main process will also close it,
            // but this makes the UI feel more responsive
            window.close();
        } else {
            console.error("Security API not available");
        }
    };

    // Toggle remember decision
    const toggleRemember = () => {
        setRemember(!remember);
    };

    // Show loading state
    if (isLoading) {
        return (
            <div className="flex justify-center items-center h-screen">
                <div className="animate-spin text-2xl">⟳</div>
                <span className="ml-2">Loading security alert...</span>
            </div>
        );
    }

    // Show error state
    if (error) {
        return (
            <div className="flex justify-center items-center h-screen">
                <Card className="w-[500px]">
                    <CardHeader>
                        <CardTitle className="text-red-500 flex items-center gap-2">
                            <AlertTriangle />
                            Error Loading Security Alert
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p>{error}</p>
                        <Button
                            className="mt-4"
                            onClick={() => window.close()}
                        >
                            Close Window
                        </Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    // Show scan not found state
    if (!scan) {
        return (
            <div className="flex justify-center items-center h-screen">
                <Card className="w-[500px]">
                    <CardHeader>
                        <CardTitle className="text-yellow-500 flex items-center gap-2">
                            <AlertTriangle />
                            Alert Not Found
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p>The requested security alert could not be found.</p>
                        <Button
                            className="mt-4"
                            onClick={() => window.close()}
                        >
                            Close Window
                        </Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="flex justify-center items-center min-h-screen bg-background/80 backdrop-blur-sm p-6">
            {/* Header with status */}
            <Card className="border-red-500 w-full max-w-[550px] shadow-xl">
                <CardHeader className="bg-red-50 dark:bg-red-950/20 pb-4">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="flex items-center justify-center bg-red-100 dark:bg-red-900/30 p-2 rounded-full">
                            <ShieldAlert className="h-6 w-6 text-red-500" />
                        </div>
                        <div>
                            <CardTitle>Security Alert</CardTitle>
                            <CardDescription className="text-base mt-1 font-medium">
                                MCP Defender blocked a potentially unsafe operation
                            </CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="pt-6">
                    {/* Application info */}
                    <div className="flex items-center gap-3 mb-4">
                        <AppIcon appName={scan.appName} size="md" />
                        <div>
                            <h3 className="font-medium">{scan.appName}</h3>
                            <div className="text-sm text-muted-foreground">
                                Server: {scan.serverName}
                                {scan.serverVersion && ` (v${scan.serverVersion})`}
                            </div>
                        </div>
                    </div>

                    {/* Tool info */}
                    <div className="mb-4">
                        <h3 className="font-medium mb-1">Operation</h3>
                        <div className="text-sm font-mono bg-muted p-2 rounded">
                            {scan.toolName}
                        </div>
                    </div>

                    {/* Violation info */}
                    <div>
                        <h3 className="font-medium mb-2">Security Violations</h3>
                        <div className="max-h-[200px] overflow-y-auto border rounded-md">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-[180px]">Signature</TableHead>
                                        <TableHead>Reason</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {extractFailedVerifications(scan).map((verification, idx) => (
                                        <TableRow key={idx}>
                                            <TableCell className="font-medium">
                                                {verification.signatureName}
                                            </TableCell>
                                            <TableCell className="max-w-[250px]">
                                                <div className="whitespace-normal text-xs break-words">
                                                    {verification.reason}
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </div>
                </CardContent>
                <CardFooter className="flex-col gap-4 border-t pt-4 bg-muted/20">
                    {/* Timer */}
                    <div className="w-full">
                        <div className="flex justify-between text-sm mb-1">
                            <span className="flex items-center gap-1 text-red-500 font-medium">
                                <Timer className="h-3 w-3" />
                                Operation will be blocked in {secondsRemaining} seconds
                            </span>
                            <span>{secondsRemaining}/30</span>
                        </div>
                        <Progress value={(secondsRemaining / 30) * 100} className="h-2" />
                    </div>

                    {/* Remember checkbox */}
                    <div className="flex items-center w-full">
                        <input
                            type="checkbox"
                            id="remember-decision"
                            checked={remember}
                            onChange={toggleRemember}
                            className="mr-2"
                        />
                        <label htmlFor="remember-decision" className="text-sm">
                            Remember decision for this tool
                        </label>
                    </div>

                    {/* Action buttons */}
                    <div className="flex justify-between w-full">
                        <Button
                            variant="outline"
                            onClick={() => handleDecision(true)}
                            className="flex-1 mr-2"
                        >
                            Allow Operation
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={() => handleDecision(false)}
                            className="flex-1"
                        >
                            Block Operation
                        </Button>
                    </div>
                </CardFooter>
            </Card>
        </div>
    );
} 