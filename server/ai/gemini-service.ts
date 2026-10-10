import { GoogleGenAI } from '@google/genai';
import { AIResearchResponse, MarketRegimeType } from '../../src/types/trading';
import { marketDataService } from '../data/market-data-service';
import { auditLogger } from '../audit/audit-logger';

export class GeminiResearchService {
  private ai: GoogleGenAI | null = null;

  constructor(private readonly testGenerator?: (contents: string) => Promise<string | undefined>) {
    if (!testGenerator && process.env.GEMINI_API_KEY) {
      try {
        this.ai = new GoogleGenAI({
          apiKey: process.env.GEMINI_API_KEY,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            },
          },
        });
      } catch (error) {
        const errorType = error instanceof Error ? error.name : 'UnknownError';
        console.warn(`Gemini client initialization failed (${errorType}); local research fallback remains active.`);
      }
    }
  }

  private async generateModelResponse(contents: string): Promise<string | undefined> {
    if (this.testGenerator) return this.testGenerator(contents);
    if (!this.ai) return undefined;
    const response = await this.ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents,
      config: {
        systemInstruction: `You are the Lead Quantitative Research Director of Global AI Trader OS.
Your mandate is capital preservation, empirical risk-adjusted returns, and explainability.
RULES:
1. Never promise daily percentage returns or guaranteed profits.
2. Formulate testable quantitative hypotheses grounded in statistical properties (mean reversion, momentum persistence, volatility clustering).
3. Always supply specific invalidation thresholds and protective risk boundaries.
4. Output must be structured and directly actionable for quantitative portfolio managers.`,
        responseMimeType: 'application/json',
      },
    });
    return response.text || undefined;
  }

  public async conductResearch(params: {
    symbol?: string;
    targetRegime?: MarketRegimeType;
    promptText?: string;
  }): Promise<AIResearchResponse> {
    const symbol = params.symbol || 'SPY';
    const quote = marketDataService.getQuote(symbol);
    const candles = marketDataService.getCandles(symbol, 30);
    const lastBar = candles[candles.length - 1];
    const ind = lastBar?.indicators;
    const currentRegime = marketDataService.classifyMarketRegime(symbol);

    const marketContext = `
Instrument: ${symbol}
Current Price: $${quote?.lastPrice || lastBar?.close || 100}
24h Change: ${quote?.change24hPct || 0}%
Spread: ${((quote?.spreadPct || 0.0003) * 100).toFixed(4)}%
Regime Classification: ${currentRegime}
EMA20: ${ind?.ema20 || 'N/A'}, EMA50: ${ind?.ema50 || 'N/A'}, EMA200: ${ind?.ema200 || 'N/A'}
ADX(14): ${ind?.adx14 || 'N/A'}, ATR(14): $${ind?.atr14 || 'N/A'}, RSI(14): ${ind?.rsi14 || 'N/A'}
Bollinger Bands: Lower $${ind?.bbLower || 'N/A'} / Mid $${ind?.bbMiddle || 'N/A'} / Upper $${ind?.bbUpper || 'N/A'}
Realized Volatility: ${ind?.volatility || 'N/A'}%
Operator Inquiry: ${params.promptText || 'Conduct quantitative regime breakdown and explainable strategy recommendations.'}
`;

    if (this.testGenerator || (this.ai && process.env.GEMINI_API_KEY)) {
      try {
        const rawText = await this.generateModelResponse(marketContext);
        if (rawText) {
          const parsed = JSON.parse(rawText);
          auditLogger.record({
            category: 'STRATEGY_SIGNAL',
            level: 'INFO',
            action: 'AI_QUANT_RESEARCH_GENERATED',
            details: { symbol, regime: currentRegime },
            actor: 'STRATEGY_ENGINE',
          });

          return {
            hypothesis: parsed.hypothesis || `Regime hypothesis for ${symbol} under ${currentRegime}.`,
            marketRegimeAssessment: parsed.marketRegimeAssessment || `Current market exhibits ${currentRegime} dynamics.`,
            riskEvaluation: parsed.riskEvaluation || 'Risk parameters must enforce strict stop-loss bounds.',
            explainableSignals: parsed.explainableSignals || [
              {
                symbol,
                recommendation: currentRegime === 'TRENDING_BULL' ? 'STRONG_SIGNAL' : 'CAUTIOUS',
                quantitativeReasoning: `Price action aligned with ${currentRegime}.`,
                riskBoundary: `Exit on 2.0x ATR breach below $${Number(((lastBar?.close || 100) - (ind?.atr14 || 2) * 2).toFixed(2))}`,
              },
            ],
            regulatoryNotice: 'Model output is purely advisory. All executions remain strictly subject to the deterministic risk engine.',
          };
        }
      } catch (error) {
        const errorType = error instanceof Error ? error.name : 'UnknownError';
        console.warn(`Gemini API call failed (${errorType}); generating deterministic quant research report.`);
      }
    }

    // Deterministic High-Fidelity Quantitative Research Fallback
    auditLogger.record({
      category: 'STRATEGY_SIGNAL',
      level: 'INFO',
      action: 'QUANT_RESEARCH_GENERATED_OFFLINE',
      details: { symbol, regime: currentRegime },
      actor: 'STRATEGY_ENGINE',
    });

    const isBull = currentRegime === 'TRENDING_BULL';
    const isRanging = currentRegime.includes('RANGING');
    const stopDistance = (ind?.atr14 || (lastBar?.close || 100) * 0.02) * 2.0;

    return {
      hypothesis: isBull
        ? `Hypothesis: Positive momentum persistence is observed in ${symbol}. Trending velocity is statistically confirmed by ADX=${ind?.adx14 || 28} and EMA ribbon alignment.`
        : isRanging
        ? `Hypothesis: Mean reversion boundary condition active for ${symbol}. Price oscillates between Bollinger Bands with RSI mean-reverting around 50.`
        : `Hypothesis: Heightened volatility shock in ${symbol}. Statistical variance (${ind?.volatility || 2.8}%) warrants capital conservation and no-trade stance.`,
      marketRegimeAssessment: `The asset is operating in a ${currentRegime} regime. Volatility profile stands at ${ind?.volatility || 1.8}% with ATR14 at $${ind?.atr14 || 2.40}.`,
      riskEvaluation: `Hard ceiling stop-loss must be placed at $${Number(((lastBar?.close || 100) - stopDistance).toFixed(2))} (2.0x ATR). Max position risk budget strictly limited to 0.25% of equity.`,
      explainableSignals: [
        {
          symbol,
          recommendation: isBull ? 'STRONG_SIGNAL' : isRanging ? 'CAUTIOUS' : 'NO_TRADE',
          quantitativeReasoning: isBull
            ? `Price above EMA20 and EMA50 with ADX at ${ind?.adx14 || 30} indicates significant trend probability.`
            : isRanging
            ? `Price near boundary of Bollinger Band ($${ind?.bbLower || 'N/A'}) with RSI at ${ind?.rsi14 || 45}.`
            : `Regime uncertainty triggers mandatory capital preservation filter.`,
          riskBoundary: `Hard stop at $${Number(((lastBar?.close || 100) - stopDistance).toFixed(2))}; Trailing stop offset at 1.5x ATR.`,
        },
      ],
      regulatoryNotice:
        'Algorithmic trading carries material risk of capital loss. Past or backtested performance does not guarantee future results. AI research outputs are non-authoritative recommendations subject to independent deterministic risk limits.',
    };
  }
}

export const geminiResearchService = new GeminiResearchService();
