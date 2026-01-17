import React, { useEffect, useState, useCallback, useMemo } from 'react';
import ChartContainer from '../Chart/ChartContainer';
import QuadView from './QuadView';
import { getInitialTimeframes, startKlinePolling, calculateDataLimit, convertIntervalToMinutes, fetchKlineData, fetchKlineDataForDateRange} from '../../api/binanceAPI';
import { subscribeToPredictionUpdates, setSixteenTimesMode } from '../../services/predictionService';
import { CryptoSymbol, TimeframeConfig, PredictionEntry, CandlestickData } from '../../types';
import { SUPPORTED_PREDICTION_INTERVALS, addPollingTicker } from '../../api/sumtymeAPI';
import { Info, X, Calendar, Search } from 'lucide-react';
import { loadPredictionsForTicker } from '../../services/predictionService';
import { extractTrendIndicators, Propagation, InitialIndicator, getCachedPrice } from '../../utils/indicatorAnalysis';
import { MultiSelect } from '../common/MultiSelect';
import { supabase } from '../../lib/supabase';


// Helper to parse dates consistently
const parseCustomDateTime = (dateStr: string): Date | null => {
    if (!dateStr || dateStr.trim() === '') return null;
    const match = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})$/);
    if (match) {
        const [, year, month, day, hour, minute, second] = match;
        return new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute), parseInt(second)));
    }
    const parsed = new Date(dateStr);
    return isNaN(parsed.getTime()) ? null : parsed;
};


const Dashboard: React.FC = () => {
    const [currentSymbol, setCurrentSymbol] = useState<CryptoSymbol>('BTCUSDT');
    const [showInfoModal, setShowInfoModal] = useState(false);
    const [showQuadView, setShowQuadView] = useState(false);
    const [showAllInsights, setShowAllInsights] = useState(false);
    const [showHistoricalPerformance, setShowHistoricalPerformance] = useState(false);
    
    // --- Date Filter State ---
    const [tempStartDate, setTempStartDate] = useState<string>('');
    const [tempEndDate, setTempEndDate] = useState<string>('');
    const [activeStartDate, setActiveStartDate] = useState<string>('');
    const [activeEndDate, setActiveEndDate] = useState<string>('');
    const [dateError, setDateError] = useState<string>('');

    const [selectedTimeframes, setSelectedTimeframes] = useState<string[]>(SUPPORTED_PREDICTION_INTERVALS);
    const [selectedPropagationLevel, setSelectedPropagationLevel] = useState<number | null>(null);
    
    const [initialIndicatorsPage, setInitialIndicatorsPage] = useState(1);
    const [propagationsPage, setPropagationsPage] = useState(1);
    const itemsPerPage = 30;

    const [isLoadingData, setIsLoadingData] = useState(false);
    const [userSelectedTimeframes, setUserSelectedTimeframes] = useState<TimeframeConfig[]>(() => 
        getInitialTimeframes(currentSymbol, false)
    );
    const [allPredictionsData, setAllPredictionsData] = useState<Record<string, Record<string, PredictionEntry[]>>>({});
    const [quadViewTickers, setQuadViewTickers] = useState<CryptoSymbol[]>(['BTCUSDT', 'ETHUSDT', 'ADAUSDT', 'SOLUSDT']);
    
    const [candlestickData, setCandlestickData] = useState<CandlestickData[]>([]); // ← Add this line
    const [allTimeframeData, setAllTimeframeData] = useState<Record<string, CandlestickData[]>>({});

    const priceFetchCache = React.useRef<Map<string, Promise<number | null>>>(new Map());

    const fetchPriceFromBinance = useCallback(async (ticker: string, datetime: string, timeframe: string): Promise<number | null> => {
        try {
            const targetTime = new Date(datetime.replace(' ', 'T') + 'Z').getTime();
            
            // Fetch a small range of candles around the target time
            const { data, error } = await supabase
                .from('kline_data')
                .select('open, time')
                .eq('symbol', ticker)
                .eq('timeframe', timeframe)
                .gte('time', new Date(targetTime - 5 * 60 * 1000).toISOString())
                .lte('time', new Date(targetTime + 5 * 60 * 1000).toISOString())
                .limit(10);

            if (!error && data && data.length > 0) {
                let closest = data[0];
                let minDiff = Math.abs(new Date(data[0].time).getTime() - targetTime);
                
                for (const candle of data) {
                    const diff = Math.abs(new Date(candle.time).getTime() - targetTime);
                    if (diff < minDiff) {
                        minDiff = diff;
                        closest = candle;
                    }
                }
                
                if (closest.open) return closest.open;
            }

            // If not in database, fetch from Binance API
            console.log(`[Binance Fetch] Fetching price for ${ticker} ${timeframe} at ${datetime}`);
            
            const response = await fetch(
                `https://api.binance.com/api/v3/klines?symbol=${ticker}&interval=${timeframe}&startTime=${targetTime - 60000}&endTime=${targetTime + 60000}&limit=5`
            );
            
            if (!response.ok) {
                console.error('[Binance Fetch] API error:', response.status);
                return null;
            }
            
            const klines = await response.json();
            
            if (!klines || klines.length === 0) {
                console.log('[Binance Fetch] No data returned');
                return null;
            }
            
            let closestKline = klines[0];
            let minTimeDiff = Math.abs(klines[0][0] - targetTime);
            
            for (const kline of klines) {
                const timeDiff = Math.abs(kline[0] - targetTime);
                if (timeDiff < minTimeDiff) {
                    minTimeDiff = timeDiff;
                    closestKline = kline;
                }
            }
            
            const openPrice = parseFloat(closestKline[1]);
            console.log(`[Binance Fetch] Found price: ${openPrice}`);
            
            return openPrice;
            
        } catch (error) {
            console.error('[Binance Fetch] Error:', error);
            return null;
        }
    }, []);

    const getCachedPriceFetch = useCallback(async (ticker: string, datetime: string, timeframe: string): Promise<number | null> => {
        const cacheKey = `${ticker}-${datetime}-${timeframe}`;
        
        if (priceFetchCache.current.has(cacheKey)) {
            return priceFetchCache.current.get(cacheKey)!;
        }
        
        const fetchPromise = fetchPriceFromBinance(ticker, datetime, timeframe);
        priceFetchCache.current.set(cacheKey, fetchPromise);
        
        fetchPromise.then(result => {
            priceFetchCache.current.set(cacheKey, Promise.resolve(result));
        }).catch(() => {
            priceFetchCache.current.delete(cacheKey);
        });
        
        return fetchPromise;
    }, [fetchPriceFromBinance]);

    const handleQuadViewTickersChange = useCallback((tickers: CryptoSymbol[]) => {
        setQuadViewTickers(tickers);
    }, []);

    // Set MIN_ALLOWED_DATE to app deployment start: Jan 13, 2026, 20:30:00 UTC
    const MIN_ALLOWED_DATE = useMemo(() => new Date(Date.UTC(2026, 0, 13, 20, 30, 0)), []);

    // --- Search Handler ---
    const handleDateSearch = () => {
        setDateError('');

        // 1. If trying to clear filters
        if (!tempStartDate && !tempEndDate) {
            setActiveStartDate('');
            setActiveEndDate('');
            return;
        }

        // 2. Validate Start Date if provided
        if (tempStartDate) {
            const parsedStart = parseCustomDateTime(tempStartDate);
            if (!parsedStart) {
                setDateError('Invalid Start Date format');
                return;
            }
            
            // Enforce restriction: No data before deployment
            if (parsedStart < MIN_ALLOWED_DATE) {
                setDateError('Data available from Jan 13, 2026 20:30:00 UTC only.');
                return;
            }
        }

        // 3. Validate End Date format if provided
        if (tempEndDate) {
            const parsedEnd = parseCustomDateTime(tempEndDate);
            if (!parsedEnd) {
                setDateError('Invalid End Date format');
                return;
            }
        }

        // 4. Validate Order (Start must be before End)
        if (tempStartDate && tempEndDate) {
            const parsedStart = parseCustomDateTime(tempStartDate);
            const parsedEnd = parseCustomDateTime(tempEndDate);
            if (parsedStart && parsedEnd && parsedStart > parsedEnd) {
                setDateError('Start Date cannot be after End Date');
                return;
            }
        }

        // Apply filters
        setActiveStartDate(tempStartDate);
        setActiveEndDate(tempEndDate);
    };

    useEffect(() => {
        if (!showQuadView) {
            startKlinePolling(currentSymbol, userSelectedTimeframes);
        }
    }, [currentSymbol, showQuadView, userSelectedTimeframes]);

    useEffect(() => {
        const unsubscribe = subscribeToPredictionUpdates((predictions, timeframeId, ticker) => {
            setAllPredictionsData(prev => ({
                ...prev,
                [ticker]: {
                    ...(prev[ticker] || {}),
                    [timeframeId]: predictions
                }
            }));
        });
        return unsubscribe;
    }, []);

    useEffect(() => {
        setSixteenTimesMode(showHistoricalPerformance);
        setUserSelectedTimeframes(prevTimeframes =>
            prevTimeframes.map(tf => {
                const baseDataLimit = calculateDataLimit(tf.binanceInterval);
                return {
                    ...tf,
                    dataLimit: showHistoricalPerformance ? baseDataLimit * 5 : baseDataLimit
                };
            })
        );
    }, [showHistoricalPerformance]);

    const getHighestFrequencyTimeframe = useMemo((): TimeframeConfig => {
        if (userSelectedTimeframes.length === 0) {
            const baseDataLimit = calculateDataLimit('1m');
            return {
                id: '1m',
                label: '1 Minute',
                binanceInterval: '1m',
                wsEndpoint: `${currentSymbol.toLowerCase()}@kline_1m`,
                color: '#919191',
                dataLimit: showHistoricalPerformance ? baseDataLimit * 5 : baseDataLimit,
            };
        }
        return userSelectedTimeframes.reduce((highest, current) => {
            const currentMinutes = convertIntervalToMinutes(current.binanceInterval);
            const highestMinutes = convertIntervalToMinutes(highest.binanceInterval);
            return currentMinutes < highestMinutes ? current : highest;
        });
    }, [userSelectedTimeframes, currentSymbol, showHistoricalPerformance]);

useEffect(() => {
    const fetchCandlestickData = async () => {
        setIsLoadingData(true);
        try {
            let data: CandlestickData[];
            
            // Check if we have an active date range
            if (activeStartDate || activeEndDate) {
                const start = activeStartDate 
                    ? parseCustomDateTime(activeStartDate) 
                    : new Date(Date.UTC(2026, 0, 13, 20, 30, 0));
                const end = activeEndDate 
                    ? parseCustomDateTime(activeEndDate) 
                    : new Date();
                
                if (start && end) {
                    console.log(`[DASHBOARD] Fetching date range data for analysis`);
                    data = await fetchKlineDataForDateRange(
                        getHighestFrequencyTimeframe, 
                        currentSymbol, 
                        start, 
                        end
                    );
                } else {
                    data = await fetchKlineData(getHighestFrequencyTimeframe, currentSymbol, 0);
                }
            } else {
                data = await fetchKlineData(getHighestFrequencyTimeframe, currentSymbol, 0);
            }
            
            setCandlestickData(data);
                
                // Fetch data for all timeframes to enable price lookups
                const allData: Record<string, CandlestickData[]> = {};
                for (const timeframe of userSelectedTimeframes) {
                    try {
                        const tfData = await fetchKlineData(timeframe, currentSymbol, 0);
                        allData[timeframe.id] = tfData;
                    } catch (error) {
                        console.error(`Error fetching data for ${timeframe.id}:`, error);
                    }
                }
                setAllTimeframeData(allData);
            } catch (error) {
                console.error('Error fetching candlestick data:', error);
            } finally {
                setIsLoadingData(false);
            }
        };
        
        fetchCandlestickData();
    }, [currentSymbol, getHighestFrequencyTimeframe, userSelectedTimeframes, activeStartDate, activeEndDate]);

    const handleTimeframeUpdate = (updatedTimeframe: TimeframeConfig) => {
        setUserSelectedTimeframes(prevTimeframes =>
            prevTimeframes.map(tf => {
                if (tf.id === updatedTimeframe.id) {
                    const baseDataLimit = calculateDataLimit(updatedTimeframe.binanceInterval);
                    return {
                        ...updatedTimeframe,
                        dataLimit: showHistoricalPerformance ? baseDataLimit * 5 : baseDataLimit
                    };
                }
                return tf;
            })
        );
    };

    const { initialIndicators, propagations } = useMemo(() => {
        if (!currentSymbol || !allPredictionsData[currentSymbol]) {
            return { initialIndicators: [], propagations: [], maxPropagationLevel: 0 };
        }
        const tickerPredictions = allPredictionsData[currentSymbol] || {};
        const result = extractTrendIndicators(tickerPredictions, SUPPORTED_PREDICTION_INTERVALS, candlestickData);
        
        const maxLevel = result.propagations.reduce((max, prop) => Math.max(max, prop.propagation_level), 0);
        return {
            initialIndicators: result.initialIndicators,
            propagations: result.propagations,
            maxPropagationLevel: maxLevel
        };
    }, [currentSymbol, allPredictionsData, candlestickData]);

    const { displayInitialIndicators, displayPropagations } = useMemo(() => {
        let filteredInits = initialIndicators;
        let filteredProps = propagations;

        if (selectedPropagationLevel !== null && propagations.length > 0) {
            const propagationIdToMaxLevel = new Map<string, number>();
            propagations.forEach(prop => {
                const currentMax = propagationIdToMaxLevel.get(prop.propagation_id) || 0;
                if (prop.propagation_level > currentMax) {
                    propagationIdToMaxLevel.set(prop.propagation_id, prop.propagation_level);
                }
            });

            const filteredPropagationIds = Array.from(propagationIdToMaxLevel.entries())
                .filter(([_, maxLevel]) => maxLevel >= selectedPropagationLevel)
                .map(([id]) => id);
            
            const filteredPropagationSet = new Set(filteredPropagationIds);

            filteredProps = propagations.filter(prop => filteredPropagationSet.has(prop.propagation_id));
            filteredInits = initialIndicators.filter(ind => {
                const chainIndex = initialIndicators.indexOf(ind);
                const propId = `Chain_${chainIndex + 1}`;
                return filteredPropagationSet.has(propId);
            });
        }

        // Use active* states for filtering
        if (activeStartDate || activeEndDate) {
            const start = activeStartDate ? (parseCustomDateTime(activeStartDate) || new Date(0)) : new Date(0);
            const end = activeEndDate ? (parseCustomDateTime(activeEndDate) || new Date(8640000000000000)) : new Date(8640000000000000);

            filteredInits = filteredInits.filter(ind => {
                const indDate = new Date(ind.datetime.replace(' ', 'T') + 'Z');
                return indDate >= start && indDate <= end;
            });
            filteredProps = filteredProps.filter(prop => {
                const propDate = new Date(prop.datetime.replace(' ', 'T') + 'Z');
                return propDate >= start && propDate <= end;
            });
        }

        if (selectedTimeframes && selectedTimeframes.length > 0) {
            const timeframeSet = new Set(selectedTimeframes);
            filteredProps = filteredProps.filter(prop => timeframeSet.has(prop.higher_freq) && timeframeSet.has(prop.lower_freq));
            filteredInits = filteredInits.filter(ind => timeframeSet.has(ind.timeframe));
        }

        return { displayInitialIndicators: filteredInits, displayPropagations: filteredProps };
    }, [initialIndicators, propagations, selectedTimeframes, selectedPropagationLevel, activeStartDate, activeEndDate]);
    const calculateDirectionalChange = useCallback(async (prop: Propagation, fullInitialList: InitialIndicator[]) => {
    if (prop.directional_change_percent !== undefined && prop.directional_change_percent !== 0) {
        return prop.directional_change_percent;
    }
    
    try {
        const parts = prop.propagation_id.split('_');
        if (parts.length < 2) return null;
        
        const index = parseInt(parts[1], 10) - 1;
        const startNode = fullInitialList[index];
        if (!startNode) return null;
        
        let startPrice = startNode.open_price;
        if (!startPrice || startPrice === 0) {
            startPrice = await getCachedPriceFetch(currentSymbol, startNode.datetime, startNode.timeframe);
        }
        if (!startPrice || startPrice === 0) return null;
        
        let propPrice = prop.open_price;
        if (!propPrice || propPrice === 0) {
            propPrice = await getCachedPriceFetch(currentSymbol, prop.datetime, prop.lower_freq);
        }
        if (!propPrice || propPrice === 0) return null;

        const change = ((propPrice - startPrice) / startPrice) * 100;
        return change;
    } catch (e) {
        console.error('Error calculating directional change:', e);
        return null;
    }
}, [currentSymbol, getCachedPriceFetch]);
    const PropagationRow: React.FC<{
        prop: Propagation;
        initialIndicators: InitialIndicator[];
        calculateDirectionalChange: (prop: Propagation, initialIndicators: InitialIndicator[]) => Promise<number | null>;
        candlestickData: CandlestickData[];
        allTimeframeData: Record<string, CandlestickData[]>;
        currentSymbol: string;
        getCachedPriceFetch: (ticker: string, datetime: string, timeframe: string) => Promise<number | null>;
    }> = ({ prop, initialIndicators, calculateDirectionalChange, candlestickData, allTimeframeData, currentSymbol, getCachedPriceFetch }) => {
        const [dirChange, setDirChange] = React.useState<number | null>(null);
        const [isCalculating, setIsCalculating] = React.useState(true);

        React.useEffect(() => {
            const calculate = async () => {
                setIsCalculating(true);
                const change = await calculateDirectionalChange(prop, initialIndicators);
                setDirChange(change);
                setIsCalculating(false);
            };
            calculate();
        }, [prop, initialIndicators, calculateDirectionalChange]);

        return (
            <tr className="hover:bg-[#252525]">
                <td className="border border-[#3a3a3a] px-2 py-1 text-white">{prop.propagation_id}</td>
                <td className="border border-[#3a3a3a] px-2 py-1 text-white">{prop.propagation_level}</td>
                <td className="border border-[#3a3a3a] px-2 py-1 font-mono text-white">{prop.datetime}</td>
                <td className="border border-[#3a3a3a] px-2 py-1">
                    <span className={prop.trend_type > 0 ? 'text-green-500' : 'text-red-500'}>
                        {prop.trend_type > 0 ? '↑' : '↓'} {prop.trend_type}
                    </span>
                </td>
                <td className="border border-[#3a3a3a] px-2 py-1 text-white">{prop.higher_freq}</td>
                <td className="border border-[#3a3a3a] px-2 py-1 text-white">{prop.lower_freq}</td>
                <td className="border border-[#3a3a3a] px-2 py-1 text-white">
                    <PriceCell 
                        price={prop.open_price} 
                        datetime={prop.datetime}
                        timeframe={prop.lower_freq}
                        candlestickData={candlestickData}
                        allTimeframeData={allTimeframeData}
                        ticker={currentSymbol}
                        getCachedPriceFetch={getCachedPriceFetch}
                    />
                </td>
                <td className="border border-[#3a3a3a] px-2 py-1 font-mono">
                    {isCalculating ? (
                        <span className="text-yellow-400 text-xs">...</span>
                    ) : dirChange !== null ? (
                        <span className={dirChange >= 0 ? 'text-green-500' : 'text-red-500'}>
                            {dirChange > 0 ? '+' : ''}{dirChange.toFixed(2)}%
                        </span>
                    ) : (
                        <span className="text-[#666]">-</span>
                    )}
                </td>
            </tr>
        );
    };

    return (
        <div className="h-screen flex flex-col bg-[#1a1a1a]">
        {/* Header */}
        <div className="flex items-center justify-between bg-[#1a1a1a] border-b border-[#2a2a2a] px-2 py-0.5 md:px-4 md:py-1">
            <div className="flex items-center space-x-2">
                <button onClick={() => setShowInfoModal(true)} className="flex items-center space-x-1 px-2 py-1 rounded text-xs font-medium bg-[#2a2a2a] text-[#999] hover:bg-[#3a3a3a] hover:text-white transition-colors">
                    <Info size={12} /><span>Info</span>
                </button>
                {isLoadingData && (
                    <div className="flex items-center space-x-1 text-xs text-blue-400">
                        <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-400"></div>
                        <span>Loading...</span>
                    </div>
                )}
            </div>
            <div className="flex items-center space-x-4">
                <div className="text-[#999] text-xs font-medium">{currentSymbol}</div>
            </div>
        </div>

            {/* Info Modal */}
            {showInfoModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg max-w-6xl w-full max-h-[80vh] overflow-y-auto">
                        <div className="flex items-center justify-between p-4 border-b border-[#2a2a2a]">
                            <h2 className="text-white text-lg font-semibold">Market Structure Visualisation Tool</h2>
                            <button onClick={() => setShowInfoModal(false)}><X size={20} className="text-[#999] hover:text-white" /></button>
                        </div>
                        <div className="p-6 space-y-4 text-[#ccc] leading-relaxed">
                            <p className="text-white font-medium">
                                This shows sumtyme.ai's real-time analysis of BTCUSDT's market structure.
                            </p>
                            <p className="text-white font-small">
Our technology operates on the assumption that all directional changes start from the shortest observable timescale and propagate to longer timescales as it continues.</p>
<p className="text-white font-small">For this live demonstration, we have selected the following timescales to illustrate how non-linear change can be tracked in real time with our technology.</p>
<p className='text-white font-small'>1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 8h, 12h, and 1d.</p>
<p className="text-white text-sm">Note that we are not using the shortest observable timescales for simplicity.</p>
<p className='text-white font-small'>
  Visit <a className="text-white font-small underline" href="https://www.sumtyme.ai">our website</a> to learn more about our approach and sign up for free API credits.</p>
                            <div className="pt-4 border-t border-[#2a2a2a]">
                                <p className="text-sm">
                                    This deployment displays live market data from api.binance.com starting from <strong>January 13, 2026 20:30:00 GMT.</strong>
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Main Content */}
            <div className="flex-1 overflow-hidden flex flex-col">
                {showQuadView ? (
                    <QuadView 
                        userSelectedTimeframes={userSelectedTimeframes} 
                        onTimeframeUpdate={handleTimeframeUpdate} 
                        onTickersChange={handleQuadViewTickersChange} 
                        showAllInsights={showAllInsights} 
                        showHistoricalPerformance={showHistoricalPerformance} 
                    />
                ) : (
                    <>
                        <div className="flex-1 bg-[#1a1a1a]">
                            <ChartContainer
                                timeframe={getHighestFrequencyTimeframe}
                                height={window.innerHeight - 32}
                                symbol={currentSymbol}
                                fixLeftEdge={true}
                                onTimeframeUpdate={handleTimeframeUpdate}
                                allPredictions={allPredictionsData}
                                showAllInsights={showAllInsights}
                                showHistoricalPerformance={showHistoricalPerformance}
                                propagations={propagations}
                                initialIndicators={initialIndicators}
                                selectedPropagationLevel={selectedPropagationLevel}
                                startDate={activeStartDate}
                                endDate={activeEndDate}
                                selectedTimeframes={selectedTimeframes}
                            />
                        </div>

                        {/* Control Panel / Tables */}
                        <div className="bg-[#1a1a1a] border-t border-[#2a2a2a] p-4 max-h-[40vh] overflow-y-auto">
                            <div className="mb-4 flex flex-col lg:flex-row flex-wrap gap-4 items-start">
                                {/* Date Range Inputs */}
                                <div className="flex flex-col gap-1">
                                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
                                        <div className="flex items-center space-x-2">
                                            <Calendar size={14} className="text-[#919191]" />
                                            <label className="text-white text-xs font-medium whitespace-nowrap">Datetime Range:</label>
                                        </div>
                                        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 w-full sm:w-auto">
                                            <input
                                                type="text"
                                                value={tempStartDate}
                                                onChange={(e) => setTempStartDate(e.target.value)}
                                                className="px-2 py-1 text-xs bg-[#3a3a3a] text-[#919191] border border-[#4a4a4a] rounded focus:outline-none focus:border-[#5a5a5a] font-mono w-full sm:w-auto"
                                                placeholder="YYYY-MM-DD HH:MM:SS"
                                            />
                                            <span className="text-white text-xs hidden sm:inline">to</span>
                                            <input
                                                type="text"
                                                value={tempEndDate}
                                                onChange={(e) => setTempEndDate(e.target.value)}
                                                className="px-2 py-1 text-xs bg-[#3a3a3a] text-[#919191] border border-[#4a4a4a] rounded focus:outline-none focus:border-[#5a5a5a] font-mono w-full sm:w-auto"
                                                placeholder="YYYY-MM-DD HH:MM:SS"
                                            />
                                            <button 
                                                onClick={handleDateSearch}
                                                className="flex items-center space-x-1 px-3 py-1 text-xs bg-[#2a2a2a] text-white border border-[#4a4a4a] rounded hover:bg-[#3a3a3a] transition-colors"
                                            >
                                                <Search size={10} />
                                                <span>Search</span>
                                            </button>
                                        </div>
                                    </div>
                                    {dateError && (
                                        <span className="text-red-500 text-xs ml-0 sm:ml-24">{dateError}</span>
                                    )}
                                </div>

                                {/* Timeframe Filter */}
                                {/* <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
                                    <label className="text-white text-xs font-medium whitespace-nowrap">Timeframes:</label>
                                    <MultiSelect
                                        options={SUPPORTED_PREDICTION_INTERVALS}
                                        value={selectedTimeframes}
                                        onChange={setSelectedTimeframes}
                                        placeholder="Select timeframes"
                                    />
                                </div> */}
                            </div>

                            {/* Initial Indicators Table */}
                            <div className="mb-6">
                                <div className="flex items-center justify-between mb-3">
                                    <h3 className="text-white font-medium text-sm">Initial Indicators</h3>
                                    {displayInitialIndicators.length > itemsPerPage && (
                                        <div className="flex items-center gap-2">
                                            <button onClick={() => setInitialIndicatorsPage(p => Math.max(1, p - 1))} disabled={initialIndicatorsPage === 1} className="px-2 py-1 text-xs bg-[#2a2a2a] text-white rounded hover:bg-[#3a3a3a] disabled:opacity-50">Previous</button>
                                            <span className="text-xs text-[#999]">Page {initialIndicatorsPage} of {Math.ceil(displayInitialIndicators.length / itemsPerPage)}</span>
                                            <button onClick={() => setInitialIndicatorsPage(p => Math.min(Math.ceil(displayInitialIndicators.length / itemsPerPage), p + 1))} disabled={initialIndicatorsPage >= Math.ceil(displayInitialIndicators.length / itemsPerPage)} className="px-2 py-1 text-xs bg-[#2a2a2a] text-white rounded hover:bg-[#3a3a3a] disabled:opacity-50">Next</button>
                                        </div>
                                    )}
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-xs border-collapse">
                                        <thead>
                                            <tr className="bg-[#2a2a2a]">
                                                <th className="border border-[#3a3a3a] px-2 py-1 text-left text-white font-medium">Datetime</th>
                                                <th className="border border-[#3a3a3a] px-2 py-1 text-left text-white font-medium">Value</th>
                                                <th className="border border-[#3a3a3a] px-2 py-1 text-left text-white font-medium">Timeframe</th>
                                                <th className="border border-[#3a3a3a] px-2 py-1 text-left text-white font-medium">Open Price</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {displayInitialIndicators.length > 0 ? (
                                                displayInitialIndicators
                                                    .slice((initialIndicatorsPage - 1) * itemsPerPage, initialIndicatorsPage * itemsPerPage)
                                                    .map((ind, idx) => (
                                                        <tr key={idx} className="hover:bg-[#252525]">
                                                            <td className="border border-[#3a3a3a] px-2 py-1 font-mono text-white">{ind.datetime}</td>
                                                            <td className="border border-[#3a3a3a] px-2 py-1"><span className={ind.trend_type > 0 ? 'text-green-500' : 'text-red-500'}>{ind.trend_type > 0 ? '↑' : '↓'} {ind.trend_type}</span></td>
                                                            <td className="border border-[#3a3a3a] px-2 py-1 text-white">{ind.timeframe}</td>
                                                            <td className="border border-[#3a3a3a] px-2 py-1 text-white">
                                                                <PriceCell 
                                                                    price={ind.open_price} 
                                                                    datetime={ind.datetime}
                                                                    timeframe={ind.timeframe}
                                                                    candlestickData={candlestickData}
                                                                    allTimeframeData={allTimeframeData}
                                                                    ticker={currentSymbol}
                                                                    getCachedPriceFetch={getCachedPriceFetch}
                                                                />
                                                            </td>
                                                        </tr>
                                                    ))
                                            ) : (
                                                <tr><td colSpan={4} className="border border-[#3a3a3a] px-2 py-3 text-center text-[#666]">No initial indicators found</td></tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* Propagations Table */}
                            <div>
                                <div className="flex items-center justify-between mb-3">
                                    <h3 className="text-white font-medium text-sm">Propagations</h3>
                                    {displayPropagations.length > itemsPerPage && (
                                        <div className="flex items-center gap-2">
                                            <button onClick={() => setPropagationsPage(p => Math.max(1, p - 1))} disabled={propagationsPage === 1} className="px-2 py-1 text-xs bg-[#2a2a2a] text-white rounded hover:bg-[#3a3a3a] disabled:opacity-50">Previous</button>
                                            <span className="text-xs text-[#999]">Page {propagationsPage} of {Math.ceil(displayPropagations.length / itemsPerPage)}</span>
                                            <button onClick={() => setPropagationsPage(p => Math.min(Math.ceil(displayPropagations.length / itemsPerPage), p + 1))} disabled={propagationsPage >= Math.ceil(displayPropagations.length / itemsPerPage)} className="px-2 py-1 text-xs bg-[#2a2a2a] text-white rounded hover:bg-[#3a3a3a] disabled:opacity-50">Next</button>
                                        </div>
                                    )}
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-xs border-collapse">
                                        <thead>
                                            <tr className="bg-[#2a2a2a]">
                                                <th className="border border-[#3a3a3a] px-2 py-1 text-left text-white font-medium">Prop ID</th>
                                                <th className="border border-[#3a3a3a] px-2 py-1 text-left text-white font-medium">Level</th>
                                                <th className="border border-[#3a3a3a] px-2 py-1 text-left text-white font-medium">Datetime</th>
                                                <th className="border border-[#3a3a3a] px-2 py-1 text-left text-white font-medium">Value</th>
                                                <th className="border border-[#3a3a3a] px-2 py-1 text-left text-white font-medium">Higher Freq</th>
                                                <th className="border border-[#3a3a3a] px-2 py-1 text-left text-white font-medium">Lower Freq</th>
                                                <th className="border border-[#3a3a3a] px-2 py-1 text-left text-white font-medium">Open Price</th>
                                                <th className="border border-[#3a3a3a] px-2 py-1 text-left text-white font-medium">Directional Change</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {displayPropagations.length > 0 ? (
                                                displayPropagations
                                                    .slice((propagationsPage - 1) * itemsPerPage, propagationsPage * itemsPerPage)
                                                    .map((prop, idx) => {
                                                        return (
                                                            <PropagationRow 
                                                                key={idx} 
                                                                prop={prop} 
                                                                initialIndicators={initialIndicators}
                                                                calculateDirectionalChange={calculateDirectionalChange}
                                                                candlestickData={candlestickData}
                                                                allTimeframeData={allTimeframeData}
                                                                currentSymbol={currentSymbol}
                                                                getCachedPriceFetch={getCachedPriceFetch}
                                                            />
                                                        );
                                                    })
                                            ) : (
                                                <tr><td colSpan={8} className="border border-[#3a3a3a] px-2 py-3 text-center text-[#666]">No propagations found</td></tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

const PriceCell: React.FC<{
    price: number;
    datetime?: string;
    timeframe?: string;
    candlestickData?: CandlestickData[];
    allTimeframeData?: Record<string, CandlestickData[]>;
    ticker?: string;
    getCachedPriceFetch: (ticker: string, datetime: string, timeframe: string) => Promise<number | null>;
}> = ({ price, datetime, timeframe, candlestickData, allTimeframeData, ticker = 'BTCUSDT', getCachedPriceFetch }) => {
    const [displayPrice, setDisplayPrice] = React.useState<number | null>(null);
    const [isFetching, setIsFetching] = React.useState(false);

    React.useEffect(() => {
        const findPrice = async () => {
            // First: Use the provided price if it's valid
            if (price && price !== 0) {
                setDisplayPrice(price);
                return;
            }
            
            // Second: Check local candlestick data for this specific timeframe
            if (datetime && timeframe && allTimeframeData && allTimeframeData[timeframe]) {
                const targetTime = new Date(datetime.replace(' ', 'T') + 'Z').getTime() / 1000;
                const timeframeData = allTimeframeData[timeframe];
                
                // Find exact match
                const exactMatch = timeframeData.find(candle => candle.time === targetTime);
                if (exactMatch && exactMatch.open) {
                    setDisplayPrice(exactMatch.open);
                    return;
                }
                
                // Find closest candle within tolerance
                const timeframeMinutes = convertIntervalToMinutes(timeframe);
                const tolerance = Math.max(5 * 60, timeframeMinutes * 60);
                const closest = timeframeData.find(candle => 
                    Math.abs(candle.time - targetTime) < tolerance && candle.open > 0
                );
                
                if (closest && closest.open) {
                    setDisplayPrice(closest.open);
                    return;
                }
            }
            
            // Third: Check highest frequency candlestick data as fallback
            if (datetime && candlestickData && candlestickData.length > 0) {
                const targetTime = new Date(datetime.replace(' ', 'T') + 'Z').getTime() / 1000;
                
                const exactMatch = candlestickData.find(candle => candle.time === targetTime);
                if (exactMatch && exactMatch.open) {
                    setDisplayPrice(exactMatch.open);
                    return;
                }
                
                const fiveMinutes = 5 * 60;
                const closest = candlestickData.find(candle => 
                    Math.abs(candle.time - targetTime) < fiveMinutes && candle.open > 0
                );
                
                if (closest && closest.open) {
                    setDisplayPrice(closest.open);
                    return;
                }
            }
            
            // Fourth: Fetch from database or Binance (using cache)
            if (datetime && timeframe && ticker) {
                setIsFetching(true);
                try {
                    const fetchedPrice = await getCachedPriceFetch(ticker, datetime, timeframe);
                    if (fetchedPrice !== null && fetchedPrice !== 0) {
                        setDisplayPrice(fetchedPrice);
                        return;
                    }
                } finally {
                    setIsFetching(false);
                }
            }
            
            // No price found
            setDisplayPrice(null);
        };

        findPrice();
    }, [price, datetime, timeframe, candlestickData, allTimeframeData, ticker]);

    if (isFetching) {
        return <span className="text-yellow-400 text-xs">...</span>;
    }

    if (displayPrice !== null && displayPrice !== 0) {
        return <span>{displayPrice.toFixed(2)}</span>;
    }
    
    return <span className="text-gray-500">N/A</span>;
};

export default Dashboard;
