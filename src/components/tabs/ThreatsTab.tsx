import {
    Card,
    CardContent,
    CardFooter,
    CardHeader,
    CardTitle,
    CardDescription,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { useState, useEffect, useMemo, useCallback } from "react"
import { ScanResult, SignatureVerification, SignatureVerificationMap } from "@/services/scans/types"
import {
    Table,
    TableBody,
    TableCaption,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
    ShieldAlert,
    ShieldCheck,
    Info,
    AlertTriangle,
    Search,
    Eye,
    BarChart3,
    ClipboardList,
    Check,
    X,
    Clock,
    TrendingUp,
    ArrowDown,
    ArrowUp
} from "lucide-react"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogClose,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { AppIcon } from "@/components/ui/app-icon"
import { TextShimmer } from "@/components/ui/text-shimmer"
import {
    CartesianGrid,
    Line,
    LineChart,
    ResponsiveContainer,
    XAxis,
    YAxis,
    Tooltip,
    Legend,
    Area,
    AreaChart
} from "recharts"
import {
    ChartConfig,
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
} from "@/components/ui/chart"

export default function ThreatsTab() {
    // Add state for scan results
    const [scanResults, setScanResults] = useState<ScanResult[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedScan, setSelectedScan] = useState<ScanResult | null>(null);
    const [openWindowsCount, setOpenWindowsCount] = useState(0);

    // Format date for display (full)
    const formatDate = (date: Date) => {
        if (!(date instanceof Date)) {
            // Convert string date to Date object if needed
            date = new Date(date);
        }

        return new Intl.DateTimeFormat('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        }).format(date);
    };

    // Format relative time for display
    const formatRelativeTime = (date: Date) => {
        if (!(date instanceof Date)) {
            // Convert string date to Date object if needed
            date = new Date(date);
        }

        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffSec = Math.floor(diffMs / 1000);
        const diffMin = Math.floor(diffSec / 60);
        const diffHour = Math.floor(diffMin / 60);
        const diffDay = Math.floor(diffHour / 24);

        // Show relative time for recent items
        if (diffSec < 60) {
            return 'just now';
        } else if (diffMin < 60) {
            return `${diffMin} ${diffMin === 1 ? 'minute' : 'minutes'} ago`;
        } else if (diffHour < 24) {
            return `${diffHour} ${diffHour === 1 ? 'hour' : 'hours'} ago`;
        } else if (diffDay < 7) {
            return `${diffDay} ${diffDay === 1 ? 'day' : 'days'} ago`;
        } else {
            // For older items, show the actual date
            return new Intl.DateTimeFormat('en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            }).format(date);
        }
    };

    // Format date for compact display in table
    const formatCompactDate = (date: Date) => {
        if (!(date instanceof Date)) {
            // Convert string date to Date object if needed
            date = new Date(date);
        }

        return new Intl.DateTimeFormat('en-US', {
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }).format(date);
    };

    // Format scan time for display (convert ms to readable format)
    const formatScanTime = (scanTimeMs: number) => {
        if (scanTimeMs < 1000) {
            return `${scanTimeMs}ms`;
        } else {
            return `${(scanTimeMs / 1000).toFixed(2)}s`;
        }
    };

    // Get row style based on verification result
    const getRowStyle = (allowed: boolean) => {
        if (!allowed) {
            return "bg-red-50 dark:bg-red-950/30";
        }
        return "";
    };

    // Format time label based on the data range
    const formatTimeLabel = (date: Date, oldestDate: Date, newestDate: Date): string => {
        const daysDiff = Math.floor((newestDate.getTime() - oldestDate.getTime()) / (24 * 60 * 60 * 1000));

        if (daysDiff < 1) {
            // Within same day, show hour:minute
            return new Intl.DateTimeFormat('en-US', {
                hour: 'numeric',
                minute: '2-digit'
            }).format(date);
        } else if (daysDiff < 7) {
            // Within a week, show day and time
            return new Intl.DateTimeFormat('en-US', {
                weekday: 'short',
                hour: 'numeric'
            }).format(date);
        } else {
            // Longer range, show month/day
            return new Intl.DateTimeFormat('en-US', {
                month: 'short',
                day: 'numeric'
            }).format(date);
        }
    };

    // Fill gaps in data for better visualization when we have few data points
    const fillDataGaps = (data: Array<{ timestamp: number, time: string, allowed: number, blocked: number, total: number }>, interval: number): Array<{ timestamp: number, time: string, allowed: number, blocked: number, total: number }> => {
        if (data.length <= 1) return data;

        const result: Array<{ timestamp: number, time: string, allowed: number, blocked: number, total: number }> = [data[0]];

        for (let i = 1; i < data.length; i++) {
            const prevTimestamp = data[i - 1].timestamp;
            const currentTimestamp = data[i].timestamp;
            const gap = currentTimestamp - prevTimestamp;

            // If gap is more than 3 times the interval, add some points in between
            if (gap > interval * 3) {
                // Add a mid-point
                const midTimestamp = prevTimestamp + Math.floor(gap / 2);
                const midDate = new Date(midTimestamp);
                const timeLabel = formatTimeLabel(midDate, new Date(data[0].timestamp), new Date(data[data.length - 1].timestamp));

                result.push({
                    time: timeLabel,
                    allowed: 0,
                    blocked: 0,
                    total: 0,
                    timestamp: midTimestamp
                });
            }

            // Add the current point
            result.push(data[i]);
        }

        return result;
    };


    // Truncate text if too long
    const truncateText = (text: string, maxLength: number = 50) => {
        if (!text) return "";
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength) + "...";
    };

    // Subscribe to scan results updates
    useEffect(() => {
        let scanResultsUnsubscribe: (() => void) | undefined;

        if (window.scanAPI) {
            // Get initial scan results
            window.scanAPI.getScanResults()
                .then(results => {
                    console.log("Initial scan results:", results);
                    setScanResults(results);
                    setIsLoading(false);
                })
                .catch(error => {
                    console.error("Error getting scan results:", error);
                    setIsLoading(false);
                });

            // Subscribe to scan results updates
            scanResultsUnsubscribe = window.scanAPI.onScanResultsUpdate((results) => {
                console.log("Scan results update:", results);
                setScanResults(results);
            });
        }

        // Cleanup on unmount
        return () => {
            if (scanResultsUnsubscribe) scanResultsUnsubscribe();
        };
    }, []);

    // Extract all signature verifications from the map for display
    const extractSignatureVerifications = (scan: ScanResult): SignatureVerification[] => {
        if (!scan.signatureVerifications) return [];

        const verifications: SignatureVerification[] = [];

        // Iterate through each signature ID
        Object.keys(scan.signatureVerifications).forEach(signatureId => {
            // For each signature ID, iterate through model verifications
            const modelVerifications = scan.signatureVerifications[signatureId];
            Object.keys(modelVerifications).forEach(modelName => {
                verifications.push(modelVerifications[modelName]);
            });
        });

        return verifications;
    };

    // Prepare chart data based on scan results
    const chartData = useMemo((): {
        data: { time: string; allowed: number; blocked: number; total: number, timestamp: number }[];
        timeFrameDescription: string;
    } | {
        data: [];
        timeFrameDescription: string;
    } => {
        if (!scanResults.length) return { data: [], timeFrameDescription: "" };

        // Get the time range of the scans
        const now = new Date();
        const scanDates = scanResults.map(r => new Date(r.date).getTime());
        const oldestScanDate = new Date(Math.min(...scanDates));
        const newestScanDate = new Date(Math.max(...scanDates));

        // Determine the appropriate time description
        const timeDiff = now.getTime() - oldestScanDate.getTime();
        const oneDay = 24 * 60 * 60 * 1000;
        const oneWeek = 7 * oneDay;

        let timeFrameDescription: string;

        if (timeDiff <= oneDay) {
            timeFrameDescription = 'Last 24 hours';
        } else if (timeDiff <= oneWeek) {
            timeFrameDescription = 'Last 7 days';
        } else {
            timeFrameDescription = 'Last few weeks';
        }

        // For sparse data, directly use scan events rather than fixed intervals
        // Group by unique timestamps rounded to the nearest 15 minutes
        const timeAggregation = 15 * 60 * 1000; // 15 minutes
        const buckets: Map<number, { allowed: number, blocked: number, time: Date }> = new Map();

        // Group scan results by timestamp
        scanResults.forEach(scan => {
            const date = new Date(scan.date);
            // Round to the nearest timeAggregation
            const timestamp = Math.floor(date.getTime() / timeAggregation) * timeAggregation;

            // Get or create bucket
            if (!buckets.has(timestamp)) {
                buckets.set(timestamp, {
                    allowed: 0,
                    blocked: 0,
                    time: new Date(timestamp)
                });
            }

            // Add scan to bucket
            const bucket = buckets.get(timestamp)!;
            if (scan.allowed) {
                bucket.allowed++;
            } else {
                bucket.blocked++;
            }
        });

        // Convert buckets to chart data
        let data = Array.from(buckets.entries())
            .sort(([a], [b]) => a - b)
            .map(([timestamp, bucket]) => {
                const timeLabel = formatTimeLabel(new Date(timestamp), oldestScanDate, newestScanDate);

                return {
                    time: timeLabel,
                    allowed: bucket.allowed,
                    blocked: bucket.blocked,
                    total: bucket.allowed + bucket.blocked,
                    timestamp: timestamp
                };
            });

        // For very sparse data (few points), we might want to ensure we have enough points
        // by adding empty points between wide gaps
        if (data.length >= 2 && data.length < 5) {
            data = fillDataGaps(data, timeAggregation);
        }

        return { data, timeFrameDescription };
    }, [scanResults]);

    // Chart configuration
    const chartConfig = {
        allowed: {
            label: "Allowed",
            color: "hsl(var(--chart-2))",
        },
        blocked: {
            label: "Blocked",
            color: "hsl(var(--chart-1))",
        },
    } satisfies ChartConfig;

    // Get the current number of open scan detail windows
    const updateOpenWindowsCount = useCallback(async () => {
        if (window.scanAPI) {
            const count = await window.scanAPI.getScanDetailWindowCount();
            setOpenWindowsCount(count);
        }
    }, []);

    // Focus all open scan detail windows
    const focusAllWindows = useCallback(async () => {
        if (window.scanAPI) {
            await window.scanAPI.focusAllScanDetailWindows();
            await updateOpenWindowsCount();
        }
    }, [updateOpenWindowsCount]);

    // Close all open scan detail windows
    const closeAllWindows = useCallback(async () => {
        if (window.scanAPI) {
            await window.scanAPI.closeAllScanDetailWindows();
            await updateOpenWindowsCount();
        }
    }, [updateOpenWindowsCount]);

    // Handle row click to open scan detail window
    const handleRowClick = useCallback(async (scanId: string) => {
        if (window.scanAPI) {
            await window.scanAPI.openScanDetailWindow(scanId);
            await updateOpenWindowsCount();
        }
    }, [updateOpenWindowsCount]);

    // Update open windows count periodically
    useEffect(() => {
        updateOpenWindowsCount();

        // Update count every 2 seconds
        const interval = setInterval(() => {
            updateOpenWindowsCount();
        }, 2000);

        return () => clearInterval(interval);
    }, [updateOpenWindowsCount]);

    return (
        <div className="p-4">
            {/* Threats Chart Card */}
            <Card className="mb-4">
                <CardHeader>
                    <div className="flex items-start gap-3">
                        <BarChart3 className="h-6 w-6 text-primary mt-0.5" />
                        <div>
                            <CardTitle>MCP Traffic</CardTitle>
                            <CardDescription>
                                {chartData.timeFrameDescription || "No data available"}
                            </CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <div className="flex justify-center items-center h-[200px]">
                            <div className="animate-spin text-2xl">⟳</div>
                            <span className="ml-2">Loading threat data...</span>
                        </div>
                    ) : scanResults.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-[200px] text-muted-foreground">
                            <AlertTriangle className="h-12 w-12 mb-2 opacity-50" />
                            <p>No threat data available</p>
                            <p className="text-sm mt-1">Tool calls will appear here once detected</p>
                        </div>
                    ) : chartData.data && chartData.data.length > 0 ? (
                        <div>
                            <div className="">
                                <ChartContainer config={chartConfig} className="max-h-[250px] w-full">
                                    <AreaChart
                                        data={chartData.data}
                                        margin={{
                                            top: 20,
                                            right: 30,
                                            left: 20,
                                            bottom: 20,
                                        }}
                                    >
                                        <CartesianGrid vertical={false} strokeDasharray="3 3" />
                                        <XAxis
                                            dataKey="time"
                                            tickLine={false}
                                            axisLine={false}
                                            tickMargin={8}
                                        />
                                        <YAxis
                                            tickLine={false}
                                            axisLine={false}
                                            tickMargin={8}
                                        />
                                        <ChartTooltip content={<ChartTooltipContent />} />
                                        <defs>
                                            <linearGradient id="fillAllowed" x1="0" y1="0" x2="0" y2="1">
                                                <stop
                                                    offset="5%"
                                                    stopColor="var(--color-allowed)"
                                                    stopOpacity={0.8}
                                                />
                                                <stop
                                                    offset="95%"
                                                    stopColor="var(--color-allowed)"
                                                    stopOpacity={0.1}
                                                />
                                            </linearGradient>
                                            <linearGradient id="fillBlocked" x1="0" y1="0" x2="0" y2="1">
                                                <stop
                                                    offset="5%"
                                                    stopColor="var(--color-blocked)"
                                                    stopOpacity={0.8}
                                                />
                                                <stop
                                                    offset="95%"
                                                    stopColor="var(--color-blocked)"
                                                    stopOpacity={0.1}
                                                />
                                            </linearGradient>
                                        </defs>
                                        <Area
                                            type="monotone"
                                            dataKey="allowed"
                                            name="Allowed"
                                            stroke="var(--color-allowed)"
                                            strokeWidth={2}
                                            fill="url(#fillAllowed)"
                                            fillOpacity={0.4}
                                            dot={{
                                                r: 4,
                                                fill: "var(--color-allowed)",
                                                strokeWidth: 1,
                                                stroke: "var(--background)"
                                            }}
                                            activeDot={{ r: 6 }}
                                        />
                                        <Area
                                            type="monotone"
                                            dataKey="blocked"
                                            name="Blocked"
                                            stroke="var(--color-blocked)"
                                            strokeWidth={2}
                                            fill="url(#fillBlocked)"
                                            fillOpacity={0.4}
                                            dot={{
                                                r: 4,
                                                fill: "var(--color-blocked)",
                                                strokeWidth: 1,
                                                stroke: "var(--background)"
                                            }}
                                            activeDot={{ r: 6 }}
                                        />
                                    </AreaChart>
                                </ChartContainer>
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-[200px] text-muted-foreground">
                            <AlertTriangle className="h-12 w-12 mb-2 opacity-50" />
                            <p>Not enough data to display chart</p>
                            <p className="text-sm mt-1">More tool calls needed to generate trends</p>
                        </div>
                    )}
                </CardContent>
                <CardFooter>

                </CardFooter>
            </Card>

            {/* Scan Activity Table */}
            <Card>
                <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                            <ClipboardList className="h-6 w-6 text-primary mt-0.5" />
                            <div>
                                <CardTitle>Scan Activity</CardTitle>
                                <CardDescription>Recent MCP tool call verification activity</CardDescription>
                            </div>
                        </div>

                        {openWindowsCount > 0 && (
                            <div className="flex items-center gap-2">
                                <Badge variant="outline" className="h-7">
                                    {openWindowsCount} {openWindowsCount === 1 ? 'window' : 'windows'} open
                                </Badge>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2"
                                    onClick={focusAllWindows}
                                >
                                    <Eye className="h-3.5 w-3.5 mr-1" />
                                    Focus
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-destructive"
                                    onClick={closeAllWindows}
                                >
                                    <X className="h-3.5 w-3.5 mr-1" />
                                    Close All
                                </Button>
                            </div>
                        )}
                    </div>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <div className="flex justify-center items-center h-32">
                            <div className="animate-spin text-2xl">⟳</div>
                            <span className="ml-2">Loading scan results...</span>
                        </div>
                    ) : scanResults.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                            No scan activity recorded yet.
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-[110px]">Time</TableHead>
                                    <TableHead className="w-[100px]">App</TableHead>
                                    <TableHead className="w-[120px]">Server</TableHead>
                                    <TableHead>Tool</TableHead>
                                    <TableHead className="w-[90px]">Type</TableHead>
                                    <TableHead className="w-[110px]">Status</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {scanResults.map((scan, index) => (
                                    <TableRow
                                        key={index}
                                        className={`${getRowStyle(scan.allowed)} cursor-pointer hover:bg-accent/50`}
                                        onClick={() => handleRowClick(scan.id)}
                                    >
                                        <TableCell className="text-xs text-muted-foreground">
                                            {formatRelativeTime(scan.date)}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center space-x-2">
                                                <AppIcon
                                                    appName={scan.appName}
                                                    size="sm"
                                                />
                                                <span className="text-sm">{scan.appName}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <span className="text-xs">{scan.serverName}</span>
                                            {scan.serverVersion !== "" && (
                                                <div className="text-xs text-muted-foreground">
                                                    v{scan.serverVersion}
                                                </div>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <span className="text-sm truncate block max-w-[180px]">
                                                {truncateText(scan.toolName, 25)}
                                            </span>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-1.5">
                                                {scan.isResponse ? (
                                                    <>
                                                        <ArrowDown className="h-4 w-4 text-muted-foreground" />
                                                        <span className="text-xs text-muted-foreground">Response</span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <ArrowUp className="h-4 w-4 text-muted-foreground" />
                                                        <span className="text-xs text-muted-foreground">Request</span>
                                                    </>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            {scan.state === 'in_progress' ? (
                                                <TextShimmer className="text-xs" duration={1.5}>
                                                    In progress...
                                                </TextShimmer>
                                            ) : !scan.allowed ? (
                                                <span className="text-red-500 font-medium text-sm">Blocked</span>
                                            ) : (
                                                <span className="text-green-500 font-medium text-sm">Allowed</span>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
