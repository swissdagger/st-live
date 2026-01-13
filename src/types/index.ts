export interface CandlestickData {
  time: number;
  open: number;
  high: number;
  close: number;
  low: number;
}

export interface BinanceKline {
  e: string; // Event type
  E: number; // Event time
  s: string; // Symbol
  k: {
    t: number; // Kline start time
    T: number; // Kline close time
    s: string; // Symbol
    i: string; // Interval
    f: number; // First trade ID
    L: number; // Last trade ID
    o: string; // Open price
    c: string; // Close price
    h: string; // High price
    l: string; // Low price
    v: string; // Base asset volume
    n: number; // Number of trades
    x: boolean; // Is this kline closed?
    q: string; // Quote asset volume
    V: string; // Taker buy base asset volume
    Q: string; // Taker buy quote asset volume
    B: string; // Ignore
  };
}

export interface TimeframeConfig {
  id: string;
  label: string;
  binanceInterval: string;
  wsEndpoint: string;
  color: string;
  dataLimit: number;
}

export interface PredictionData {
  [datetime: string]: number; // -1, 0, or 1
}

export interface PredictionEntry {
    datetime: string;
    value: number;
    timeframeId: string;
    ticker: string;
}

export interface StoredPrediction {
    id: string;
    timeframe: string;
    datetime: string;
    value: number;
    ticker: string;
    created_at: string;
    updated_at: string;
}


export interface ArrowPosition {
    x: number;
    y: number;
    value: number;
    datetime: string;
    timeframeId: string;
    ticker: string; 
    isChangeEnding?: boolean;
    endTime?: string;
}

export interface ChartContainerProps {
  timeframe: TimeframeConfig;
  height: number;
  symbol: string;
  fixLeftEdge?: boolean;
  onTimeframeUpdate?: (updatedTimeframe: TimeframeConfig) => void;
  showHistoricalPerformance?: boolean;
  allPredictions?: Record<string, PredictionEntry[]>;
  showAllInsights?: boolean;
}

export interface PredictionArrowProps {
    value: number;
    position: { x: number; y: number };
    timeframeId: string;
    ticker: string;
}

export interface ConnectionStatusProps {
  connected: boolean;
  reconnecting?: boolean;
  timeframe: string;
}

export type CryptoSymbol = string;

export interface TimeframeParseResult {
  success: boolean;
  binanceInterval?: string;
  label?: string;
  error?: string;
}