import React, { useState, useEffect } from 'react';
import ChartContainer from '../Chart/ChartContainer';
import { getInitialTimeframes, convertIntervalToMinutes, calculateDataLimit, startKlinePolling, stopKlinePolling } from '../../api/binanceAPI';
import { subscribeToPredictionUpdates } from '../../services/predictionService';
import { CryptoSymbol, TimeframeConfig, PredictionEntry } from '../../types';
import { addPollingTicker, removePollingTicker } from '../../api/sumtymeAPI';
import { loadPredictionsForTicker } from '../../services/predictionService';
import { Search } from 'lucide-react';

interface QuadViewProps {
    userSelectedTimeframes: TimeframeConfig[];
    onTimeframeUpdate: (updatedTimeframe: TimeframeConfig) => void;
    onTickersChange: (tickers: CryptoSymbol[]) => void;
    showAllInsights: boolean;
    showHistoricalPerformance: boolean;
}

interface ChartState {
    symbol: CryptoSymbol;
    tickerInput: string;
    tickerError: string;
    isValidatingTicker: boolean;
    predictions: Record<string, PredictionEntry[]>;
}

const QuadView: React.FC<QuadViewProps> = ({
    userSelectedTimeframes,
    onTimeframeUpdate,
    onTickersChange,
    showAllInsights,
    showHistoricalPerformance
}) => {
    // State for each of the four charts
    const [charts, setCharts] = useState<ChartState[]>([
        {
            symbol: 'BTCUSDT',
            tickerInput: '',
            tickerError: '',
            isValidatingTicker: false,
            predictions: {}
        },
        {
            symbol: 'ETHUSDT',
            tickerInput: '',
            tickerError: '',
            isValidatingTicker: false,
            predictions: {}
        },
        {
            symbol: 'ADAUSDT',
            tickerInput: '',
            tickerError: '',
            isValidatingTicker: false,
            predictions: {}
        },
        {
            symbol: 'SOLUSDT',
            tickerInput: '',
            tickerError: '',
            isValidatingTicker: false,
            predictions: {}
        }
    ]);

    // Notify parent component whenever tickers change
    useEffect(() => {
        const currentTickers = charts.map(chart => chart.symbol);
        onTickersChange(currentTickers);
    }, [charts, onTickersChange]);

    // Helper function to get the highest frequency timeframe
    const getHighestFrequencyTimeframe = (): TimeframeConfig => {
        if (userSelectedTimeframes.length === 0) {
            const baseDataLimit = calculateDataLimit('1m');
            return {
                id: '1m',
                label: '1 Minute',
                binanceInterval: '1m',
                wsEndpoint: 'btcusdt@kline_1m',
                color: '#919191',
                dataLimit: showHistoricalPerformance ? baseDataLimit * 5 : baseDataLimit,
            };
        }

        return userSelectedTimeframes.reduce((highest, current) => {
            const currentMinutes = convertIntervalToMinutes(current.binanceInterval);
            const highestMinutes = convertIntervalToMinutes(highest.binanceInterval);
            return currentMinutes < highestMinutes ? current : highest;
        });
    };

    // Subscribe to prediction updates for all charts
    useEffect(() => {
        const unsubscribe = subscribeToPredictionUpdates((predictions, timeframeId, ticker) => {
            setCharts(prevCharts =>
                prevCharts.map(chart =>
                    chart.symbol === ticker
                        ? {
                            ...chart,
                            predictions: {
                                ...chart.predictions,
                                [timeframeId]: predictions
                            }
                        }
                        : chart
                )
            );
        });

        return unsubscribe;
    }, []);

    // Load predictions for all initial tickers AND start kline polling for each
    // CRITICAL: In QuadView, we only poll the HIGHEST FREQUENCY timeframe for each symbol
    useEffect(() => {
        const highestFreqTf = getHighestFrequencyTimeframe();
        
        console.log('[QuadView] Initializing charts with highest frequency timeframe:', highestFreqTf.id);
        
        charts.forEach(chart => {
            if (!chart.symbol) return;
            
            console.log(`[QuadView] Starting polling for ${chart.symbol} with ONLY ${highestFreqTf.id}`);
            addPollingTicker(chart.symbol);
            loadPredictionsForTicker(chart.symbol);

            // CRITICAL: Only poll the highest frequency timeframe, not all timeframes
            // This ensures ChartContainer subscription matches exactly
            const singleTimeframe = [{
                ...highestFreqTf,
                wsEndpoint: `${chart.symbol.toLowerCase()}@kline_${highestFreqTf.binanceInterval}`
            }];

            try {
                startKlinePolling(chart.symbol, singleTimeframe);
                console.log(`[QuadView] Started kline polling for ${chart.symbol} with timeframe ${highestFreqTf.id}`);
            } catch (err) {
                console.error(`[QuadView] startKlinePolling error for ${chart.symbol}:`, err);
            }
        });

        // Cleanup function to remove tickers & stop polling when component unmounts
        return () => {
            charts.forEach(chart => {
                if (!chart.symbol) return;
                console.log(`[QuadView] Cleanup: stopping polling for ${chart.symbol}`);
                removePollingTicker(chart.symbol);
                try {
                    stopKlinePolling(chart.symbol);
                } catch (err) {
                    console.error(`[QuadView] stopKlinePolling error for ${chart.symbol}:`, err);
                }
            });
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // run once on mount (initial charts already set)

    // If userSelectedTimeframes changes (e.g., history toggle), re-register the active symbols
    // CRITICAL: Only register the HIGHEST FREQUENCY timeframe
    useEffect(() => {
        const activeSymbols = charts.map(c => c.symbol).filter(Boolean);
        const highestFreqTf = getHighestFrequencyTimeframe();
        
        console.log('[QuadView] Timeframes changed, updating polling with highest frequency:', highestFreqTf.id);
        
        activeSymbols.forEach(symbol => {
            try {
                // Only register the highest frequency timeframe
                const singleTimeframe = [{
                    ...highestFreqTf,
                    wsEndpoint: `${symbol.toLowerCase()}@kline_${highestFreqTf.binanceInterval}`
                }];
                
                startKlinePolling(symbol as CryptoSymbol, singleTimeframe);
                console.log(`[QuadView] Updated ${symbol} to poll ONLY ${highestFreqTf.id}`);
            } catch (err) {
                console.error(`[QuadView] refresh startKlinePolling for ${symbol} failed:`, err);
            }
        });
    }, [userSelectedTimeframes, charts, showHistoricalPerformance]);

    const validateTicker = async (ticker: string): Promise<boolean> => {
        try {
            const response = await fetch(
                `https://api.binance.us/api/v3/klines?symbol=${ticker}&interval=1m&limit=1`
            );

            if (!response.ok) {
                return false;
            }

            const data = await response.json();
            return Array.isArray(data) && data.length > 0;
        } catch (error) {
            console.error('Error validating ticker:', error);
            return false;
        }
    };

    const handleTickerInputChange = (chartIndex: number, value: string) => {
        setCharts(prevCharts =>
            prevCharts.map((chart, index) =>
                index === chartIndex
                    ? { ...chart, tickerInput: value.toUpperCase(), tickerError: '' }
                    : chart
            )
        );
    };

    const handleTickerSubmit = async (chartIndex: number) => {
        const chart = charts[chartIndex];
        const trimmedInput = chart.tickerInput.trim();

        if (!trimmedInput) {
            setCharts(prevCharts =>
                prevCharts.map((c, index) =>
                    index === chartIndex
                        ? { ...c, tickerError: 'Please enter a ticker.' }
                        : c
                )
            );
            return;
        }

        setCharts(prevCharts =>
            prevCharts.map((c, index) =>
                index === chartIndex
                    ? { ...c, isValidatingTicker: true, tickerError: '' }
                    : c
            )
        );

        try {
            const isValid = await validateTicker(trimmedInput);

            if (!isValid) {
                setCharts(prevCharts =>
                    prevCharts.map((c, index) =>
                        index === chartIndex
                            ? { ...c, tickerError: 'Invalid ticker. Please try again.', isValidatingTicker: false }
                            : c
                    )
                );
                return;
            }

            // Update the chart with new symbol
            const oldSymbol = charts[chartIndex].symbol;
            console.log(`[QuadView] Changing ticker from ${oldSymbol} to ${trimmedInput}`);
            
            setCharts(prevCharts =>
                prevCharts.map((c, index) =>
                    index === chartIndex
                        ? {
                            ...c,
                            symbol: trimmedInput,
                            tickerInput: '',
                            tickerError: '',
                            isValidatingTicker: false,
                            predictions: {} // Reset predictions for new ticker
                        }
                        : c
                )
            );

            // Remove old ticker from polling and add new ticker
            if (oldSymbol) {
                console.log(`[QuadView] Removing old ticker ${oldSymbol} from polling`);
                removePollingTicker(oldSymbol);
                try {
                    stopKlinePolling(oldSymbol);
                } catch (err) {
                    console.error(`[QuadView] stopKlinePolling error for ${oldSymbol}:`, err);
                }
            }

            console.log(`[QuadView] Adding new ticker ${trimmedInput} to polling`);
            addPollingTicker(trimmedInput);

            const highestFreqTf = getHighestFrequencyTimeframe();
            
            try {
                // Start polling for the new symbol with ONLY the highest frequency timeframe
                const singleTimeframe = [{
                    ...highestFreqTf,
                    wsEndpoint: `${trimmedInput.toLowerCase()}@kline_${highestFreqTf.binanceInterval}`
                }];
                
                startKlinePolling(trimmedInput as CryptoSymbol, singleTimeframe);
                console.log(`[QuadView] Started kline polling for new ticker ${trimmedInput} with ${highestFreqTf.id}`);
            } catch (err) {
                console.error(`[QuadView] startKlinePolling error for ${trimmedInput}:`, err);
            }

            // Load predictions for the new ticker
            await loadPredictionsForTicker(trimmedInput);

        } catch (error) {
            console.error('Error validating ticker:', error);
            setCharts(prevCharts =>
                prevCharts.map((c, index) =>
                    index === chartIndex
                        ? { ...c, tickerError: 'Invalid ticker. Please try again.', isValidatingTicker: false }
                        : c
                )
            );
        }
    };

    const handleTickerKeyDown = (chartIndex: number, e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            handleTickerSubmit(chartIndex);
        }
    };

    const highestFrequencyTimeframe = getHighestFrequencyTimeframe();

    return (
        <div className="h-full grid grid-cols-2 grid-rows-2 gap-1 bg-[#1a1a1a]">
            {charts.map((chart, index) => (
                <div key={index} className="relative bg-[#1a1a1a] border border-[#2a2a2a] rounded">
                    {/* Chart header with ticker control */}
                    <div className="absolute top-0 left-0 right-0 z-10 bg-[#1a1a1a] border-b border-[#2a2a2a] px-2 py-1 flex items-center justify-between">
                        <div className="text-[#999] text-xs font-medium">
                            {chart.symbol}
                        </div>
                        <div className="flex items-center space-x-1">
                            <input
                                type="text"
                                value={chart.tickerInput}
                                onChange={(e) => handleTickerInputChange(index, e.target.value)}
                                onKeyDown={(e) => handleTickerKeyDown(index, e)}
                                placeholder="Enter ticker"
                                disabled={chart.isValidatingTicker}
                                className="bg-[#2a2a2a] text-white text-[10px] px-1 py-0.5 rounded border border-[#3a3a3a] focus:border-blue-500 focus:outline-none w-20 disabled:opacity-50 disabled:cursor-not-allowed"
                            />
                            <button
                                onClick={() => handleTickerSubmit(index)}
                                disabled={chart.isValidatingTicker || !chart.tickerInput.trim()}
                                className="flex items-center justify-center px-1 py-0.5 rounded text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {chart.isValidatingTicker ? (
                                    <div className="animate-spin rounded-full h-2 w-2 border-b-2 border-white"></div>
                                ) : (
                                    <Search size={10} />
                                )}
                            </button>
                        </div>
                    </div>

                    {/* Error message */}
                    {chart.tickerError && (
                        <div className="absolute top-8 left-2 right-2 z-10 text-red-400 text-[8px] bg-[#1a1a1a] px-1">
                            {chart.tickerError}
                        </div>
                    )}

                    {/* Chart container */}
                    <div className="h-full pt-8">
                        <ChartContainer
                            timeframe={{
                                ...highestFrequencyTimeframe,
                                wsEndpoint: `${chart.symbol.toLowerCase()}@kline_${highestFrequencyTimeframe.binanceInterval}`
                            }}
                            height={(window.innerHeight - 32) / 2 - 20}
                            symbol={chart.symbol}
                            fixLeftEdge={true}
                            onTimeframeUpdate={onTimeframeUpdate}
                            allPredictions={chart.predictions}
                            showAllInsights={showAllInsights}
                            showHistoricalPerformance={showHistoricalPerformance}
                        />
                    </div>
                </div>
            ))}
        </div>
    );
};

export default QuadView;