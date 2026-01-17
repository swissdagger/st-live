import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, IChartApi, ISeriesApi } from 'lightweight-charts';
import { CandlestickData, ChartContainerProps, PredictionEntry, ArrowPosition } from '../../types';
import { fetchKlineData, subscribeToUpdates, getCurrentData, parseAndValidateTimeframeInput, calculateDataLimit,fetchKlineDataForDateRange } from '../../api/binanceAPI';
import { subscribeToPredictionUpdates, getCurrentPredictions, subscribeToViewUpdates, SUPPORTED_PREDICTION_INTERVALS } from '../../api/sumtymeAPI';
import { getPredictionsToDisplay, organizePredictionsByTicker } from '../../utils/propagationTracker';
import PredictionArrow from './PredictionArrow';

// Helper: Format unix timestamp to string
const formatDateTime = (timestamp: number): string => {
    const date = new Date(timestamp * 1000);
    return date.toISOString().slice(0, 19).replace('T', ' ');
};

// Helper: Parse string date to unix timestamp
const parseDateTime = (datetime: string): number => {
    return Math.floor(new Date(datetime.replace(' ', 'T') + 'Z').getTime() / 1000);
};

// Helper: Parse date string allowing for custom format
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

// Helper: Align timestamp to specific interval
const getAlignedTimestamp = (timestamp: number, interval: string): number => {
    if (!timestamp || timestamp <= 0 || !isFinite(timestamp)) return Math.floor(Date.now() / 1000);
    if (!interval || typeof interval !== 'string' || interval.length < 2) return timestamp;

    const date = new Date(timestamp * 1000);
    if (isNaN(date.getTime())) return Math.floor(Date.now() / 1000);

    const intervalValue = parseInt(interval.slice(0, -1), 10);
    const intervalUnit = interval.slice(-1).toLowerCase();

    if (isNaN(intervalValue) || intervalValue <= 0) return timestamp;

    try {
        switch (intervalUnit) {
            case 's':
                date.setUTCSeconds(Math.floor(date.getUTCSeconds() / intervalValue) * intervalValue, 0);
                break;
            case 'm':
                date.setUTCMinutes(Math.floor(date.getUTCMinutes() / intervalValue) * intervalValue, 0, 0);
                break;
            case 'h':
                date.setUTCHours(Math.floor(date.getUTCHours() / intervalValue) * intervalValue, 0, 0, 0);
                break;
            case 'd':
                date.setUTCHours(0, 0, 0, 0);
                break;
            default:
                return timestamp;
        }
        return Math.floor(date.getTime() / 1000);
    } catch (error) {
        console.error('Error in getAlignedTimestamp:', error);
        return timestamp;
    }
};

// REMOVED: fetchRangeData function. We now rely solely on standard app data.

const ChartContainer: React.FC<ChartContainerProps> = ({
    timeframe,
    height,
    symbol,
    fixLeftEdge = true,
    onTimeframeUpdate,
    showAllInsights = false,
    showHistoricalPerformance = false,
    allPredictions = {},
    startDate,
    endDate,
    selectedTimeframes
}) => {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const overlayContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);
    const [currentData, setCurrentData] = useState<CandlestickData[]>([]);
    const [lastPrice, setLastPrice] = useState<CandlestickData | null>(null);
    const [predictions, setPredictions] = useState<PredictionEntry[]>([]);
    const [chartDimensions, setChartDimensions] = useState({ width: 0, height: 0 });
    const [viewUpdateTrigger, setViewUpdateTrigger] = useState(0);
    const [arrowPositions, setArrowPositions] = useState<ArrowPosition[]>([]);
    const [isMobile, setIsMobile] = useState(false);
    
    // Timeframe input state
    const [timeframeInputValue, setTimeframeInputValue] = useState('');
    const [timeframeInputError, setTimeframeInputError] = useState('');
    const [isEditingTimeframe, setIsEditingTimeframe] = useState(false);
    
    const prevHistoryModeRef = useRef<boolean>(showHistoricalPerformance);
    const isTransitioningRef = useRef<boolean>(false);

    const filterKlinesByDateRange = useCallback((klines: CandlestickData[]): CandlestickData[] => {
        if (!startDate && !endDate) return klines;

        const start = startDate ? (parseCustomDateTime(startDate) || new Date(0)) : new Date(0);
        const end = endDate ? (parseCustomDateTime(endDate) || new Date(8640000000000000)) : new Date(8640000000000000);

        const startTime = start.getTime();
        const endTime = end.getTime();

        return klines.filter(kline => {
            const klineTime = kline.time * 1000;
            return klineTime >= startTime && klineTime <= endTime;
        });
    }, [startDate, endDate]);

    useEffect(() => {
        const label = timeframe.label;
        if (label.includes('Minute')) setTimeframeInputValue(`${label.replace(/ Minutes?/, '')} M`);
        else if (label.includes('Hour')) setTimeframeInputValue(`${label.replace(/ Hours?/, '')} H`);
        else if (label.includes('Day')) setTimeframeInputValue(`${label.replace(/ Days?/, '')} D`);
        else if (label.includes('Week')) setTimeframeInputValue(`${label.replace(/ Weeks?/, '')} W`);
        else setTimeframeInputValue(label);
    }, [timeframe.label]);

    useEffect(() => {
        const checkMobile = () => setIsMobile(window.innerWidth < 500);
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    const handleTimeframeInputSubmit = () => {
        if (!onTimeframeUpdate) return;
        const parseResult = parseAndValidateTimeframeInput(timeframeInputValue);
        if (!parseResult.success) {
            setTimeframeInputError(parseResult.error || 'Invalid input');
            return;
        }
        if (parseResult.binanceInterval === timeframe.binanceInterval) {
            setIsEditingTimeframe(false);
            setTimeframeInputError('');
            return;
        }
        const newDataLimit = calculateDataLimit(parseResult.binanceInterval!);
        const updatedTimeframe = {
            ...timeframe,
            binanceInterval: parseResult.binanceInterval!,
            label: parseResult.label!,
            wsEndpoint: `${symbol.toLowerCase()}@kline_${parseResult.binanceInterval}`,
            dataLimit: newDataLimit,
        };
        onTimeframeUpdate(updatedTimeframe);
        setIsEditingTimeframe(false);
    };

    const calculateArrowPositions = useCallback((): ArrowPosition[] => {
        if (!chartRef.current || !seriesRef.current || !chartContainerRef.current || currentData.length === 0) return [];

        const totalWidth = chartContainerRef.current.clientWidth;
        const rightPriceScale = chartRef.current.priceScale('right');
        const priceScaleWidth = rightPriceScale.width();
        const maxX = totalWidth - priceScaleWidth - 9;

        const organizedPredictions = organizePredictionsByTicker(predictions);
        const tickerPredictions = organizedPredictions[symbol] || {};
        
        let predictionsToShow = getPredictionsToDisplay(tickerPredictions, symbol, showAllInsights);

        if (startDate || endDate) {
            const start = startDate ? (parseCustomDateTime(startDate) || new Date(0)) : new Date(0);
            const end = endDate ? (parseCustomDateTime(endDate) || new Date(8640000000000000)) : new Date(8640000000000000);
            
            predictionsToShow = predictionsToShow.filter(pred => {
                const predDate = new Date(pred.datetime.replace(' ', 'T') + 'Z');
                return predDate >= start && predDate <= end;
            });
        }
        
        if (selectedTimeframes && selectedTimeframes.length > 0) {
            const timeframeSet = new Set(selectedTimeframes);
            predictionsToShow = predictionsToShow.filter(pred => timeframeSet.has(pred.timeframeId));
        }

        const arrowPositions: ArrowPosition[] = [];

        predictionsToShow.forEach(prediction => {
            const timestamp = parseDateTime(prediction.datetime);
            const alignedTimestamp = getAlignedTimestamp(timestamp, timeframe.binanceInterval);
            
            const candlestick = currentData.find(d => d.time === alignedTimestamp);
            if (!candlestick) return;

            const coordinate = seriesRef.current!.priceToCoordinate(candlestick.open);
            const timeScale = chartRef.current!.timeScale();
            const timeCoordinate = timeScale.timeToCoordinate(alignedTimestamp);

            if (coordinate === null || timeCoordinate === null) return;
            if (timeCoordinate >= maxX || timeCoordinate < 0) return;

            arrowPositions.push({
                x: timeCoordinate,
                y: coordinate,
                value: prediction.value,
                datetime: prediction.datetime,
                timeframeId: prediction.timeframeId,
                ticker: prediction.ticker,
                isChangeEnding: false
            });
        });

        return arrowPositions;
    }, [predictions, currentData, showAllInsights, symbol, timeframe.binanceInterval, startDate, endDate, selectedTimeframes]);

    useEffect(() => {
        const newArrowPositions = calculateArrowPositions();
        setArrowPositions(newArrowPositions);
    }, [predictions, currentData, viewUpdateTrigger, chartDimensions, showAllInsights, symbol, startDate, endDate, selectedTimeframes]);

    useEffect(() => {
        if (chartContainerRef.current) {
            const chartElement = chartContainerRef.current;
            chartElement.innerHTML = '';
            const containerWidth = Math.max(1, chartElement.clientWidth - 2);
            const containerHeight = Math.max(1, chartElement.clientHeight - 2);

            const newChart = createChart(chartElement, {
                width: containerWidth,
                height: containerHeight,
                layout: { background: { type: 'solid', color: '#1a1a1a' }, textColor: '#999', fontSize: isMobile ? 8 : 10, fontFamily: 'Inter, sans-serif' },
                grid: { vertLines: { color: '#2a2a2a' }, horzLines: { color: '#2a2a2a' } },
                timeScale: { borderColor: '#2a2a2a', timeVisible: true, fixLeftEdge: fixLeftEdge },
                rightPriceScale: { borderColor: '#2a2a2a', visible: true, width: isMobile ? 50 : 60 },
                crosshair: { mode: 1 },
            });

            const newSeries = newChart.addLineSeries({
                color: timeframe.color,
                lineWidth: isMobile ? 1.5 : 1,
                crosshairMarkerVisible: true,
                priceLineVisible: false,
                lastValueVisible: false,
            });

            chartRef.current = newChart;
            seriesRef.current = newSeries;

            setChartDimensions({ width: containerWidth, height: containerHeight });

            newChart.timeScale().subscribeVisibleLogicalRangeChange(() => setViewUpdateTrigger(p => p + 1));
            
            const resizeObserver = new ResizeObserver(entries => {
                if (entries[0] && chartRef.current) {
                    const { width, height } = entries[0].contentRect;
                    chartRef.current.applyOptions({ width: Math.max(1, width - 4), height: Math.max(1, height - 4) });
                    setChartDimensions({ width, height });
                    setViewUpdateTrigger(p => p + 1);
                }
            });
            resizeObserver.observe(chartElement);

            return () => {
                resizeObserver.disconnect();
                newChart.remove();
                chartRef.current = null;
                seriesRef.current = null;
            };
        }
    }, [height, timeframe.color, isMobile, fixLeftEdge]);

useEffect(() => {
    const initializeData = async () => {
        const historyModeChanged = prevHistoryModeRef.current !== showHistoricalPerformance;
        if (historyModeChanged) {
            if (!isTransitioningRef.current) {
                isTransitioningRef.current = true;
                prevHistoryModeRef.current = showHistoricalPerformance;
                return;
            }
            isTransitioningRef.current = false;
        }

        let historicalData: CandlestickData[];
        
        // Check if we have a custom date range
        const hasDateRange = startDate || endDate;
        
        if (hasDateRange) {
            // Parse dates
            const start = startDate ? parseCustomDateTime(startDate) : new Date(Date.UTC(2026, 0, 13, 20, 30, 0));
            const end = endDate ? parseCustomDateTime(endDate) : new Date();
            
            if (start && end) {
                console.log(`[CHART] Fetching date range: ${start.toISOString()} to ${end.toISOString()}`);
                // Fetch specific date range
                historicalData = await fetchKlineDataForDateRange(timeframe, symbol, start, end);
            } else {
                // Fallback to standard fetch if date parsing fails
                historicalData = await fetchKlineData(timeframe, symbol, 0);
            }
        } else {
            // Standard fetch for current/recent data
            historicalData = await fetchKlineData(timeframe, symbol, 0);
        }

            if (seriesRef.current && historicalData.length > 0) {
                // Apply local filtering to the standard data
                // This ensures users only see data within their selected range (or all if no range)
                const finalData = filterKlinesByDateRange(historicalData);
                
                seriesRef.current.setData(finalData.map(c => ({ time: c.time, value: c.open })));
                setCurrentData(finalData);
                
                if (finalData.length > 0) setLastPrice(finalData[finalData.length - 1]);
                if (chartRef.current && finalData.length > 1) chartRef.current.timeScale().fitContent();

                const allPreds: PredictionEntry[] = [];
                SUPPORTED_PREDICTION_INTERVALS.forEach(interval => {
                    allPreds.push(...getCurrentPredictions(interval, showHistoricalPerformance || false, symbol));
                });
                setPredictions(allPreds);
                setViewUpdateTrigger(p => p + 1);
            }
        };

        initializeData();

        const unsubscribeUpdates = subscribeToUpdates((data, key) => {
            const hasHistoricalRange = startDate || endDate;
            const now = Date.now();
            const endTs = endDate ? parseCustomDateTime(endDate)?.getTime() || now : now;
            const isLiveView = !hasHistoricalRange || (endTs > now - 60000); 

            if (!isLiveView) return;

            const [dataSymbol, timeframeId] = key.split('-');
            if (timeframeId === timeframe.id && dataSymbol === symbol && seriesRef.current) {
                if (hasHistoricalRange) return;

                const currentDataToUse = getCurrentData(timeframe.id, symbol);
                const filteredData = filterKlinesByDateRange(currentDataToUse);
                
                if (filteredData.length > 0) {
                    seriesRef.current.setData(filteredData.map(c => ({ time: c.time, value: c.open })));
                    setCurrentData(filteredData);
                    setLastPrice(filteredData[filteredData.length - 1]);
                }

                const allPreds: PredictionEntry[] = [];
                SUPPORTED_PREDICTION_INTERVALS.forEach(interval => {
                    allPreds.push(...getCurrentPredictions(interval, showHistoricalPerformance || false, symbol));
                });
                setPredictions(allPreds);
                setViewUpdateTrigger(p => p + 1);
            }
        });

        const unsubscribePredictions = subscribeToPredictionUpdates((newPredictions, updatedTimeframeId, ticker) => {
            if (SUPPORTED_PREDICTION_INTERVALS.includes(updatedTimeframeId) && ticker === symbol) {
                setTimeout(() => {
                    const allPreds: PredictionEntry[] = [];
                    SUPPORTED_PREDICTION_INTERVALS.forEach(interval => {
                        allPreds.push(...getCurrentPredictions(interval, showHistoricalPerformance || false, symbol));
                    });
                    setPredictions(allPreds);
                }, 100);
            }
        });

        const unsubscribeViewUpdates = subscribeToViewUpdates(() => setViewUpdateTrigger(p => p + 1));

        return () => {
            unsubscribeUpdates();
            unsubscribePredictions();
            unsubscribeViewUpdates();
        };
    }, [timeframe.binanceInterval, timeframe.dataLimit, symbol, showHistoricalPerformance, startDate, endDate, filterKlinesByDateRange]);

    return (
        <div className="relative h-full bg-[#1a1a1a]">
            <div className="h-5 md:h-6 border-b border-[#2a2a2a] px-1 md:px-2 flex items-center justify-between text-[8px] md:text-[8px]">
                <div className="flex items-center flex-1">
                    {isEditingTimeframe ? (
                        <div className="flex flex-col">
                            <input
                                type="text"
                                value={timeframeInputValue}
                                onChange={(e) => setTimeframeInputValue(e.target.value)}
                                onBlur={handleTimeframeInputSubmit}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleTimeframeInputSubmit(); else if (e.key === 'Escape') setIsEditingTimeframe(false); }}
                                className="bg-[#2a2a2a] text-white text-[8px] md:text-[10px] px-1 py-0.5 rounded border border-[#3a3a3a] focus:border-blue-500 focus:outline-none w-16 md:w-20"
                                autoFocus
                            />
                            {timeframeInputError && <span className="text-red-400 text-[6px] md:text-[8px] mt-0.5">{timeframeInputError}</span>}
                        </div>
                    ) : (
                        <button onClick={() => setIsEditingTimeframe(true)} className="text-[#999] font-medium hover:text-white transition-colors text-[8px] md:text-[10px]">
                            {timeframe.label}
                        </button>
                    )}
                </div>
                {lastPrice && (
                    <div className="flex items-center space-x-1 md:space-x-2">
                        <span className="text-[#999] hidden sm:inline">O {lastPrice.open.toFixed(2)}</span>
                        <span className="text-[#999]">
                            <span className="inline-block w-[2px] h-[2px] bg-green-500 rounded-full align-middle mr-1"></span> positive chain &nbsp;
                            <span className="inline-block w-[2px] h-[2px] bg-red-500 rounded-full align-middle mr-1"></span> negative chain
                        </span>
                    </div>
                )}
            </div>
            <div className="relative h-[calc(100%-20px)] md:h-[calc(100%-24px)]">
                <div ref={chartContainerRef} className="absolute inset-0 p-0.5" />
                <div ref={overlayContainerRef} className="absolute inset-0 p-0.5 pointer-events-none">
                    {arrowPositions.map((position) => (
                        <PredictionArrow
                            key={`${position.datetime}-${position.ticker}-${position.timeframeId}`}
                            value={position.value}
                            position={position}
                            timeframeId={position.timeframeId}
                            ticker={position.ticker}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
};

export default ChartContainer;