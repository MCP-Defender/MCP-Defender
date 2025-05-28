import React, { useState, useEffect, createContext, useContext } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardContent,
  CardTitle,
  CardFooter,
  CardDescription,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import AppTab from "./tabs/AppTab";
import ThreatsTab from "./tabs/ThreatsTab";
import SignaturesTab from "./tabs/SignaturesTab";
import TitleBar, { TitleBarStyle } from "./TitleBar";
import { OnboardingRoot } from "./onboarding/OnboardingRoot";
import ScanDetailView from "./ScanDetailView";
import SecurityAlertView from "./SecurityAlertView";
import { Loader2 } from "lucide-react";
import SettingsView from "./settings/SettingsView";
import mcpDefenderLogo from "../assets/mcp-defender-logo.png";

// Import types from existing code
import { DefenderState, DefenderStatus } from "../services/defender/types";

// Create a context for tab navigation
interface TabContextType {
  switchTab: (tabName: string) => void;
  activeTab: string;
  openSettings: () => void;
}

export const TabContext = createContext<TabContextType>({
  switchTab: () => { },
  activeTab: 'apps',
  openSettings: () => { },
});

// Custom hook to allow components to switch tabs
export function useTabNavigation() {
  const context = useContext(TabContext);
  if (!context) {
    throw new Error('useTabNavigation must be used within TabContext.Provider');
  }
  return context;
}

export default function App() {
  const [defenderState, setDefenderState] = useState<DefenderState>({
    status: DefenderStatus.starting,
    error: null,
  });
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDarkMode, setIsDarkMode] = useState(false);
  // Add state for the active tab
  const [activeTab, setActiveTab] = useState<string>("apps");
  // Add state for the current route
  const [currentRoute, setCurrentRoute] = useState<string>("");

  // Function to switch tabs (can be called from child components)
  const switchTab = (tabName: string) => {
    console.log(`Switching to tab: ${tabName}`);
    setActiveTab(tabName);

    // Optionally also notify the main process about the tab change
    // This keeps everything in sync if we add more ways to navigate
    window.trayAPI.switchTab(tabName).catch(err => {
      console.error("Failed to notify main process of tab switch:", err);
    });
  };

  // Function to open settings in a separate window
  const openSettings = () => {
    window.settingsAPI.openSettingsWindow();
  };

  useEffect(() => {
    console.log("Document loaded, initializing app");

    const fetchInitialState = async () => {
      try {
        // Add a small delay to ensure services have started
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Get initial state
        const state = await window.defenderAPI.getState();
        setDefenderState(state);
      } catch (err) {
        console.error("Failed to get initial defender state:", err);
        setError("Failed to get defender state. Please restart the application.");
      } finally {
        setIsLoading(false);
      }
    };

    fetchInitialState();

    // Listen for defender state updates
    const unsubscribe = window.defenderAPI.onStateUpdate((state) => {
      setDefenderState(state);
      // Once we get a state update, we know the service is ready
      setIsLoading(false);
    });

    // Subscribe to tab switching events from main process
    const tabUnsubscribe = window.trayAPI.onSwitchTab((tabName) => {
      console.log("Switching to tab:", tabName);
      setActiveTab(tabName);
    });

    // Subscribe to settings open request from main process
    const settingsUnsubscribe = window.trayAPI.onOpenSettings(() => {
      console.log("Opening settings window");
      window.settingsAPI.openSettingsWindow();
    });

    // Check if we're on the onboarding route
    const hash = window.location.hash;
    // Remove the leading '#' and any number of leading slashes
    setCurrentRoute(hash.replace(/^#\/*/, ''));

    // Listen for hash changes
    const handleHashChange = () => {
      const hash = window.location.hash;
      // Remove the leading '#' and any number of leading slashes
      setCurrentRoute(hash.replace(/^#\/*/, ''));
    };

    window.addEventListener('hashchange', handleHashChange);

    // Check for system dark mode preference
    if (
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
    ) {
      document.documentElement.classList.add("dark");
      setIsDarkMode(true);
    }

    // Listen for changes in system dark mode preference
    const darkModeMediaQuery = window.matchMedia(
      "(prefers-color-scheme: dark)"
    );
    const handleDarkModeChange = (e: MediaQueryListEvent) => {
      if (e.matches) {
        document.documentElement.classList.add("dark");
        setIsDarkMode(true);
      } else {
        document.documentElement.classList.remove("dark");
        setIsDarkMode(false);
      }
    };

    darkModeMediaQuery.addEventListener("change", handleDarkModeChange);

    // Cleanup function
    return () => {
      unsubscribe();
      tabUnsubscribe();
      settingsUnsubscribe();
      window.removeEventListener('hashchange', handleHashChange);
      darkModeMediaQuery.removeEventListener("change", handleDarkModeChange);
    };
  }, []);

  // If we're on the onboarding route, render the onboarding UI
  if (currentRoute === 'onboarding') {
    return <OnboardingRoot />;
  }

  // If we're on the scan-detail route, render the scan detail view
  if (currentRoute.startsWith('scan-detail/')) {
    return (
      <>
        <TitleBar
          titleBarStyle={TitleBarStyle.ScanResult}
        />
        <div className="container mx-auto p-4 max-w-4xl mt-[52px]">
          <ScanDetailView />
        </div>
      </>
    )
  }

  // If we're on the security-alert route, render the security alert view
  if (currentRoute.startsWith('security-alert/')) {
    return <SecurityAlertView />;
  }

  // If we're on the settings route, render the settings view as a standalone page
  if (currentRoute === 'settings') {
    return (
      <>
        <TitleBar
          titleBarStyle={TitleBarStyle.Settings}
        />
        <div className="container mx-auto p-4 max-w-4xl mt-[52px]">
          <SettingsView standalone={true} />
        </div>
      </>
    );
  }

  // Show a loading state while waiting for defender state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-6">
          {/* Logo with background effect */}
          <div className="flex justify-center">
            <div className="relative">
              <div className="absolute inset-0 bg-primary/10 rounded-full blur-lg"></div>
              <img
                src={mcpDefenderLogo}
                alt="MCP Defender Logo"
                className="h-20 w-20 object-contain relative z-10"
              />
            </div>
          </div>

          {/* Loading spinner and text */}
          <div className="space-y-3">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
            <h2 className="text-xl font-medium">Initializing MCP Defender...</h2>
          </div>
        </div>
      </div>
    );
  }

  // Show error state if there was a problem
  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <Alert variant="destructive" className="max-w-md">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <TabContext.Provider value={{ switchTab, activeTab, openSettings }}>
      {/* Title Bar with tabs and settings toggle */}
      <TitleBar
        titleBarStyle={TitleBarStyle.Main}
        defenderState={defenderState}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onSettingsToggle={openSettings}
      />

      <div className="container mx-auto p-4 max-w-4xl mt-[52px]">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsContent value="threats" className="space-y-4">
            <ThreatsTab />
          </TabsContent>

          <TabsContent value="apps" className="space-y-4">
            <AppTab />
          </TabsContent>

          <TabsContent value="signatures" className="space-y-4">
            <SignaturesTab />
          </TabsContent>
        </Tabs>
      </div>
    </TabContext.Provider>
  );
}