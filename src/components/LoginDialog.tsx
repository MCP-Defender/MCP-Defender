import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface LoginDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onEmailSubmit: (email: string) => void;
}

export function LoginDialog({ open, onOpenChange, onEmailSubmit }: LoginDialogProps) {
    const [email, setEmail] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [emailError, setEmailError] = useState("");

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        // Reset error state
        setEmailError("");

        // Basic email validation
        if (!email || !email.includes('@') || !email.includes('.')) {
            setEmailError("Please enter a valid email address");
            return;
        }

        setIsLoading(true);

        try {
            // Call the parent component's submit handler
            await onEmailSubmit(email);
        } catch (error) {
            console.error("Login error:", error);
            setEmailError("An unexpected error occurred. Please try again.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>Log in to MCP Defender</DialogTitle>
                        <DialogDescription>
                            Enter your email address to receive a login link
                        </DialogDescription>
                    </DialogHeader>

                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="email" className="text-right">
                                Email
                            </Label>
                            <Input
                                id="email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="your.email@example.com"
                                className="col-span-3"
                                autoFocus
                                disabled={isLoading}
                            />
                            {emailError && (
                                <div className="col-span-4 text-right text-sm text-red-500">
                                    {emailError}
                                </div>
                            )}
                        </div>
                    </div>

                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                            disabled={isLoading}
                        >
                            Cancel
                        </Button>
                        <Button type="submit" disabled={isLoading}>
                            {isLoading ? "Sending..." : "Send Login Link"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
} 