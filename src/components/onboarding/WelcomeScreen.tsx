import { Shield, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import mcpDefenderLogo from "../../assets/mcp-defender-logo.png";

interface WelcomeScreenProps {
    onContinue: () => void;
}

export function WelcomeScreen({ onContinue }: WelcomeScreenProps) {
    return (
        <div className="flex flex-col max-w-md mx-auto p-6 space-y-8">
            {/* Header Section */}
            <div className="text-center space-y-2">
                <h1 className="text-3xl font-bold tracking-tight">MCP Defender</h1>
                <p className="text-muted-foreground text-lg">Your security layer for AI workflows</p>
            </div>

            {/* Main Logo */}
            <div className="flex justify-center py-8">
                <div className="relative">
                    <div className="absolute inset-0 bg-primary/10 rounded-full blur-lg"></div>
                    <div className="">
                        <img
                            src={mcpDefenderLogo}
                            alt="MCP Defender Logo"
                            className="h-32 w-32 object-contain"
                        />
                    </div>
                </div>
            </div>

            {/* Features List */}
            <div className="space-y-4">
                <h2 className="text-xl font-semibold">MCP Defender helps you:</h2>
                <ul className="space-y-2">
                    <li className="flex items-start">
                        <div className="bg-primary/10 p-1 rounded-full mr-3 mt-0.5">
                            <div className="w-1.5 h-1.5 bg-primary rounded-full"></div>
                        </div>
                        <span>Protect your system from harmful AI tool calls</span>
                    </li>
                    <li className="flex items-start">
                        <div className="bg-primary/10 p-1 rounded-full mr-3 mt-0.5">
                            <div className="w-1.5 h-1.5 bg-primary rounded-full"></div>
                        </div>
                        <span>Monitor AI communications with detailed logs</span>
                    </li>
                    <li className="flex items-start">
                        <div className="bg-primary/10 p-1 rounded-full mr-3 mt-0.5">
                            <div className="w-1.5 h-1.5 bg-primary rounded-full"></div>
                        </div>
                        <span>Customize security policies to match your needs</span>
                    </li>
                </ul>
            </div>

            {/* Continue Button */}
            <Button size="lg" className="mt-6" onClick={onContinue}>
                Get Started
                <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
        </div>
    );
} 