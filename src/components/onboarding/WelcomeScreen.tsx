import { Shield, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import mcpDefenderLogo from "../../assets/mcp-defender-logo.png";
import logoWithoutIcon from "../../assets/logo_without_icon.png";

interface WelcomeScreenProps {
    onContinue: () => void;
}

export function WelcomeScreen({ onContinue }: WelcomeScreenProps) {
    return (
        <div className="flex flex-col items-center justify-center min-h-screen max-w-md mx-auto p-6">
            {/* Main Icon */}
            <div className="flex justify-center">
                <div className="relative">
                    <div className="absolute inset-0 bg-primary/10 rounded-full blur-lg"></div>
                    <div className="">
                        <img
                            src={mcpDefenderLogo}
                            alt="MCP Defender Logo"
                            className="h-52 w-52 object-contain"
                        />
                    </div>
                </div>
            </div>

            {/* Logo Text */}
            <div className="text-center">
                <img
                    src={logoWithoutIcon}
                    alt="MCP Defender"
                    className="h-24 object-contain mx-auto"
                />
            </div>

            {/* Continue Button */}
            <Button size="lg" className="mt-12 h-14 px-8 text-lg" onClick={onContinue}>
                Get Started
                <ArrowRight className="ml-2 h-6 w-6" />
            </Button>
        </div>
    );
} 