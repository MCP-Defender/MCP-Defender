import { Mail, Settings, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { toast } from "sonner";

interface EmailScreenProps {
    onEmailSubmit: (email: string) => void;
    onSkipEmail: () => void;
    error?: string;
    email?: string;
    onBack?: () => void;
}

export function EmailScreen({
    onEmailSubmit,
    onSkipEmail,
    error: serverError,
    email: initialEmail = "",
    onBack
}: EmailScreenProps) {
    const [email, setEmail] = useState(initialEmail);
    const [error, setError] = useState(serverError || "");
    const [isLoading, setIsLoading] = useState(false);

    // Simple validation for the email format
    const validateEmail = () => {
        if (!email) {
            setError("Email is required");
            toast.error("Email is required");
            return false;
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            setError("Please enter a valid email address");
            toast.error("Please enter a valid email address");
            return false;
        }

        setError("");
        return true;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (validateEmail()) {
            setIsLoading(true);
            try {
                // Use the account API for login instead of the onboarding handler
                const result = await window.accountAPI.login(email);

                if (result.success) {
                    onEmailSubmit(email);
                } else {
                    const errorMessage = result.error || "Failed to send login email. Please try again.";
                    setError(errorMessage);
                    toast.error(errorMessage);
                }
            } catch (error) {
                console.error("Error sending login email:", error);
                const errorMessage = "An unexpected error occurred. Please try again.";
                setError(errorMessage);
                toast.error(errorMessage);
            } finally {
                setIsLoading(false);
            }
        }
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen max-w-3xl mx-auto p-6 space-y-8">
            {/* Header Section */}
            <div className="text-center space-y-2">
                <h1 className="text-3xl font-bold tracking-tight">Login</h1>
                <p className="text-muted-foreground">Enter your email to get started</p>
            </div>

            {/* Form Section */}
            <form onSubmit={handleSubmit} className="space-y-5 w-full max-w-sm">
                <div className="space-y-2">
                    <Label htmlFor="email" className="text-base">Email Address</Label>
                    <Input
                        id="email"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className={`h-12 px-4 text-base ${error || serverError ? "border-red-500" : ""}`}
                        disabled={isLoading}
                    />
                    {(error || serverError) && (
                        <p className="text-red-500 text-sm mt-1">{error || serverError}</p>
                    )}
                </div>

                <Button type="submit" size="lg" className="w-full" disabled={isLoading}>
                    <Mail className="mr-2 h-5 w-5" />
                    {isLoading ? "Sending..." : "Send Login Link"}
                </Button>
            </form>

            {/* Skip Option */}
            <div className="border-t border-border pt-6 space-y-4">
                <p className="text-center text-sm text-muted-foreground">
                    Advanced: Use your own LLM API keys
                </p>
                <div className="flex justify-center">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground flex items-center"
                        onClick={() => {
                            toast.info("Skipping email verification");
                            onSkipEmail();
                        }}
                        disabled={isLoading}
                    >
                        <Settings className="mr-2 h-4 w-4" />
                        Configure API Keys
                    </Button>
                </div>
            </div>
        </div>
    );
} 