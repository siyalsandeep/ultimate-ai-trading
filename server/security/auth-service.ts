import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { auditLogger } from '../audit/audit-logger';
import { marketDataService } from '../data/market-data-service';

export class AuthService {
  private readonly operatorToken: string;
  // Request timestamps by client IP for sliding window rate limiting
  private requestCounts: Map<string, number[]> = new Map();
  private readonly rateLimitWindowMs = 60000; // 1 minute
  private readonly maxRequestsPerWindow = 60; // 60 mutations / min

  constructor(operatorToken: string = process.env.OPERATOR_TOKEN || '') {
    this.operatorToken = operatorToken.length >= 32 ? operatorToken : '';
  }

  /**
   * Express middleware: Enforce valid operator authorization
   */
  public requireOperatorAuth = (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : '';
    res.setHeader('Cache-Control', 'no-store');

    const supplied = Buffer.from(token);
    const expected = Buffer.from(this.operatorToken);
    const tokenMatches = expected.length > 0 &&
      supplied.length === expected.length &&
      crypto.timingSafeEqual(supplied, expected);

    if (!tokenMatches) {
      auditLogger.record({
        category: 'RISK_DECISION',
        level: 'WARNING',
        action: 'UNAUTHORIZED_ACCESS_BLOCKED',
        details: {
          path: req.path,
          method: req.method,
          ip: req.ip || req.socket.remoteAddress,
        },
        actor: 'OPERATOR',
      });

      res.status(this.operatorToken ? 401 : 503).json({
        success: false,
        error: this.operatorToken
          ? 'Unauthorized: Valid operator credentials required for sensitive actions.'
          : 'Operator authentication is not configured; protected actions are disabled.',
      });
      return;
    }

    next();
  };

  public operatorSessionHandler = (getMode: () => string) => (_req: Request, res: Response): void => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      authenticated: true,
      role: 'OPERATOR',
      mode: getMode(),
      liveExecutionPermitted: false,
      environment: 'SIMULATED_PAPER_ISOLATED',
      status: 'AUTHORIZED',
    });
  };

  /**
   * Express middleware: Sliding window rate limiting
   */
  public rateLimiter = (req: Request, res: Response, next: NextFunction): void => {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown-client';
    const now = Date.now();
    const timestamps = this.requestCounts.get(clientIp) || [];

    // Filter out timestamps outside the active window
    const recent = timestamps.filter(t => now - t < this.rateLimitWindowMs);

    if (recent.length >= this.maxRequestsPerWindow) {
      auditLogger.record({
        category: 'RISK_DECISION',
        level: 'WARNING',
        action: 'RATE_LIMIT_EXCEEDED',
        details: { clientIp, count: recent.length },
        actor: 'OPERATOR',
      });

      res.status(429).json({
        success: false,
        error: 'Too Many Requests: Rate limit exceeded. Try again in 60 seconds.',
      });
      return;
    }

    recent.push(now);
    this.requestCounts.set(clientIp, recent);
    next();
  };

  /**
   * Express middleware: Strict order validation & live-execution defense
   */
  public validateOrderInput = (req: Request, res: Response, next: NextFunction): void => {
    const body = req.body;
    if (!body || typeof body !== 'object') {
      res.status(400).json({ success: false, error: 'Malformed request body.' });
      return;
    }

    // 1. Mandatory Symbol Check against supported instruments
    const symbol = body.symbol;
    if (!symbol || typeof symbol !== 'string') {
      res.status(400).json({ success: false, error: 'Validation Error: symbol is required.' });
      return;
    }
    const instrument = marketDataService.getInstrument(symbol);
    if (!instrument) {
      res.status(400).json({ success: false, error: `Validation Error: Unsupported instrument "${symbol}".` });
      return;
    }

    // 2. Side Validation
    if (body.side !== 'BUY' && body.side !== 'SELL') {
      res.status(400).json({ success: false, error: 'Validation Error: side must be BUY or SELL.' });
      return;
    }

    // 3. Type Validation
    const validTypes = ['MARKET', 'LIMIT', 'STOP_LOSS', 'TAKE_PROFIT'];
    if (!validTypes.includes(body.type)) {
      res.status(400).json({ success: false, error: `Validation Error: type must be one of ${validTypes.join(', ')}.` });
      return;
    }

    // 4. Quantity Validation
    const quantity = parseFloat(body.quantity);
    if (isNaN(quantity) || quantity <= 0) {
      res.status(400).json({ success: false, error: 'Validation Error: quantity must be a positive number.' });
      return;
    }
    if (quantity < instrument.minLotSize) {
      res.status(400).json({
        success: false,
        error: `Validation Error: quantity ${quantity} is below minimum lot size of ${instrument.minLotSize}.`,
      });
      return;
    }

    // 5. Mandatory Stop Loss Check (Risk Governance Invariant)
    const stopLoss = parseFloat(body.stopLoss);
    if (isNaN(stopLoss) || stopLoss <= 0) {
      res.status(400).json({
        success: false,
        error: 'Validation Error: Mandatory protective stopLoss is required and must be a positive price.',
      });
      return;
    }

    // 6. Limit Price Validation
    if (body.type === 'LIMIT') {
      const price = parseFloat(body.price);
      if (isNaN(price) || price <= 0) {
        res.status(400).json({
          success: false,
          error: 'Validation Error: Limit orders require a valid positive price.',
        });
        return;
      }
    }

    // 7. Strict Live Mode Guard: Prevent routing to live brokers if unverified
    if (body.mode === 'LIVE' || (body.broker && body.broker !== 'SimulatedInstitutionalBroker')) {
      res.status(403).json({
        success: false,
        code: 'ERR_LIVE_TRADING_DISABLED',
        error: 'Live order routing is strictly disabled: No verified live broker connection is configured.',
      });
      return;
    }

    next();
  };

  /**
   * Express middleware: Validate Risk Limits inputs against hard institutional protective ceilings
   */
  public validateRiskLimitsInput = (req: Request, res: Response, next: NextFunction): void => {
    const limits = req.body;
    if (!limits || typeof limits !== 'object') {
      res.status(400).json({ success: false, error: 'Malformed request body.' });
      return;
    }

    if (limits.maxRiskPerTradePct !== undefined) {
      const val = parseFloat(limits.maxRiskPerTradePct);
      if (isNaN(val) || val <= 0 || val > 1.0) {
        res.status(400).json({
          success: false,
          error: 'Validation Error: maxRiskPerTradePct must be between 0.01% and 1.00% (institutional ceiling).',
        });
        return;
      }
    }

    if (limits.dailyLossShutdownPct !== undefined) {
      const val = parseFloat(limits.dailyLossShutdownPct);
      if (isNaN(val) || val <= 0 || val > 2.5) {
        res.status(400).json({
          success: false,
          error: 'Validation Error: dailyLossShutdownPct must be between 0.1% and 2.50% (institutional ceiling).',
        });
        return;
      }
    }

    if (limits.maxLeverage !== undefined) {
      const val = parseFloat(limits.maxLeverage);
      if (isNaN(val) || val <= 0 || val > 3.0) {
        res.status(400).json({
          success: false,
          error: 'Validation Error: maxLeverage must be between 1.0x and 3.0x (institutional ceiling).',
        });
        return;
      }
    }

    if (limits.consecutiveLossCooldownMinutes !== undefined) {
      const val = parseFloat(limits.consecutiveLossCooldownMinutes);
      if (isNaN(val) || val < 30) {
        res.status(400).json({
          success: false,
          error: 'Validation Error: consecutiveLossCooldownMinutes cannot be below 30 minutes (institutional floor to prevent revenge trading).',
        });
        return;
      }
    }

    if (limits.maxConsecutiveLosses !== undefined) {
      const val = parseInt(limits.maxConsecutiveLosses, 10);
      if (isNaN(val) || val < 1 || val > 10) {
        res.status(400).json({
          success: false,
          error: 'Validation Error: maxConsecutiveLosses must be between 1 and 10.',
        });
        return;
      }
    }

    next();
  };
}

export const authService = new AuthService();
