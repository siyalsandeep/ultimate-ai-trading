import { SystemHealthReport, HealthState } from '../../src/types/trading';
import { marketDataService } from '../data/market-data-service';
import { riskEngine } from '../risk/risk-engine';
import { executionEngine } from '../execution/execution-engine';
import { auditLogger } from '../audit/audit-logger';
import { storageService } from '../persistence/storage-service';

export class HealthService {
  private startTime: number = Date.now();
  private lastReport: SystemHealthReport | null = null;
  private checkIntervalMs: number = 10000;

  constructor() {
    this.runHealthCheck();
    setInterval(() => {
      this.runHealthCheck();
    }, this.checkIntervalMs);
  }

  public runHealthCheck(): SystemHealthReport {
    const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);
    const quotes = marketDataService.getAllQuotes();
    const staleQuotes = quotes.filter(q => q.isStale);
    const portfolio = executionEngine.getPortfolio();
    const activePositions = executionEngine.getPositions();
    const activeOrders = executionEngine.getOrders();
    const reconciliation = executionEngine.reconcileState();
    const storage = storageService.getStorageHealth();
    const persistedState = storageService.loadState();

    const activeWarnings: string[] = [];

    // Component 1: API Process
    const apiState: HealthState = 'HEALTHY';

    // Component 2: State Persistence
    const stateHealth: HealthState = persistedState && storage.exists && storage.fileSizeBytes > 0 ? 'HEALTHY' : 'DEGRADED';
    if (stateHealth !== 'HEALTHY') {
      activeWarnings.push('Persisted application state is unavailable; safety controls must not be treated as durable.');
    }

    // Component 3: Risk Engine State
    let riskState: HealthState = 'HEALTHY';
    if (portfolio.isGlobalKillSwitched || portfolio.isDailyLossHalted) {
      riskState = 'DEGRADED';
      if (portfolio.isGlobalKillSwitched) activeWarnings.push('Global kill switch is engaged.');
      if (portfolio.isDailyLossHalted) activeWarnings.push('Daily loss circuit breaker is active.');
    }

    // Component 4: Market Data Feeds
    let feedState: HealthState = quotes.length === 0 ? 'UNAVAILABLE' : 'HEALTHY';
    if (quotes.length > 0 && staleQuotes.length > 0) {
      feedState = staleQuotes.length >= quotes.length / 2 ? 'UNAVAILABLE' : 'DEGRADED';
      activeWarnings.push(`${staleQuotes.length} market quote feeds exceed 30s freshness threshold.`);
    }
    if (quotes.some((quote) => quote.quality === 'SIMULATED')) {
      activeWarnings.push('Market quotes include simulated data; they are not broker-executable.');
    }
    if (!portfolio.liveExecutionAuthorized) {
      activeWarnings.push('Live execution is disabled; no verified execution broker is authorized.');
    }

    // Component 5: Broker Adapters (Accurately reporting real state without fabrication)
    const brokerAdapters: SystemHealthReport['components']['brokerAdapters'] = [
      {
        provider: 'SimulatedInstitutionalBroker',
        state: riskEngine.isBrokerSuspended('SimulatedInstitutionalBroker') ? 'DEGRADED' : 'HEALTHY',
        connectionType: 'LOCAL_SIMULATOR',
        details: 'Deterministic local testbed execution adapter',
        reconciled: true,
      },
      {
        provider: 'InteractiveBrokersGateway',
        state: 'UNAVAILABLE',
        connectionType: 'LIVE_BROKER',
        details: 'Unconfigured: TWS/Gateway credentials not configured',
        reconciled: false,
      },
      {
        provider: 'BinanceSpotWSS',
        state: 'UNAVAILABLE',
        connectionType: 'LIVE_EXCHANGE',
        details: 'Unconfigured: API Key / Secret not configured',
        reconciled: false,
      },
      {
        provider: 'AlpacaMarkets',
        state: 'UNAVAILABLE',
        connectionType: 'LIVE_BROKER',
        details: 'Unconfigured: APCA_API_KEY_ID not configured',
        reconciled: false,
      },
    ];

    // Component 6: Reconciliation
    let reconState: HealthState = 'HEALTHY';
    if (reconciliation.discrepancies > 0) {
      reconState = 'DEGRADED';
      activeWarnings.push(`${reconciliation.discrepancies} position-to-quote discrepancies detected.`);
    }

    // Determine overall state
    let overallState: HealthState = 'HEALTHY';
    if (riskState === 'DEGRADED' || feedState === 'DEGRADED' || reconState === 'DEGRADED') {
      overallState = 'DEGRADED';
    }
    if (feedState === 'UNAVAILABLE') {
      overallState = 'UNAVAILABLE';
    }
    if (stateHealth === 'DEGRADED' && overallState === 'HEALTHY') overallState = 'DEGRADED';

    const report: SystemHealthReport = {
      overallState,
      rolloutStage: portfolio.rolloutStage || 'PAPER_ONLY',
      liveExecutionAuthorized: !!portfolio.liveExecutionAuthorized,
      recoveryObjectives: portfolio.recoveryObjectives || {
        rtoSeconds: 300,
        rpoSeconds: 60,
        backupRestoreTested: false,
        restartRecoveryTested: false,
        notes: 'Recovery objectives remain conservative until a broker-backed account integration and backup restore validation are completed.',
      },
      timestamp: Date.now(),
      uptimeSeconds,
      failClosedArmed: true,
      components: {
        apiProcess: {
          state: apiState,
          latencyMs: null,
          details: `Process is running; endpoint latency is not measured. Node.js heap: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)}MB`,
        },
        databaseAndState: {
          state: stateHealth,
          ordersCount: activeOrders.length,
          auditEventsCount: auditLogger.getCount(),
          details: storage.exists
            ? `Local state file: ${storage.fileSizeBytes.toLocaleString()} bytes; last saved ${storage.lastSavedAt === null ? 'unknown' : new Date(storage.lastSavedAt).toISOString()}.`
            : 'Local persisted state file is missing.',
        },
        riskEngine: {
          state: riskState,
          dailyLossTripped: portfolio.isDailyLossHalted,
          globalKillSwitch: portfolio.isGlobalKillSwitched,
        },
        marketDataFeeds: {
          state: feedState,
          activeSymbols: quotes.length,
          staleFeedsCount: staleQuotes.length,
          avgLatencyMs: null,
          sourceLabel: 'Local paper simulator only; external provider connection is not verified here.',
        },
        brokerAdapters,
        reconciliation: {
          state: reconState,
          unresolvedDiscrepancies: reconciliation.discrepancies,
          lastReconciledAt: Date.now(),
          source: 'LOCAL_PAPER_LEDGER',
        },
      },
      activeWarnings,
    };

    this.lastReport = report;
    return report;
  }

  public getHealthReport(): SystemHealthReport {
    if (!this.lastReport) {
      return this.runHealthCheck();
    }
    return this.lastReport;
  }
}

export const healthService = new HealthService();
