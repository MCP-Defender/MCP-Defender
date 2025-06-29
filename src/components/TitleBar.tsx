import React, { ReactNode, useEffect } from 'react';
import { DefenderState, DefenderStatus } from '../services/defender/types';
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Cog } from 'lucide-react';

export enum TitleBarStyle {
  Main,
  Settings,
  ScanResult
}

interface TitleBarProps {
  titleBarStyle: TitleBarStyle
  defenderState?: DefenderState;
  activeTab?: string;
  onTabChange?: (value: string) => void;
  onSettingsToggle?: () => void;
  children?: ReactNode;
}

// Create custom CSS classes for WebkitAppRegion properties
// This is necessary because TypeScript doesn't recognize WebkitAppRegion as a valid style property
const TitleBar: React.FC<TitleBarProps> = ({
  titleBarStyle,
  defenderState,
  activeTab,
  onTabChange,
  onSettingsToggle,
  children
}) => {
  // Function to get status indicator color
  const getStatusIndicatorColor = () => {
    switch (defenderState.status) {
      case DefenderStatus.running:
        return "bg-green-500";
      case DefenderStatus.starting:
        return "bg-yellow-500";
      case DefenderStatus.error:
      case DefenderStatus.stopped:
        return "bg-red-500";
      default:
        return "bg-gray-500";
    }
  };

  // Function to get status display text
  const getDefenderStatusText = () => {
    switch (defenderState.status) {
      case DefenderStatus.running:
        return "Enabled";
      case DefenderStatus.starting:
        return "Starting...";
      case DefenderStatus.error:
        return "Error";
      case DefenderStatus.stopped:
        return "Disabled";
      default:
        return "Unknown";
    }
  };

  // Function to get status display text
  const getTitle = () => {
    switch (titleBarStyle) {
      case TitleBarStyle.Main:
        return "MCP Defender";
      case TitleBarStyle.Settings:
        return "Settings";
      case TitleBarStyle.ScanResult:
        return "Scan Result";
      default:
        return "";
    }
  };

  const getSubTitle = () => {
    switch (titleBarStyle) {
      case TitleBarStyle.Main:
        return "";
      default:
        return "MCP Defender";
    }
  };

  // Add the CSS rules for WebkitAppRegion to the document when the component mounts
  useEffect(() => {
    // Create a style element
    const styleEl = document.createElement('style');

    // Define the CSS rules
    const css = `
      .webkit-app-region-drag {
        -webkit-app-region: drag;
      }
      .webkit-app-region-no-drag {
        -webkit-app-region: no-drag;
      }
    `;

    styleEl.appendChild(document.createTextNode(css));
    document.head.appendChild(styleEl);

    // Clean up when the component unmounts
    return () => {
      document.head.removeChild(styleEl);
    };
  }, []);

  return (
    <div className="fixed top-0 left-0 right-0 h-[52px] bg-background border-b z-50">
      {/* Invisible area for dragging (above the content) */}
      <div className="webkit-app-region-drag fixed top-0 left-0 right-0 h-[52px] bg-transparent" />

      {/* Main titlebar content */}
      <div className="flex items-center h-full px-[70px] relative">
        {/* App title and status */}
        <div className="flex items-center gap-3 min-w-[180px] flex-shrink-0">
          <div className="flex flex-col pl-3">
            <div className="text-sm leading-tight font-semibold">
              {getTitle()}
            </div>
            {defenderState ? (
              <div className="flex items-center gap-2">
                <div className={`h-2 w-2 rounded-full ${getStatusIndicatorColor()}`}></div>
                <span className="text-xs text-muted-foreground">{getDefenderStatusText()}</span>
              </div>
            ) : <span className="text-xs text-muted-foreground">{getSubTitle()}</span>
            }
          </div>
        </div>

        {/* Tabs area - only shown when not in settings mode */}
        {titleBarStyle == TitleBarStyle.Main && (
          <div className="flex-grow flex items-center justify-center">
            <div className="absolute left-1/2 transform -translate-x-1/2 webkit-app-region-no-drag">
              <Tabs value={activeTab} onValueChange={onTabChange} className="">
                <TabsList className="grid w-[360px] grid-cols-3">
                  <TabsTrigger value="threats">Threats</TabsTrigger>
                  <TabsTrigger value="apps">Apps</TabsTrigger>
                  <TabsTrigger value="signatures">Signatures</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>
        )}

        {children}
      </div>

      {titleBarStyle == TitleBarStyle.Main && (
        <div className="absolute top-0 right-0 h-[52px] webkit-app-region-no-drag flex items-center">
          <Button
            variant={"ghost"}
            size="icon"
            onClick={onSettingsToggle}
            className="[&_svg]:size-99"
            aria-label="Settings"
          >
            <Cog className="size-5.5 text-muted-foreground" />
          </Button>
        </div>
      )}
    </div>
  );
};

export default TitleBar; 