export type StrategyType = 'DIGIT_OVER' | 'EVEN_ODD' | 'DCIRCLES_EVEN_ODD';
export type EvenOddMode = 'reversal' | 'follow';

export const SYNTHETIC_MARKET_CATALOG: Array<{
  symbol: string;
  name: string;
  shortName: string;
  group: 'volatility' | '1s' | 'jump' | 'daily';
}> = [
  { symbol: 'R_10', name: 'Volatility 10 Index', shortName: 'Volatility 10', group: 'volatility' },
  { symbol: 'R_25', name: 'Volatility 25 Index', shortName: 'Volatility 25', group: 'volatility' },
  { symbol: 'R_50', name: 'Volatility 50 Index', shortName: 'Volatility 50', group: 'volatility' },
  { symbol: 'R_75', name: 'Volatility 75 Index', shortName: 'Volatility 75', group: 'volatility' },
  { symbol: 'R_100', name: 'Volatility 100 Index', shortName: 'Volatility 100', group: 'volatility' },
  { symbol: '1HZ10V', name: 'Volatility 10 (1s) Index', shortName: 'Volatility 10 (1s)', group: '1s' },
  { symbol: '1HZ25V', name: 'Volatility 25 (1s) Index', shortName: 'Volatility 25 (1s)', group: '1s' },
  { symbol: '1HZ50V', name: 'Volatility 50 (1s) Index', shortName: 'Volatility 50 (1s)', group: '1s' },
  { symbol: '1HZ75V', name: 'Volatility 75 (1s) Index', shortName: 'Volatility 75 (1s)', group: '1s' },
  { symbol: '1HZ100V', name: 'Volatility 100 (1s) Index', shortName: 'Volatility 100 (1s)', group: '1s' },
  { symbol: 'JD10', name: 'Jump 10 Index', shortName: 'Jump 10', group: 'jump' },
  { symbol: 'JD25', name: 'Jump 25 Index', shortName: 'Jump 25', group: 'jump' },
  { symbol: 'JD50', name: 'Jump 50 Index', shortName: 'Jump 50', group: 'jump' },
  { symbol: 'JD75', name: 'Jump 75 Index', shortName: 'Jump 75', group: 'jump' },
  { symbol: 'JD100', name: 'Jump 100 Index', shortName: 'Jump 100', group: 'jump' },
  { symbol: 'RDBEAR', name: 'Bear Market Index', shortName: 'Bear Market', group: 'daily' },
  { symbol: 'RDBULL', name: 'Bull Market Index', shortName: 'Bull Market', group: 'daily' }
];

export const ALL_MARKET_SYMBOLS = [
  'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
  '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V',
  'JD10', 'JD25', 'JD50', 'JD75', 'JD100',
  'RDBEAR', 'RDBULL'
] as const;
