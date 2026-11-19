import { GoogleGenAI, Type } from "@google/genai";

export interface BacktestMarketSummaryInput {
  symbol: string;
  name: string;
  tickCount: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnL: number;
  maxDrawdown: number;
  maxConsecutiveLosses: number;
  maxStakeUsed: number;
  profitFactor: number;
  longestTriggerStreak: number;
  riskScore: number;
  riskTier: string;
}

export interface BacktestAIRequest {
  config: {
    strategy: "EVEN_ODD" | "DIGIT_OVER";
    evenOddMode?: "reversal" | "follow";
    targetStreak: number;
    baseStake: number;
    useRecovery: boolean;
    tickCount: number;
  };
  results: BacktestMarketSummaryInput[];
}

export interface BacktestAIAnalysis {
  executiveSummary: string;
  bestMarketSymbol: string;
  recommendedMarkets: Array<{
    symbol: string;
    riskTier: "LOW" | "MEDIUM" | "HIGH";
    rationale: string;
  }>;
  avoidMarkets: Array<{
    symbol: string;
    reason: string;
  }>;
  parameterGuidance: string;
  minSafeBankrollUsd: number;
}

let cachedClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    const err = new Error(
      "GEMINI_API_KEY is not configured. Add GEMINI_API_KEY in Settings > Secrets to enable AI market analysis."
    ) as Error & { statusCode?: number };
    err.statusCode = 503;
    throw err;
  }

  if (!cachedClient) {
    cachedClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return cachedClient;
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      const status = err?.status || err?.statusCode || 0;
      const isRetryable = status === 429 || status >= 500 || status === 0;
      if (!isRetryable || attempt === maxAttempts) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 600 * attempt));
    }
  }
  throw lastError;
}

export async function analyzeBacktestWithGemini(
  payload: BacktestAIRequest
): Promise<BacktestAIAnalysis> {
  const ai = getGeminiClient();
  const { config, results } = payload;

  const compactMetrics = results.map((r, idx) => ({
    rank: idx + 1,
    symbol: r.symbol,
    name: r.name,
    trades: r.totalTrades,
    winRatePct: Number(r.winRate.toFixed(2)),
    netPnL: Number(r.netPnL.toFixed(2)),
    maxDrawdown: Number(r.maxDrawdown.toFixed(2)),
    maxConsLosses: r.maxConsecutiveLosses,
    maxStakeUsed: Number(r.maxStakeUsed.toFixed(2)),
    profitFactor: Number(r.profitFactor.toFixed(2)),
    longestTriggerStreak: r.longestTriggerStreak,
    riskScore: Number(r.riskScore.toFixed(1)),
    riskTier: r.riskTier,
  }));

  const strategyDesc =
    config.strategy === "EVEN_ODD"
      ? `EVEN_ODD (${config.evenOddMode === "follow" ? "Follow Streak" : "Counter Streak"}, ~95% payout yield)`
      : "DIGIT_OVER (Digit Over 1, ~21% payout yield)";

  const prompt = [
    `Analyze this ${config.tickCount}-tick backtest across ${compactMetrics.length} Deriv synthetic indices.`,
    `Strategy: ${strategyDesc} | Streak: ${config.targetStreak} | Stake: $${config.baseStake.toFixed(2)} | Recovery: ${config.useRecovery ? "ON" : "OFF"}`,
    ``,
    `Ranked metrics:`,
    JSON.stringify(compactMetrics),
    ``,
    `Rules:`,
    `1. Pick the top 3 markets with the lowest maxDrawdown, fewest maxConsLosses, and positive netPnL.`,
    `2. Keep executiveSummary to 1-2 short plain-English sentences (max 30 words).`,
    `3. Keep each rationale and reason under 12 words, mentioning key figures (e.g. "Max DD $2.10, +$14.50 profit").`,
    `4. Recommend a realistic minSafeBankrollUsd and a 1-sentence parameterGuidance tip.`,
  ].join("\n");

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: "gemini-4-hydrogen",
      contents: prompt,
      config: {
        systemInstruction:
          "You are a concise trading risk analyst. Write short, plain-English summaries with zero jargon. Focus on low drawdown and avoiding losing streaks.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            executiveSummary: {
              type: Type.STRING,
              description: "1-2 short sentences summarizing which markets have the lowest drawdown.",
            },
            bestMarketSymbol: {
              type: Type.STRING,
              description: "Single best low-drawdown market symbol.",
            },
            recommendedMarkets: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  symbol: { type: Type.STRING },
                  riskTier: { type: Type.STRING },
                  rationale: { type: Type.STRING },
                },
                required: ["symbol", "riskTier", "rationale"],
              },
              description: "Top 3 low-drawdown markets.",
            },
            avoidMarkets: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  symbol: { type: Type.STRING },
                  reason: { type: Type.STRING },
                },
                required: ["symbol", "reason"],
              },
              description: "Top 2 high-drawdown markets to avoid.",
            },
            parameterGuidance: {
              type: Type.STRING,
              description: "One short sentence on streak or stake safety.",
            },
            minSafeBankrollUsd: {
              type: Type.NUMBER,
              description: "Estimated minimum USD balance needed for the top picks.",
            },
          },
          required: [
            "executiveSummary",
            "bestMarketSymbol",
            "recommendedMarkets",
            "avoidMarkets",
            "parameterGuidance",
            "minSafeBankrollUsd",
          ],
        },
      },
    })
  );

  const rawText = (response.text ?? "").trim();
  if (!rawText) {
    throw new Error("Empty response received from Gemini AI analyst.");
  }

  const parsed = JSON.parse(rawText) as BacktestAIAnalysis;
  return {
    executiveSummary: parsed.executiveSummary || "",
    bestMarketSymbol: parsed.bestMarketSymbol || compactMetrics[0]?.symbol || "",
    recommendedMarkets: Array.isArray(parsed.recommendedMarkets)
      ? parsed.recommendedMarkets.map((item) => ({
          symbol: item.symbol,
          riskTier:
            item.riskTier === "LOW" || item.riskTier === "HIGH" ? item.riskTier : "MEDIUM",
          rationale: item.rationale,
        }))
      : [],
    avoidMarkets: Array.isArray(parsed.avoidMarkets) ? parsed.avoidMarkets : [],
    parameterGuidance: parsed.parameterGuidance || "",
    minSafeBankrollUsd: Number(parsed.minSafeBankrollUsd) || 0,
  };
}
