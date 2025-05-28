import { useState, useEffect, useCallback } from "react"
import { Signature } from "@/services/signatures/types"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Search } from "lucide-react"
import { toast } from "sonner"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"

interface SignaturesTableProps {
    /** Optional function to call when disabled signatures is saved */
    onDisabledSaved?: (disabledIds: string[]) => void;
}

/**
 * A table for displaying and selecting signatures
 */
export function SignaturesTable({ onDisabledSaved }: SignaturesTableProps) {
    const [signatures, setSignatures] = useState<Signature[]>([])
    const [disabledSignatures, setDisabledSignatures] = useState<Record<string, boolean>>({})
    const [initialDisabledSignatures, setInitialDisabledSignatures] = useState<Record<string, boolean> | null>(null)
    const [searchQuery, setSearchQuery] = useState("")
    const [isLoading, setIsLoading] = useState(true)
    const [saveTimer, setSaveTimer] = useState<NodeJS.Timeout | null>(null)

    // Filter signatures based on search query
    const filteredSignatures = signatures.filter(sig => {
        if (!searchQuery) return true;
        return (
            sig.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            sig.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
            sig.description.toLowerCase().includes(searchQuery.toLowerCase())
        );
    });

    // Save disabled signatures with debounce
    const saveDisabledSignatures = useCallback(() => {
        // Clear any existing timer
        if (saveTimer) {
            clearTimeout(saveTimer);
        }

        // Set a new timer to save after a delay
        const timer = setTimeout(async () => {
            try {
                // Get disabled signature IDs
                const disabledIds = Object.entries(disabledSignatures)
                    .filter(([_, isDisabled]) => isDisabled)
                    .map(([id]) => id);

                console.log("Saving disabled signatures:", disabledIds);

                // Save selection via settings API
                await window.settingsAPI.saveDisabledSignatures(disabledIds);

                // Call the callback if provided
                if (onDisabledSaved) {
                    onDisabledSaved(disabledIds);
                }

                // Show subtle success feedback
                toast.success("Signatures updated", {
                    duration: 1500
                });
            } catch (error) {
                console.error('Failed to save disabled signatures:', error);
                toast.error("Failed to update signatures");
            }
        }, 800); // 800ms debounce delay

        setSaveTimer(timer);
    }, [disabledSignatures, onDisabledSaved, saveTimer]);

    // Fetch signatures and settings when component mounts
    useEffect(() => {
        const fetchSignaturesAndSettings = async () => {
            try {
                // Get signatures and settings in parallel
                const [sigs, settings] = await Promise.all([
                    window.signaturesAPI.getSignatures(),
                    window.settingsAPI.getAll()
                ]);

                setSignatures(sigs);

                // Get the disabled signatures from settings
                // disabledSignatures comes from main process as array, ensure it's treated as an array
                const disabledSignatureIds: string[] = Array.isArray(settings.disabledSignatures)
                    ? settings.disabledSignatures
                    : [];

                console.log("Disabled signatures:", disabledSignatureIds);

                // Initialize the disabled signatures state - by default signatures are enabled (NOT disabled)
                const initialDisabled: Record<string, boolean> = {};
                sigs.forEach(sig => {
                    // A signature is disabled if it's in the disabledSignatureIds array
                    initialDisabled[sig.id] = disabledSignatureIds.includes(sig.id);
                });

                setDisabledSignatures(initialDisabled);
                setInitialDisabledSignatures({ ...initialDisabled }); // Save initial state for comparison
                setIsLoading(false);
            } catch (error) {
                console.error('Failed to load signatures or settings:', error);
                toast.error("Failed to load signatures");
                setIsLoading(false);
            }
        };

        fetchSignaturesAndSettings();
    }, []);

    // Save when signature selection changes, but only if it differs from initial state
    useEffect(() => {
        // Skip if we're still loading or don't have initial state to compare against
        if (isLoading || !initialDisabledSignatures || Object.keys(disabledSignatures).length === 0) {
            return;
        }

        // Check if current state differs from initial state
        const hasChanged = Object.keys(disabledSignatures).some(id =>
            disabledSignatures[id] !== initialDisabledSignatures[id]
        );

        // Only save if user made actual changes
        if (hasChanged) {
            saveDisabledSignatures();
            // Update our reference after saving
            setInitialDisabledSignatures({ ...disabledSignatures });
        }
    }, [disabledSignatures, initialDisabledSignatures, isLoading, saveDisabledSignatures]);

    // Clean up timer on component unmount
    useEffect(() => {
        return () => {
            if (saveTimer) clearTimeout(saveTimer);
        };
    }, [saveTimer]);

    // Toggle a single signature's disabled state
    const toggleSignature = (id: string) => {
        setDisabledSignatures(prev => ({
            ...prev,
            [id]: !prev[id]
        }));
    };

    // Toggle all signatures
    const toggleAllSignatures = () => {
        // Check if all visible signatures are not disabled (i.e., enabled)
        // If even one is disabled, we'll enable all (by setting them all to not disabled)
        const allEnabled = filteredSignatures.every(sig => !disabledSignatures[sig.id]);

        // If all are already enabled, disable all. Otherwise, enable all.
        const newDisabledState = allEnabled;

        const newDisabled = { ...disabledSignatures };
        filteredSignatures.forEach(sig => {
            newDisabled[sig.id] = newDisabledState;
        });

        setDisabledSignatures(newDisabled);
    };

    // If loading, show loading state
    if (isLoading) {
        return <div className="py-8 text-center">Loading signatures...</div>
    }

    // Check if all visible signatures are enabled (not disabled)
    const allEnabled = filteredSignatures.length > 0 &&
        filteredSignatures.every(sig => !disabledSignatures[sig.id]);

    // Count disabled signatures
    const disabledCount = Object.values(disabledSignatures).filter(Boolean).length;
    const enabledCount = signatures.length - disabledCount;

    return (
        <div className="w-full">
            <div className="flex items-center py-4">
                <div className="flex items-center">
                    <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                    <Input
                        placeholder="Search signatures..."
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        className="max-w-sm"
                    />
                </div>
            </div>
            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[50px]">
                                <div className="flex items-center justify-center">
                                    <Checkbox
                                        checked={allEnabled}
                                        onCheckedChange={toggleAllSignatures}
                                        aria-label="Toggle all signatures"
                                    />
                                </div>
                            </TableHead>
                            <TableHead>Name</TableHead>
                            <TableHead>Category</TableHead>
                            <TableHead>Description</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredSignatures.length > 0 ? (
                            filteredSignatures.map((signature) => (
                                <TableRow key={signature.id}>
                                    <TableCell>
                                        <div className="flex items-center justify-center">
                                            <Checkbox
                                                // CHECKED means enabled (NOT disabled)
                                                checked={!disabledSignatures[signature.id]}
                                                onCheckedChange={() => toggleSignature(signature.id)}
                                                aria-label={`Toggle ${signature.name}`}
                                            />
                                        </div>
                                    </TableCell>
                                    <TableCell className="font-medium">{signature.name}</TableCell>
                                    <TableCell>{signature.category}</TableCell>
                                    <TableCell className="max-w-md truncate" title={signature.description}>
                                        {signature.description}
                                    </TableCell>
                                </TableRow>
                            ))
                        ) : (
                            <TableRow>
                                <TableCell colSpan={4} className="h-24 text-center">
                                    {searchQuery ? "No matching signatures found." : "No signatures available."}
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>
            <div className="flex items-center justify-end py-4">
                <div className="text-sm text-muted-foreground">
                    {enabledCount} of {signatures.length} signature(s) enabled.
                </div>
            </div>
        </div>
    )
} 