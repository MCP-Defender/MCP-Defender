import { DefenderService } from './defender/service';
import { SignaturesService } from './signatures/service';
import { SettingsService } from './settings/service';
import { ConfigurationsService } from './configurations/service';
import { ScanService } from './scans/service';
import { registerDefenderHandlers } from './defender/handlers';
import { registerSignatureHandlers } from './signatures/handlers';
import { registerSettingsHandlers } from './settings/handlers';
import { registerConfigurationsHandlers } from './configurations/handlers';
import { registerScanHandlers } from './scans/handlers';
import { createLogger } from '../utils/logger';

/**
 * ServiceManager
 * 
 * Provides centralized access to all application services.
 * Manages service lifecycle (initialization, startup, shutdown).
 */
export class ServiceManager {
    private static instance: ServiceManager | null = null;
    private logger = createLogger('ServiceManager');

    // Service instances
    private _defenderService: DefenderService | null = null;
    private _scanService: ScanService | null = null;
    private _signaturesService: SignaturesService | null = null;
    private _settingsService: SettingsService | null = null;
    private _configurationsService: ConfigurationsService | null = null;

    // Track initialization state
    private initialized = false;

    /**
     * Get the singleton ServiceManager instance
     */
    public static getInstance(): ServiceManager {
        if (!ServiceManager.instance) {
            ServiceManager.instance = new ServiceManager();
            ServiceManager.instance.initialize();

            // Set a global reference to avoid bundling issues with require()
            (global as any).__SERVICE_MANAGER_INSTANCE__ = ServiceManager.instance;
        }
        return ServiceManager.instance;
    }

    /**
     * Check if onboarding has been completed
     * Convenience method for main.ts
     */
    public static isOnboardingCompleted(): boolean {
        return ServiceManager.getInstance().settingsService.isOnboardingCompleted();
    }

    /**
     * Private constructor to enforce singleton pattern
     */
    private constructor() {
        this.logger.info('Creating ServiceManager instance');
    }

    /**
     * Initialize all services and register IPC handlers
     */
    public initialize(): void {
        if (this.initialized) {
            this.logger.warn('Services already initialized');
            return;
        }

        this.logger.info('Initializing services...');

        // Create service instances
        this._defenderService = new DefenderService();
        this._settingsService = new SettingsService();
        this._signaturesService = new SignaturesService();
        this._configurationsService = new ConfigurationsService();
        this._scanService = new ScanService();

        // Register IPC handlers
        registerDefenderHandlers(this._defenderService);
        registerSignatureHandlers(this._signaturesService);
        registerSettingsHandlers(this._settingsService);
        registerConfigurationsHandlers(this._configurationsService);
        registerScanHandlers(this._scanService);

        this.initialized = true;
        this.logger.info('Services initialization complete');
    }

    /**
     * Start only the settings service
     * Used during onboarding when other services are not needed
     */
    public startSettingsService(): void {
        this.logger.info('Starting settings service only (for onboarding)...');
        this._settingsService!.start();
        this.logger.info('Settings service started');
    }

    /**
     * Start the remaining services needed after onboarding is completed
     * This starts everything except the settings service which should already be running
     */
    public startRemainingServices(): void {
        this.logger.info('Starting remaining services after onboarding completion...');

        // Start all other services in the correct order
        // Skip settings service as it should already be running
        this._scanService!.start();
        this._signaturesService!.start();
        this._configurationsService!.start();
        this._defenderService!.start();

        this.logger.info('All remaining services started');
    }

    /**
     * Stop all services in the correct order (reverse of startup)
     */
    public async stopServices(): Promise<void> {
        this.logger.info('Stopping services...');

        // Stop in reverse order of dependencies
        this._defenderService!.stop();

        // Wait for configurations to fully stop and restore configs
        try {
            await this._configurationsService!.stop();
        } catch (error) {
            this.logger.error('Error stopping configurations service:', error);
        }

        this._signaturesService!.stop();
        this._settingsService!.stop();
        this._scanService!.stop();

        this.logger.info('All services stopped');
    }

    // Service getters

    get defenderService(): DefenderService {
        if (!this._defenderService) {
            throw new Error('Defender service not initialized');
        }
        return this._defenderService;
    }

    get scanService(): ScanService {
        if (!this._scanService) {
            throw new Error('Scan service not initialized');
        }
        return this._scanService;
    }

    get signaturesService(): SignaturesService {
        if (!this._signaturesService) {
            throw new Error('Signatures service not initialized');
        }
        return this._signaturesService;
    }

    get settingsService(): SettingsService {
        if (!this._settingsService) {
            throw new Error('Settings service not initialized');
        }
        return this._settingsService;
    }

    get configurationsService(): ConfigurationsService {
        if (!this._configurationsService) {
            throw new Error('Configurations service not initialized');
        }
        return this._configurationsService;
    }
} 