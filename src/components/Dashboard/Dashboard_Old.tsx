import React, { useEffect, useState, useCallback } from 'react';
import ChartContainer from '../Chart/ChartContainer';
import QuadView from './QuadView';
import { getInitialTimeframes, startKlinePolling, cleanupConnections, fetchKlineData, parseAndValidateTimeframeInput, calculateDataLimit, convertIntervalToMinutes } from '../../api/binanceAPI';
import { setSixteenTimesMode, subscribeToPredictionUpdates } from '../../services/predictionService';
import { CryptoSymbol, TimeframeConfig, PredictionEntry } from '../../types';
import { SUPPORTED_PREDICTION_INTERVALS } from '../../api/sumtymeAPI';
import { Info, X, BarChart3, Search, Settings, Grid3x3 as Grid3X3 } from 'lucide-react';
import { addPollingTicker } from '../../api/sumtymeAPI';
import { loadPredictionsForTicker } from '../../services/predictionService';

// Helper function to get the latest signal change for a timeframe
const getLatestSignalChange = (predictions: PredictionEntry[]): PredictionEntry | null => {
    if (predictions.length === 0) return null;

    // Sort by datetime descending
    const sortedPredictions = [...predictions].sort((a, b) =>
        new Date(b.datetime).getTime() - new Date(a.datetime).getTime()
    );

    // Start from the most recent prediction
    const mostRecent = sortedPredictions[0];
    if (sortedPredictions.length === 1) return mostRecent;

    const mostRecentSignal = mostRecent.value > 0 ? 1 : -1;

    // Find the most recent signal change by going backwards
    for (let i = 1; i < sortedPredictions.length; i++) {
        const currentSignal = sortedPredictions[i].value > 0 ? 1 : -1;
        if (currentSignal !== mostRecentSignal) {
            // Found a change, return the prediction right before this one (which is i-1)
            return sortedPredictions[i - 1];
        }
    }

    // No signal change found, return the oldest prediction (start of current trend)
    return sortedPredictions[sortedPredictions.length - 1];
};

const Dashboard: React.FC = () => {
    const [currentSymbol, setCurrentSymbol] = useState<CryptoSymbol>('BTCUSDT');
    const [tickerInput, setTickerInput] = useState('');
    const [tickerError, setTickerError] = useState('');
    const [isValidatingTicker, setIsValidatingTicker] = useState(false);
    const [showInfoModal, setShowInfoModal] = useState(false);
    const [showHistoricalPerformance, setShowHistoricalPerformance] = useState(false);
    const [isHistoryCooldown, setIsHistoryCooldown] = useState(false);
    const [showQuadView, setShowQuadView] = useState(false);
    const [showAllInsights, setShowAllInsights] = useState(false);

    // User-selected timeframes
    const [userSelectedTimeframes, setUserSelectedTimeframes] = useState<TimeframeConfig[]>(
        getInitialTimeframes(currentSymbol, showHistoricalPerformance)
    );
    const [timeframeInput, setTimeframeInput] = useState('1m, 3m, 5m, 15m');
    const [timeframeInputError, setTimeframeInputError] = useState('');
    const [allPredictionsData, setAllPredictionsData] = useState<Record<string, Record<string, PredictionEntry[]>>>({});
    const [quadViewTickers, setQuadViewTickers] = useState<CryptoSymbol[]>(['BTCUSDT', 'ETHUSDT', 'ADAUSDT', 'SOLUSDT']);

    // Callback for quad view ticker changes
    const handleQuadViewTickersChange = useCallback((tickers: CryptoSymbol[]) => {
        setQuadViewTickers(tickers);
    }, []);

    useEffect(() => {
        startKlinePolling(currentSymbol, userSelectedTimeframes);
        return () => cleanupConnections();
    }, [currentSymbol]);

    useEffect(() => {
        const updatedTimeframes = userSelectedTimeframes.map(tf => {
            // Always calculate from the base, never from current value
            const baseDataLimit = calculateDataLimit(tf.binanceInterval);

            return {
                ...tf,
                dataLimit: showHistoricalPerformance ? baseDataLimit * 4 : baseDataLimit
            };
        });
        setUserSelectedTimeframes(updatedTimeframes);
    }, [showHistoricalPerformance, currentSymbol]);


    // Subscribe to prediction updates at Dashboard level
    useEffect(() => {
        const unsubscribe = subscribeToPredictionUpdates((predictions, timeframeId, ticker) => {
            // Update predictions for any ticker (not just current symbol)
            setAllPredictionsData(prev => ({
                ...prev,
                [ticker]: {
                    ...(prev[ticker] || {}),
                    [timeframeId]: predictions
                }
            }));
        });

        return unsubscribe;
    }, []); // Remove currentSymbol dependency to track all tickers

    // Helper function to get the highest frequency timeframe (smallest convMinuteValue)
    const getHighestFrequencyTimeframe = (): TimeframeConfig => {
        if (userSelectedTimeframes.length === 0) {
            // Default to 1m if no timeframes selected
            return {
                id: '1m',
                label: '1 Minute',
                binanceInterval: '1m',
                wsEndpoint: `${currentSymbol.toLowerCase()}@kline_1m`,
                color: '#919191',
                dataLimit: calculateDataLimit('1m'),
            };
        }

        return userSelectedTimeframes.reduce((highest, current) => {
            const currentMinutes = convertIntervalToMinutes(current.binanceInterval);
            const highestMinutes = convertIntervalToMinutes(highest.binanceInterval);
            return currentMinutes < highestMinutes ? current : highest;
        });
    };

    // Handle timeframe input parsing and validation
    const handleSetTimeframes = () => {
        const trimmedInput = timeframeInput.trim();
        if (!trimmedInput) {
            setTimeframeInputError('Please enter at least one timeframe.');
            return;
        }

        // Parse comma-separated timeframes
        const timeframeStrings = trimmedInput.split(',').map(tf => tf.trim()).filter(tf => tf.length > 0);

        if (timeframeStrings.length === 0) {
            setTimeframeInputError('Please enter at least one valid timeframe.');
            return;
        }

        const validTimeframes: TimeframeConfig[] = [];
        const invalidTimeframes: string[] = [];

        for (const tfString of timeframeStrings) {
            const parseResult = parseAndValidateTimeframeInput(tfString);

            if (parseResult.success && parseResult.binanceInterval && parseResult.label) {
                const dataLimit = calculateDataLimit(parseResult.binanceInterval);
                const finalDataLimit = dataLimit;

                validTimeframes.push({
                    id: parseResult.binanceInterval,
                    label: parseResult.label,
                    binanceInterval: parseResult.binanceInterval,
                    wsEndpoint: `${currentSymbol.toLowerCase()}@kline_${parseResult.binanceInterval}`,
                    color: '#919191',
                    dataLimit: finalDataLimit,
                });
            } else {
                invalidTimeframes.push(tfString);
            }
        }

        if (validTimeframes.length === 0) {
            setTimeframeInputError('No valid timeframes found. Please check your input.');
            return;
        }

        if (invalidTimeframes.length > 0) {
            setTimeframeInputError(`Invalid timeframes: ${invalidTimeframes.join(', ')}`);
            return;
        }

        // Success - update the selected timeframes
        setUserSelectedTimeframes(validTimeframes);
        setTimeframeInputError('');
    };

    const toggleInfoModal = () => {
        setShowInfoModal(prev => !prev);
    };

    const toggleHistoricalPerformance = async () => {
        // Check if cooldown is active
        if (isHistoryCooldown) return;

        // Start cooldown
        setIsHistoryCooldown(true);
        setTimeout(() => {
            setIsHistoryCooldown(false);
        }, 10000); // 10 seconds

        const newValue = !showHistoricalPerformance;
        setShowHistoricalPerformance(newValue);

    };

    const handleTimeframeUpdate = (updatedTimeframe: TimeframeConfig) => {
        setUserSelectedTimeframes(prevTimeframes =>
            prevTimeframes.map(tf =>
                tf.id === updatedTimeframe.id ? updatedTimeframe : tf
            )
        );
    };

    const handleTickerInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setTickerInput(e.target.value.toUpperCase());
        setTickerError('');
    };

    const validateTicker = async (ticker: string): Promise<boolean> => {
        try {
            // Use Binance API directly to validate the ticker
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

    const handleTickerSubmit = async () => {
        const trimmedInput = tickerInput.trim();

        if (!trimmedInput) {
            setTickerError('Please enter a ticker.');
            return;
        }

        setIsValidatingTicker(true);
        setTickerError('');

        try {
            const isValid = await validateTicker(trimmedInput);

            if (!isValid) {
                setTickerError('Invalid ticker. Please try again.');
                return;
            }

            // If successful, update the current symbol
            setCurrentSymbol(trimmedInput);
            // Add new ticker to prediction polling
            addPollingTicker(trimmedInput);

            // Load existing predictions for the new ticker
            await loadPredictionsForTicker(trimmedInput);

            setTickerInput('');
            setTickerError('');

        } catch (error) {
            console.error('Error validating ticker:', error);
            setTickerError('Invalid ticker. Please try again.');
        } finally {
            setIsValidatingTicker(false);
        }
    };

    const handleTickerKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            handleTickerSubmit();
        }
    };

    return (
        <div className="h-screen flex flex-col bg-[#1a1a1a]">
            {/* Header */}
            <div className="flex items-center justify-between bg-[#1a1a1a] border-b border-[#2a2a2a] px-2 py-0.5 md:px-4 md:py-1">
                <div className="flex items-center space-x-2">
                    <button
                        onClick={toggleInfoModal}
                        className="flex items-center space-x-1 px-2 py-1 rounded text-xs font-medium bg-[#2a2a2a] text-[#999] hover:bg-[#3a3a3a] hover:text-white transition-colors"
                    >
                        <Info size={12} />
                        <span>Info</span>
                    </button>

                    <button
                        onClick={toggleHistoricalPerformance}
                        disabled={isHistoryCooldown}
                        className={`flex items-center space-x-1 px-2 py-1 rounded text-xs font-medium transition-colors ${isHistoryCooldown
                                ? 'bg-[#1a1a1a] text-[#666] cursor-not-allowed'
                                : showHistoricalPerformance
                                    ? 'bg-[#2a2a2a] text-[#999] hover:bg-[#3a3a3a] hover:text-white'
                                    : 'bg-[#2a2a2a] text-[#999] hover:bg-[#3a3a3a] hover:text-white'
                            }`}
                    >
                        <BarChart3 size={12} />
                        <span>History</span>
                    </button>

                    <button
                        onClick={() => setShowQuadView(prev => !prev)}
                        className={`flex items-center space-x-1 px-2 py-1 rounded text-xs font-medium transition-colors ${showQuadView
                                ? 'bg-blue-600 text-white hover:bg-blue-700'
                                : 'bg-[#2a2a2a] text-[#999] hover:bg-[#3a3a3a] hover:text-white'
                            }`}
                    >
                        <Grid3X3 size={12} />
                        <span>Quad View</span>
                    </button>

                    <button
                        onClick={() => setShowAllInsights(prev => !prev)}
                        className={`flex items-center space-x-1 px-2 py-1 rounded text-xs font-medium transition-colors ${showAllInsights
                                ? 'bg-purple-600 text-white hover:bg-purple-700'
                                : 'bg-[#2a2a2a] text-[#999] hover:bg-[#3a3a3a] hover:text-white'
                            }`}
                    >
                        <span>See All Insights</span>
                    </button>
                </div>

                {/* Ticker Search and Timeframe Selection */}
                <div className="flex items-center space-x-4">
                    {/* Ticker Search */}
                    <div className="flex flex-col items-end">
                        <div className="flex items-center space-x-1">
                            <div className="relative">
                                <input
                                    type="text"
                                    value={tickerInput}
                                    onChange={handleTickerInputChange}
                                    onKeyDown={handleTickerKeyDown}
                                    placeholder="Enter ticker (e.g. ETHUSDT)"
                                    disabled={isValidatingTicker}
                                    className="bg-[#2a2a2a] text-white text-[0.6rem] px-2 py-1 rounded border border-[#3a3a3a] focus:border-blue-500 focus:outline-none w-32 md:w-40 disabled:opacity-50 disabled:cursor-not-allowed"
                                />
                                {isValidatingTicker && (
                                    <div className="absolute right-2 top-1/2 transform -translate-y-1/2">
                                        <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-500"></div>
                                    </div>
                                )}
                            </div>
                            <button
                                onClick={handleTickerSubmit}
                                disabled={isValidatingTicker || !tickerInput.trim()}
                                className="flex items-center justify-center px-2 py-1 rounded text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <Search size={12} />
                            </button>
                        </div>
                        {tickerError && (
                            <span className="text-red-400 text-[10px] mt-1">{tickerError}</span>
                        )}
                    </div>

                    <div className="text-[#999] text-xs font-medium">
                        {currentSymbol}
                    </div>
                </div>
            </div>

            {/* Info Modal */}
            {showInfoModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg max-w-2xl w-full max-h-[80vh] overflow-y-auto">
                        {/* Modal Header */}
                        <div className="flex items-center justify-between p-4 border-b border-[#2a2a2a]">
                            <h2 className="text-white text-lg font-semibold">Dashboard Information</h2>
                            <button
                                onClick={toggleInfoModal}
                                className="text-[#999] hover:text-white transition-colors"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Modal Content */}
                        <div className="p-6 space-y-4 text-[#ccc] leading-relaxed">
                            <p className="text-white font-medium">
                                This dashboard visualises sumtyme.ai EIP's real-time analysis of market structure across multiple timeframes for any valid crypto ticker.
                            </p>

                            {/* Latest Signal Changes Section */}
                            <div className="pt-4 border-t border-[#2a2a2a]">
                                <h3 className="text-white font-medium mb-3">Latest Signal Changes</h3>
                                <div className="space-y-3">
                                    {showQuadView ? (
                                        // Show all tickers currently in quad view
                                        <>
                                            {quadViewTickers.map((ticker) => (
                                                <div key={ticker} className="border border-[#3a3a3a] rounded p-2">
                                                    <div className="text-white font-medium text-sm mb-2">{ticker}</div>
                                                    <div className="space-y-1">
                                                        {SUPPORTED_PREDICTION_INTERVALS.map(interval => {
                                                            const tickerPredictions = allPredictionsData[ticker]?.[interval] || [];
                                                            const latestChange = getLatestSignalChange(tickerPredictions);

                                                            return (
                                                                <div key={interval} className="flex items-center justify-between bg-[#2a2a2a] p-1.5 rounded">
                                                                    <span className="text-xs font-mono text-white">{interval}</span>
                                                                    {latestChange ? (
                                                                        <div className="flex items-center space-x-2">
                                                                            <span className="text-[10px] text-[#999]">{latestChange.datetime}</span>
                                                                            <div className="flex items-center space-x-1">
                                                                                <span className={`text-xs font-bold ${latestChange.value > 0 ? 'text-green-400' : 'text-red-400'}`}>
                                                                                    {latestChange.value > 0 ? 'Positive' : 'Negative'}
                                                                                </span>
                                                                                <span className={`text-[10px] ${latestChange.value > 0 ? 'text-green-400' : 'text-red-400'}`}>
                                                                                    {Math.abs(latestChange.value)}
                                                                                </span>
                                                                            </div>
                                                                        </div>
                                                                    ) : (
                                                                        <span className="text-[10px] text-[#666]">No predictions</span>
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            ))}
                                        </>
                                    ) : (
                                        // Show only current symbol when in single view
                                        <div className="space-y-2">
                                            {SUPPORTED_PREDICTION_INTERVALS.map(interval => {
                                                const predictions = allPredictionsData[currentSymbol]?.[interval] || [];
                                                const latestChange = getLatestSignalChange(predictions);

                                                return (
                                                    <div key={interval} className="flex items-center justify-between bg-[#2a2a2a] p-2 rounded">
                                                        <span className="text-sm font-mono text-white">{interval}</span>
                                                        {latestChange ? (
                                                            <div className="flex items-center space-x-3">
                                                                <span className="text-xs text-[#999]">{latestChange.datetime}</span>
                                                                <div className="flex items-center space-x-1">
                                                                    <span className={`text-sm font-bold ${latestChange.value > 0 ? 'text-green-400' : 'text-red-400'}`}>
                                                                        {latestChange.value > 0 ? 'Positive' : 'Negative'}
                                                                    </span>
                                                                    <span className={`text-xs ${latestChange.value > 0 ? 'text-green-400' : 'text-red-400'}`}>
                                                                        {Math.abs(latestChange.value)}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <span className="text-xs text-[#666]">No predictions yet</span>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                            <div className="text-[#999] text-xs mt-2">Showing data for: {currentSymbol}</div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="pt-4 border-t border-[#2a2a2a]">
                                <h3 className="text-white font-medium mb-2">Timeframe Selection</h3>
                                <p>
                                    Use the timeframe input field to specify which timeframes you want to track. Enter multiple timeframes separated by commas (e.g., "1m, 5m, 1h").
                                    The chart will display kline data for the highest frequency (shortest) timeframe you select, while prediction dots from all supported timeframes will be overlaid.
                                </p>
                                <p className="text-sm mt-2 text-yellow-400">
                                    <strong>Note:</strong> Prediction dots are only available for 1m, 3m, 5m, and 15m timeframes. Other timeframes will contribute to the selection but won't show prediction dots.
                                </p>
                            </div>

                            <div className="pt-4 border-t border-[#2a2a2a]">
                                <h3 className="text-white font-medium mb-2">Ticker Search</h3>
                                <p>
                                    Use the search bar in the top right to enter any valid trading pair ticker (e.g., ETHUSDT, ADAUSDT, SOLUSDT).
                                    The dashboard will validate the ticker and update all charts to display data for the selected pair.
                                </p>
                            </div>

                            <div className="pt-4 border-t border-[#2a2a2a]">
                                <h3 className="text-white font-medium mb-2">Timeframe Format</h3>
                                <p>
                                    Enter timeframes using the format: <strong>"{'{value}'}{'{unit}'}"</strong>
                                </p>
                                <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
                                    <li><strong>M</strong> for minutes (e.g., "5m" = 5 minutes)</li>
                                    <li><strong>H</strong> for hours (e.g., "1h" = 1 hour)</li>
                                    <li><strong>D</strong> for days (e.g., "1d" = 1 day)</li>
                                    <li><strong>W</strong> for weeks (e.g., "1w" = 1 week)</li>
                                </ul>
                            </div>

                            <p>
                                The green dots represent a positive insight while the red dots represent a negative insight.
                            </p>  <p>
                                The first signal in a consecutive trend marks the start of a trend, while consecutive signals in the same direction indicate the consistency of the identified trend. Combining multiple timeframes allows for earlier anticipation of potential trend starts.
                            </p>
                            <br></br>
                            <a href="https://sumtyme-examples.streamlit.app/" className="text-blue-300 underline">View high frequency examples</a>
                            <div className="pt-4 border-t border-[#2a2a2a]">
                                <p className="text-[#999] text-sm">
                                    Live Demo started 3rd July 2025, 7:45pm. All times are in UTC.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Charts Container */}
            <div className="flex-1 overflow-hidden">
                {showQuadView ? (
                    <QuadView
                        userSelectedTimeframes={userSelectedTimeframes}
                        showHistoricalPerformance={showHistoricalPerformance}
                        onTimeframeUpdate={handleTimeframeUpdate}
                        onTickersChange={handleQuadViewTickersChange}
                        showAllInsights={showAllInsights}
                    />
                ) : (
                    /* Single Chart View */
                    <div className="h-full bg-[#1a1a1a]">
                        <ChartContainer
                            timeframe={getHighestFrequencyTimeframe()}
                            height={window.innerHeight - 32} // Full height minus header
                            symbol={currentSymbol}
                            fixLeftEdge={true}
                            onTimeframeUpdate={handleTimeframeUpdate}
                            showHistoricalPerformance={showHistoricalPerformance}
                            allPredictions={allPredictionsData}
                            showAllInsights={showAllInsights}
                        />
                    </div>
                )}
            </div>
        </div>
    );
};

export default Dashboard;