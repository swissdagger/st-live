import { supabase } from '../lib/supabase';
import { PredictionEntry, StoredPrediction } from '../types';
import { getInitialTimeframes } from '../api/binanceAPI';

// Cache for predictions - now organized by ticker
const predictionCache: Record<string, Record<string, PredictionEntry[]>> = {};
const fiveTimesDataCache: Record<string, Record<string, PredictionEntry[]>> = {};

// Callbacks for real-time updates
type PredictionCallback = (predictions: PredictionEntry[], timeframeId: string, ticker: string) => void;
const predictionCallbacks: PredictionCallback[] = [];

// Initialize the service
let isInitialized = false;
let realtimeChannel: any = null;
let currentFiveTimesMode = false;

// Helper function to get timeframe label from timeframe ID
const getTimeframeLabel = (timeframeId: string, ticker: string = 'BTCUSDT'): string => {
    const timeframes = getInitialTimeframes(ticker, false);
    const timeframe = timeframes.find(tf => tf.id === timeframeId);
    return timeframe?.label || timeframeId;
};

// Helper to initialize ticker cache if not exists
const initializeTickerCache = (ticker: string) => {
    if (!predictionCache[ticker]) {
        predictionCache[ticker] = { '1m': [], '3m': [], '5m': [], '15m': [], '30m': [], '1h': [], '2h': [], '4h': [], '8h': [], '12h': [], '1d': [] };
    }
    if (!fiveTimesDataCache[ticker]) {
        fiveTimesDataCache[ticker] = { '1m': [], '3m': [], '5m': [], '15m': [], '30m': [], '1h': [], '2h': [], '4h': [], '8h': [], '12h': [], '1d': [] };
    }
};

export const initializePredictionService = async () => {
    if (isInitialized) return;

    try {
        // Clean up any existing channel before creating a new one
        if (realtimeChannel) {
            await supabase.removeChannel(realtimeChannel);
            realtimeChannel = null;
        }

        // Load existing predictions from database
        await loadPredictionsFromDatabase();

        // Set up real-time subscription
        setupRealtimeSubscription();

        isInitialized = true;
        console.log('Prediction service initialized successfully');
    } catch (error) {
        console.error('Failed to initialize prediction service:', error);
    }
};

const fetchAllPredictionsForTimeframe = async (timeframe: string, ticker?: string): Promise<StoredPrediction[]> => {
    const allPredictions: StoredPrediction[] = [];
    const pageSize = 1000;
    let offset = 0;
    let hasMoreData = true;

    console.log(`Starting to fetch all predictions for timeframe: ${timeframe}, ticker: ${ticker || 'all'}`);

    while (hasMoreData) {
        try {
            let query = supabase
                .from('predictions')
                .select('*')
                .eq('timeframe', timeframe)
                .neq('value', 0)
                .order('created_at', { ascending: false })
                .range(offset, offset + pageSize - 1);

            // Filter by ticker if specified
            if (ticker) {
                query = query.eq('ticker', ticker);
            }

            const { data, error } = await query;

            if (error) {
                console.error(`Error fetching predictions for ${timeframe} at offset ${offset}:`, error);
                break;
            }

            if (!data || data.length === 0) {
                hasMoreData = false;
                console.log(`No more data for ${timeframe} at offset ${offset}`);
            } else {
                allPredictions.push(...data);
                console.log(`Fetched ${data.length} predictions for ${timeframe} (total so far: ${allPredictions.length})`);

                if (data.length < pageSize) {
                    hasMoreData = false;
                    console.log(`Reached end of data for ${timeframe} (got ${data.length} < ${pageSize})`);
                } else {
                    offset += pageSize;
                }
            }

            if (hasMoreData) {
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        } catch (error) {
            console.error(`Error during pagination for ${timeframe}:`, error);
            hasMoreData = false;
        }
    }

    console.log(`Finished fetching predictions for ${timeframe}. Total: ${allPredictions.length}`);
    return allPredictions;
};

const loadPredictionsFromDatabase = async (fiveTimesDataLimit: boolean = false, ticker?: string) => {
    try {
        const timeframes = getInitialTimeframes('BTCUSDT', fiveTimesDataLimit);

        // If ticker is specified, load only for that ticker
        const tickersToLoad = ticker ? [ticker] : ['BTCUSDT']; // Default to BTCUSDT if no ticker specified

        for (const currentTicker of tickersToLoad) {
            initializeTickerCache(currentTicker);

            for (const timeframe of timeframes) {
                const normalLimit = Math.floor(timeframe.dataLimit / (fiveTimesDataLimit ? 5 : 1));

                // Fetch ALL predictions using pagination for this ticker
                const allPredictionsData = await fetchAllPredictionsForTimeframe(timeframe.id, currentTicker);

                if (allPredictionsData && allPredictionsData.length > 0) {
                    // Reverse to get chronological order
                    const chronologicalFiveTimesData = allPredictionsData.reverse();

                    fiveTimesDataCache[currentTicker][timeframe.id] = chronologicalFiveTimesData.map((prediction: StoredPrediction) => ({
                        datetime: prediction.datetime,
                        value: prediction.value,
                        timeframeId: prediction.timeframe,
                        ticker: prediction.ticker,
                    }));

                    // Normal cache gets the most recent portion
                    const normalData = chronologicalFiveTimesData.slice(-normalLimit);
                    predictionCache[currentTicker][timeframe.id] = normalData.map((prediction: StoredPrediction) => ({
                        datetime: prediction.datetime,
                        value: prediction.value,
                        timeframeId: prediction.timeframe,
                        ticker: prediction.ticker,
                    }));
                }
            }

            // Notify subscribers for this ticker
            Object.keys(predictionCache[currentTicker] || {}).forEach(timeframe => {
                const cacheToUse = currentFiveTimesMode ? fiveTimesDataCache : predictionCache;
                predictionCallbacks.forEach(callback =>
                    callback(cacheToUse[currentTicker][timeframe], timeframe, currentTicker)
                );
            });
        }

        console.log('Loaded predictions from database for tickers:', tickersToLoad);

    } catch (error) {
        console.error('Error loading predictions from database:', error);
    }
};

const setupRealtimeSubscription = () => {
    realtimeChannel = supabase
        .channel('predictions_changes')
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'predictions',
            },
            (payload) => {
                handleRealtimeUpdate(payload);
            }
        );

    const channelState = realtimeChannel.state;
    if (channelState !== 'joined' && channelState !== 'joining') {
        realtimeChannel.subscribe((status) => {
            console.log('Realtime subscription status:', status);
        });
    }
};

const handleRealtimeUpdate = (payload: any) => {
    const { eventType, new: newRecord, old: oldRecord } = payload;

    if (eventType === 'INSERT' && newRecord) {
        const prediction: StoredPrediction = newRecord;
        const timeframe = prediction.timeframe;
        const ticker = prediction.ticker || 'BTCUSDT'; // Default to BTCUSDT if no ticker

        // Initialize ticker cache if not exists
        initializeTickerCache(ticker);

        // Only process predictions with non-zero values
        if (prediction.value !== 0 && predictionCache[ticker][timeframe] && fiveTimesDataCache[ticker][timeframe]) {
            // Check if prediction already exists to avoid duplicates
            const exists = predictionCache[ticker][timeframe].some(
                p => p.datetime === prediction.datetime
            );

            if (!exists) {
                const newPrediction = {
                    datetime: prediction.datetime,
                    value: prediction.value,
                    timeframeId: prediction.timeframe,
                    ticker: ticker,
                };

                // Add to both caches
                predictionCache[ticker][timeframe].push(newPrediction);
                fiveTimesDataCache[ticker][timeframe].push(newPrediction);

                // Get the dataLimits for this timeframe (base limits)
                const baseTimeframes = getInitialTimeframes(ticker, false);
                const timeframeConfig = baseTimeframes.find(tf => tf.id === timeframe);
                const normalDataLimit = timeframeConfig?.dataLimit || 1000;

                // Keep only the most recent predictions up to normal limit for normal cache
                if (predictionCache[ticker][timeframe].length > normalDataLimit) {
                    predictionCache[ticker][timeframe] = predictionCache[ticker][timeframe].slice(-normalDataLimit);
                }

                // Notify subscribers with appropriate cache based on current mode
                const cacheToUse = currentFiveTimesMode ? fiveTimesDataCache : predictionCache;
                predictionCallbacks.forEach(callback =>
                    callback(cacheToUse[ticker][timeframe], timeframe, ticker)
                );
            }
        }
    }
};

export const savePrediction = async (
  timeframe: string,
    datetime: string,
    value: number,
    timeframeLabel: string,
    ticker: string // Forcing explicit passing
): Promise<void> => {
    console.log(`💾 savePrediction CALLED with:`, { timeframe, datetime, value, timeframeLabel, ticker });
    
    try {
        // Ensure value is an integer as required by the database schema
        const integerValue = Math.round(value);

        // Don't save predictions with value 0 to the database
        if (integerValue === 0) {
            console.log(`⚠️ Skipping save - value is 0`);
            return;
        }

        console.log(`📤 Calling Supabase upsert for ${ticker} ${timeframe}...`);
        
        const { error } = await supabase
            .from('predictions')
            .upsert(
                {
                    timeframe,
                    datetime,
                    value: integerValue,
                    ticker, // Include ticker in database save
                },
                {
                    onConflict: 'timeframe,datetime,ticker', //Update conflict resolution
                }
            );

        if (error) {
            console.error('❌ Supabase error:', error);
            console.error('Error details:', JSON.stringify(error, null, 2));
            return;
        }

        console.log(`✅ Successfully saved to Supabase: ${ticker} ${timeframe} at ${datetime} with value ${integerValue}`);
        
        // Initialize ticker cache if not exists
        initializeTickerCache(ticker);

        // Update local caches immediately for better UX (only for non-zero values)
        if (predictionCache[ticker][timeframe] && fiveTimesDataCache[ticker][timeframe]) {
            const existingNormalIndex = predictionCache[ticker][timeframe].findIndex(
                p => p.datetime === datetime
            );
            const existingFiveTimesIndex = fiveTimesDataCache[ticker][timeframe].findIndex(
                p => p.datetime === datetime
            );

            const newPrediction = {
                datetime,
                value: integerValue,
                timeframeId: timeframe,
                ticker: ticker
            };

            if (existingNormalIndex >= 0) {
                predictionCache[ticker][timeframe][existingNormalIndex] = newPrediction;
            } else {
                predictionCache[ticker][timeframe].push(newPrediction);

                // Get the normal dataLimit for this timeframe
                const baseTimeframes = getInitialTimeframes('BTCUSDT', false);
                const timeframeConfig = baseTimeframes.find(tf => tf.id === timeframe);
                const normalDataLimit = timeframeConfig?.dataLimit || 1000;

                // Keep only the most recent predictions up to normal dataLimit
                if (predictionCache[ticker][timeframe].length > normalDataLimit) {
                    predictionCache[ticker][timeframe] = predictionCache[ticker][timeframe].slice(-normalDataLimit);
                }
            }

            if (existingFiveTimesIndex >= 0) {
                fiveTimesDataCache[ticker][timeframe][existingFiveTimesIndex] = newPrediction;
            } else {
                fiveTimesDataCache[ticker][timeframe].push(newPrediction);
            }
        }

    } catch (error) {
        console.error('Error saving prediction:', error);
    }
};

export const subscribeToPredictionUpdates = (callback: PredictionCallback) => {
    predictionCallbacks.push(callback);

    // Immediately call with current cached data for all tickers
    Object.keys(predictionCache).forEach(ticker => {
        Object.keys(predictionCache[ticker]).forEach(timeframe => {
            const cacheToUse = currentFiveTimesMode ? fiveTimesDataCache : predictionCache;
            if (cacheToUse[ticker] && cacheToUse[ticker][timeframe].length > 0) {
                callback(cacheToUse[ticker][timeframe], timeframe, ticker);
            }
        });
    });

    return () => {
        const index = predictionCallbacks.indexOf(callback);
        if (index !== -1) {
            predictionCallbacks.splice(index, 1);
        }
    };
};

export const getCurrentPredictions = (timeframeId: string, useFiveTimes: boolean, ticker: string): PredictionEntry[] => {
    const cacheToUse = useFiveTimes ? fiveTimesDataCache : predictionCache;
    return (cacheToUse[ticker] && cacheToUse[ticker][timeframeId]) ? cacheToUse[ticker][timeframeId] : [];
};

// Function to load predictions for a specific ticker
export const loadPredictionsForTicker = async (ticker: string) => {
    await loadPredictionsFromDatabase(currentFiveTimesMode, ticker);
};

// New function to update the 5x mode and reload predictions
export const setSixteenTimesMode = async (fiveTimesMode: boolean) => {
    if (currentFiveTimesMode !== fiveTimesMode) {
        currentFiveTimesMode = fiveTimesMode;

        // Don't reload from database - just notify subscribers to use the other cache
        // Both caches are already populated
        Object.keys(predictionCache).forEach(ticker => {
            Object.keys(predictionCache[ticker]).forEach(timeframe => {
                const cacheToUse = currentFiveTimesMode ? fiveTimesDataCache : predictionCache;
                if (cacheToUse[ticker] && cacheToUse[ticker][timeframe]) {
                    predictionCallbacks.forEach(callback =>
                        callback(cacheToUse[ticker][timeframe], timeframe, ticker)
                    );
                }
            });
        });
    }
};

export const cleanupPredictionService = async () => {
    if (realtimeChannel) {
        await supabase.removeChannel(realtimeChannel);
        realtimeChannel = null;
    }
    isInitialized = false;
    currentFiveTimesMode = false;
};