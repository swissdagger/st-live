import { BinanceKline, CandlestickData, CryptoSymbol, TimeframeConfig, TimeframeParseResult } from '../types';

// Supported Binance intervals
const SUPPORTED_BINANCE_INTERVALS = [
  '1s', '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'
];

// Helper function to convert Binance interval to minutes
export const convertIntervalToMinutes = (interval: string): number => {
  const value = parseInt(interval.replace(/[a-zA-Z]/g, ''));
  const unit = interval.replace(/[0-9]/g, '').toLowerCase();
  
  switch (unit) {
    case 's':
      return value / 60; // Convert seconds to minutes
    case 'm':
      return value;
    case 'h':
      return value * 60;
    case 'd':
      return value * 60 * 24;
    case 'w':
      return value * 60 * 24 * 7;
    case 'M': // Assuming 30 days per month
      return value * 60 * 24 * 30;
    default:
      return value; // Default to treating as minutes
  }
};

// Helper function to calculate dataLimit based on the formula
export const calculateDataLimit = (interval: string): number => {
  // Base calculation using minutes
  const convMinuteValue = convertIntervalToMinutes(interval);
  
  // For very short timeframes (< 30 minutes), use 3000 as base
  // For longer timeframes, scale down appropriately
  const baseValue = 3000; // 3000 minutes of data
  const calculatedLimit = Math.round(baseValue / convMinuteValue);
  
  // Ensure minimum limit of 1 and maximum reasonable limit
  return Math.max(1, Math.min(calculatedLimit, 10000));
};

const createBaseTimeframes = (symbol: string): TimeframeConfig[] => [
  {
    id: '1d',
    label: '1 Day',
    binanceInterval: '1d',
    wsEndpoint: `${symbol.toLowerCase()}@kline_1d`,
    color: '#919191',
    dataLimit: calculateDataLimit('1d'),
  },
  {
    id: '12h',
    label: '12 Hours',
    binanceInterval: '12h',
    wsEndpoint: `${symbol.toLowerCase()}@kline_12h`,
    color: '#919191',
    dataLimit: calculateDataLimit('12h'),
  },
  {
    id: '8h',
    label: '8 Hours',
    binanceInterval: '8h',
    wsEndpoint: `${symbol.toLowerCase()}@kline_8h`,
    color: '#919191',
    dataLimit: calculateDataLimit('8h'),
  },
  {
    id: '4h',
    label: '4 Hours',
    binanceInterval: '4h',
    wsEndpoint: `${symbol.toLowerCase()}@kline_4h`,
    color: '#919191',
    dataLimit: calculateDataLimit('4h'),
  },
  {
    id: '2h',
    label: '2 Hours',
    binanceInterval: '2h',
    wsEndpoint: `${symbol.toLowerCase()}@kline_2h`,
    color: '#919191',
    dataLimit: calculateDataLimit('2h'),
  },
  {
    id: '1h',
    label: '1 Hour',
    binanceInterval: '1h',
    wsEndpoint: `${symbol.toLowerCase()}@kline_1h`,
    color: '#919191',
    dataLimit: calculateDataLimit('1h'),
  },
  {
    id: '30m',
    label: '30 Minutes',
    binanceInterval: '30m',
    wsEndpoint: `${symbol.toLowerCase()}@kline_30m`,
    color: '#919191',
    dataLimit: calculateDataLimit('30m'),
  },
    {
    id: '15m',
    label: '15 Minutes',
    binanceInterval: '15m',
    wsEndpoint: `${symbol.toLowerCase()}@kline_15m`,
    color: '#919191',
    dataLimit: calculateDataLimit('15m'),
  },
  {
    id: '5m',
    label: '5 Minutes',
    binanceInterval: '5m',
    wsEndpoint: `${symbol.toLowerCase()}@kline_5m`,
    color: '#919191',
    dataLimit: calculateDataLimit('5m'),
  },
  {
    id: '3m',
    label: '3 Minutes',
    binanceInterval: '3m',
    wsEndpoint: `${symbol.toLowerCase()}@kline_3m`,
    color: '#919191',
    dataLimit: calculateDataLimit('3m'),
  },
  {
    id: '1m',
    label: '1 Minute',
    binanceInterval: '1m',
    wsEndpoint: `${symbol.toLowerCase()}@kline_1m`,
    color: '#919191',
    dataLimit: calculateDataLimit('1m'),
  },
];

export const getInitialTimeframes = (symbol: CryptoSymbol, sixteenTimesDataLimit: boolean = false) => {
  const baseTimeframes = createBaseTimeframes(symbol);
  if (sixteenTimesDataLimit) {
    return baseTimeframes.map(tf => ({
      ...tf,
      dataLimit: tf.dataLimit * 4 // Now 16x the base limit (quadrupled again)
    }));
  }
  return baseTimeframes;
};

export const parseAndValidateTimeframeInput = (input: string): TimeframeParseResult => {
  // Trim and split the input
  const trimmedInput = input.trim();
  const parts = trimmedInput.split(/\s+/);
  
  if (parts.length !== 2) {
    return {
      success: false,
      error: 'Invalid format: please use "{time_value} {time_unit}" format.'
    };
  }
  
  const [valueStr, unit] = parts;
  const value = parseInt(valueStr, 10);
  
  // Validate the numeric value
  if (isNaN(value) || value <= 0) {
    return {
      success: false,
      error: 'Invalid format: please use "{time_value} {time_unit}" format.'
    };
  }
  
  // Validate and convert the unit
  let binanceInterval: string;
  let label: string;
  
  switch (unit.toUpperCase()) {
    case 'S':
      return {
        success: false,
        error: 'Timeframe unavailable.'
      };
    case 'M':
      binanceInterval = `${value}m`;
      label = value === 1 ? '1 Minute' : `${value} Minutes`;
      break;
    case 'H':
      binanceInterval = `${value}h`;
      label = value === 1 ? '1 Hour' : `${value} Hours`;
      break;
    case 'D':
      binanceInterval = `${value}d`;
      label = value === 1 ? '1 Day' : `${value} Days`;
      break;
    case 'W':
      binanceInterval = `${value}w`;
      label = value === 1 ? '1 Week' : `${value} Weeks`;
      break;
    default:
      return {
        success: false,
        error: 'Invalid format: please use "{time_value} {time_unit}" format.'
      };
  }
  
  // Check if the interval is supported by Binance
  if (!SUPPORTED_BINANCE_INTERVALS.includes(binanceInterval)) {
    return {
      success: false,
      error: 'Timeframe unavailable.'
    };
  }
  
  return {
    success: true,
    binanceInterval,
    label
  };
};

let klinePollingInterval: number | null = null;
// Changed to support multiple symbols
const activeSymbolTimeframes: Map<CryptoSymbol, TimeframeConfig[]> = new Map();
const candlestickData: Record<string, CandlestickData[]> = {};
// NEW: Mutex to prevent concurrent polling cycles
let isKlinePollingInProgress = false;

// NEW: Persistent cache for candlestick data with timestamps
const candlestickDataCache: Map<string, {
    data: CandlestickData[];
    timestamp: number;
}> = new Map();

const CACHE_DURATION = 30000; // 30 seconds cache duration

// Helper to get cached data if still valid
const getCachedCandlestickData = (key: string): CandlestickData[] | null => {
    const cached = candlestickDataCache.get(key);
    if (!cached) return null;
    
    const now = Date.now();
    if (now - cached.timestamp > CACHE_DURATION) {
        candlestickDataCache.delete(key);
        return null;
    }
    
    return cached.data;
};

// Helper to cache candlestick data
const setCachedCandlestickData = (key: string, data: CandlestickData[]) => {
    candlestickDataCache.set(key, {
        data: [...data],
        timestamp: Date.now()
    });
};

// Timeout wrapper to prevent indefinitely hanging requests
const withTimeout = <T>(promise: Promise<T>, timeoutMs: number, operationName: string): Promise<T> => {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout: ${operationName} took longer than ${timeoutMs}ms`)), timeoutMs)
        )
    ]);
};

type UpdateCallback = (data: CandlestickData[], timeframeId: string) => void;
const updateCallbacks: UpdateCallback[] = [];


export const fetchKlineData = async (
  timeframe: TimeframeConfig,
  symbol: CryptoSymbol,
  limit: number = 1
): Promise<CandlestickData[]> => {
  const key = `${symbol}-${timeframe.id}`; // Declare key once at the top
  
  try {
    // Check cache first for initial load (limit !== 1)
    if (limit !== 1) {
        const cachedData = getCachedCandlestickData(key);
        if (cachedData && cachedData.length >= timeframe.dataLimit * 0.9) {
            console.log(`[CACHE] Using cached data for ${key} (${cachedData.length} candles)`);
            return cachedData;
        }
    }
    
    // Determine the actual limit to use
    let requestLimit: number;
    if (limit === 1) {
      requestLimit = 1; // Single candle update
    } else {
      requestLimit = timeframe.dataLimit; // Use the timeframe's dataLimit (which may be 16x)
    }
    
    // Binance API has a maximum limit of 1000 per request
    // For larger limits, we need to make multiple requests
    const maxApiLimit = 1000;
    let allData: any[] = [];
    
    if (requestLimit <= maxApiLimit) {
      // Single request for smaller limits
      const response = await withTimeout(
          fetch(
              `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${timeframe.binanceInterval}&limit=${requestLimit}`
          ),
          10000, // 10 second timeout
          `fetchKlineData for ${symbol} ${timeframe.binanceInterval}`
      );
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      allData = await response.json();
    } else {
      // Multiple requests for larger limits
      const numRequests = Math.ceil(requestLimit / maxApiLimit);
      let endTime: number | undefined;
      
      for (let i = 0; i < numRequests; i++) {
        const currentLimit = Math.min(maxApiLimit, requestLimit - (i * maxApiLimit));
        
        let url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${timeframe.binanceInterval}&limit=${currentLimit}`;
        if (endTime) {
          url += `&endTime=${endTime}`;
        }
        
        const response = await fetch(url);
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.length === 0) break;
        
        // Prepend data to get chronological order
        allData = [...data, ...allData];
        
        // Set endTime to the start time of the first candle minus 1ms for next request
        endTime = data[0][0] - 1;
        
        // Small delay to avoid rate limiting
        if (i < numRequests - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      // Remove duplicates and sort by time
      const uniqueData = allData.filter((item, index, arr) => 
        index === 0 || item[0] !== arr[index - 1][0]
      );
      
      // Keep only the most recent requestLimit items
      allData = uniqueData.slice(-requestLimit);
    }
    
    const formattedData: CandlestickData[] = allData.map((item: any[]) => ({
      time: item[0] / 1000,
      open: parseFloat(item[1]),
      high: parseFloat(item[2]),
      low: parseFloat(item[3]),
      close: parseFloat(item[4]),
    }));
    
    if (limit === 1) {
      // Update cache with the latest candle
      if (candlestickData[key]) {
        const lastIndex = candlestickData[key].length - 1;
        if (lastIndex >= 0 && candlestickData[key][lastIndex].time === formattedData[0].time) {
          candlestickData[key][lastIndex] = formattedData[0];
        } else {
          candlestickData[key].push(formattedData[0]);
          if (candlestickData[key].length > timeframe.dataLimit) {
            candlestickData[key].shift();
          }
        }
      }
    } else {
      // Initial data load
      candlestickData[key] = formattedData;
      // Cache the data for future loads
      setCachedCandlestickData(key, formattedData);
    }
    
    return candlestickData[key] || [];
  } catch (error) {
    console.error(`Error fetching kline data for ${timeframe.label}:`, error);
    
    // Try to return cached data on error (key already declared at top)
    const cachedData = getCachedCandlestickData(key);
    if (cachedData) {
        console.log(`[CACHE] Returning cached data after error for ${key}`);
        return cachedData;
    }
    
    return [];
  }
};

export const startKlinePolling = (symbol: CryptoSymbol, activeTimeframes?: TimeframeConfig[]) => {
    // Add or update the symbol and its timeframes
    const timeframesToUse = activeTimeframes || getInitialTimeframes(symbol);
    activeSymbolTimeframes.set(symbol, timeframesToUse);
    
    console.log(`[POLLING] Added/updated ${symbol} with ${timeframesToUse.length} timeframe(s):`, timeframesToUse.map(tf => tf.id));
    console.log(`[POLLING] Total active symbols:`, Array.from(activeSymbolTimeframes.keys()));
    
    // Start the polling interval if not already running
    if (klinePollingInterval === null) {
        console.log('[POLLING] Starting kline polling interval...');
        klinePollingInterval = window.setInterval(async () => {
            // MUTEX: Prevent concurrent execution
            if (isKlinePollingInProgress) {
                console.warn('[POLLING] Previous kline polling cycle still in progress, skipping this cycle');
                return;
            }

            const now = new Date();
            const seconds = now.getSeconds();
            const minutes = now.getMinutes();
            const hours = now.getHours();

            // Only fetch data when the second is 0
            if (seconds !== 0) return;

            // Set mutex flag BEFORE starting async work
            isKlinePollingInProgress = true;
            const startTime = Date.now();

            try {
                // Collect all fetch operations that need to happen
                const fetchPromises: Promise<void>[] = [];

                console.log(`[POLLING] Checking updates at ${now.toISOString()} for ${activeSymbolTimeframes.size} symbols`);

                // Iterate through ALL registered symbols
                for (const [currentSymbol, currentTimeframes] of activeSymbolTimeframes.entries()) {
                    for (const timeframe of currentTimeframes) {
                        let shouldFetch = false;

                        // Parse the interval to determine when to fetch
                        const interval = timeframe.binanceInterval;
                        if (interval.endsWith('m')) {
                            const intervalMinutes = parseInt(interval);
                            shouldFetch = minutes % intervalMinutes === 0;
                        } else if (interval.endsWith('h')) {
                            const intervalHours = parseInt(interval);
                            shouldFetch = minutes === 0 && hours % intervalHours === 0;
                        } else if (interval.endsWith('d')) {
                            const intervalDays = parseInt(interval);
                            shouldFetch = minutes === 0 && hours === 0; // Daily at midnight
                        } else if (interval.endsWith('w')) {
                            shouldFetch = minutes === 0 && hours === 0 && now.getDay() === 1; // Weekly on Monday
                        }

                        if (shouldFetch) {
                            console.log(`[POLLING] 📊 Fetching ${currentSymbol} ${timeframe.id}`);
                            
                            // Create a promise for this fetch operation
                            const fetchPromise = fetchKlineData(timeframe, currentSymbol, 1)
                                .then(data => {
                                    const key = `${currentSymbol}-${timeframe.id}`;
                                    console.log(`[POLLING] ✅ Fetched ${key}, notifying ${updateCallbacks.length} callbacks`);
                                    updateCallbacks.forEach(callback => callback(data, key));
                                })
                                .catch(error => {
                                    console.error(`[POLLING] ❌ Error fetching ${currentSymbol} ${timeframe.id}:`, error);
                                });

                            fetchPromises.push(fetchPromise);
                        }
                    }
                }

                // Wait for all fetch operations to complete
                if (fetchPromises.length > 0) {
                    console.log(`[POLLING] Waiting for ${fetchPromises.length} fetch operations...`);
                    await Promise.allSettled(fetchPromises);

                    const endTime = Date.now();
                    const duration = endTime - startTime;
                    console.log(`[POLLING] ✅ Kline polling cycle completed in ${duration}ms`);

                    // Warn if taking too long (approaching 1 second)
                    if (duration > 800) {
                        console.warn(`[POLLING] ⚠️ Kline polling cycle took ${duration}ms - approaching timeout threshold!`);
                    }
                } else {
                    console.log(`[POLLING] No updates needed at ${minutes}:${seconds.toString().padStart(2, '0')}`);
                }
            } catch (error) {
                console.error('[POLLING] ❌ Unexpected error in kline polling cycle:', error);
            } finally {
                // ALWAYS release mutex, even if errors occurred
                isKlinePollingInProgress = false;
            }
        }, 1000);
        
        console.log('[POLLING] ✅ Kline polling interval started');
    } else {
        console.log('[POLLING] Kline polling interval already running');
    }
};

// New function to remove a symbol from polling
export const stopKlinePolling = (symbol: CryptoSymbol) => {
    if (activeSymbolTimeframes.has(symbol)) {
        activeSymbolTimeframes.delete(symbol);
        console.log(`[POLLING] Removed ${symbol} from polling`);
        console.log(`[POLLING] Remaining active symbols:`, Array.from(activeSymbolTimeframes.keys()));
        
        // If no more symbols are being polled, clean up the interval
        if (activeSymbolTimeframes.size === 0 && klinePollingInterval !== null) {
            clearInterval(klinePollingInterval);
            klinePollingInterval = null;
            console.log('[POLLING] All symbols removed, kline polling interval stopped');
        }
    }
};

export const subscribeToUpdates = (callback: UpdateCallback) => {
  updateCallbacks.push(callback);
  console.log(`[SUBSCRIPTION] Added callback. Total callbacks: ${updateCallbacks.length}`);
  return () => {
    const index = updateCallbacks.indexOf(callback);
    if (index !== -1) {
      updateCallbacks.splice(index, 1);
      console.log(`[SUBSCRIPTION] Removed callback. Total callbacks: ${updateCallbacks.length}`);
    }
  };
};

export const getCurrentData = (timeframeId: string, symbol: CryptoSymbol): CandlestickData[] => {
  const key = `${symbol}-${timeframeId}`;
  return [...(candlestickData[key] || [])];
};

export const cleanupConnections = () => {
  if (klinePollingInterval !== null) {
    clearInterval(klinePollingInterval);
    klinePollingInterval = null;
  }
  activeSymbolTimeframes.clear();
  isKlinePollingInProgress = false;
  console.log('[POLLING] Cleanup complete');
};

// New function to clear specific symbol cache
export const clearSymbolCache = (symbol: CryptoSymbol) => {
    const keysToDelete: string[] = [];
    candlestickDataCache.forEach((_, key) => {
        if (key.startsWith(symbol)) {
            keysToDelete.push(key);
        }
    });
    keysToDelete.forEach(key => candlestickDataCache.delete(key));
    console.log(`[CACHE] Cleared cache for ${symbol} (${keysToDelete.length} entries)`);
};

// New function to clear all caches
export const clearAllCaches = () => {
    candlestickDataCache.clear();
    console.log('[CACHE] Cleared all candlestick caches');
};