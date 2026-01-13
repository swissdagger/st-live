import { PredictionEntry, CandlestickData } from '../types';

export interface InitialIndicator {
    datetime: string;
    trend_type: number;
    timeframe: string;
    end_datetime: string | null;
    open_price: number;
    directional_change_percent: number;
}

export interface Propagation {
    propagation_id: string;
    propagation_level: number;
    datetime: string;
    trend_type: number;
    higher_freq: string;
    lower_freq: string;
    open_price: number;
    directional_change_percent: number;
}

interface ActiveChain {
    chainId: string;
    initialDatetime: Date;
    endDatetime: Date;
    trendType: number;
    initialOpenPrice: number;
    currentTimeframeIndex: number;
    nextExpectedTimeframeIndex: number;
    propagationLevel: number;
    isActive: boolean;
}

function timeframeToSeconds(timeframe: string): number {
    const match = timeframe.match(/^(\d+)(s|m|h|d|w|mo)$/);
    if (!match) return 0;

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
        case 's': return value;
        case 'm': return value * 60;
        case 'h': return value * 3600;
        case 'd': return value * 86400;
        case 'w': return value * 604800;
        case 'mo': return value * 2592000;
        default: return 0;
    }
}

function getOpenPriceAtDatetime(csvData: CandlestickData[], datetime: string, priceMap?: Map<number, number>): number {
    const targetTime = new Date(datetime.replace(' ', 'T') + 'Z').getTime() / 1000;

    if (priceMap) {
        return priceMap.get(targetTime) || 0;
    }

    const candle = csvData.find(c => c.time === targetTime);
    return candle?.open || 0;
}

export function extractTrendIndicators(
    allPredictions: Record<string, PredictionEntry[]>,
    selectedTimeframes: string[] = [],
    csvData: CandlestickData[] = []
): { initialIndicators: InitialIndicator[], propagations: Propagation[] } {
    const allTimeframes = Object.keys(allPredictions);

    const selectedTimeframesSet = new Set(selectedTimeframes);
    const timeframesToUse = selectedTimeframes.length > 0
        ? allTimeframes.filter(tf => selectedTimeframesSet.has(tf))
        : allTimeframes;

    const sortedTimeframes = timeframesToUse.sort((a, b) => timeframeToSeconds(a) - timeframeToSeconds(b));

    if (sortedTimeframes.length === 0) {
        return { initialIndicators: [], propagations: [] };
    }

    const timeToPriceMap = new Map<number, number>();
    csvData.forEach(candle => {
        timeToPriceMap.set(candle.time, candle.open);
    });

    const timeframeIndexMap = new Map<string, number>();
    sortedTimeframes.forEach((tf, index) => {
        timeframeIndexMap.set(tf, index);
    });

    const highestFreqTimeframe = sortedTimeframes[0];
    const highestFreqPredictions = allPredictions[highestFreqTimeframe] || [];

    const sortedPredictions = [...highestFreqPredictions].sort((a, b) =>
        new Date(a.datetime).getTime() - new Date(b.datetime).getTime()
    );

    const initialIndicators: InitialIndicator[] = [];
    let lastSignal: number | null = null;

    for (const pred of sortedPredictions) {
        if (pred.value !== 0) {
            if (lastSignal === null || pred.value !== lastSignal) {
                const openPrice = getOpenPriceAtDatetime(csvData, pred.datetime, timeToPriceMap);
                initialIndicators.push({
                    datetime: pred.datetime,
                    trend_type: pred.value,
                    timeframe: highestFreqTimeframe,
                    end_datetime: null,
                    open_price: openPrice,
                    directional_change_percent: 0
                });
                lastSignal = pred.value;
            }
        }
    }

    // Assign end_datetime based on the next opposing signal
    for (let i = 0; i < initialIndicators.length; i++) {
        const startDatetime = new Date(initialIndicators[i].datetime);
        const trendType = initialIndicators[i].trend_type;
        const opposingSignalValue = -trendType;

        const laterSignal = sortedPredictions.find(pred =>
            new Date(pred.datetime) > startDatetime &&
            pred.value === opposingSignalValue
        );

        if (laterSignal) {
            initialIndicators[i].end_datetime = laterSignal.datetime;
        } else {
            initialIndicators[i].end_datetime = sortedPredictions[sortedPredictions.length - 1]?.datetime || null;
        }
    }

    // Step 2: Multi-chain propagation tracking
    const propagations: Propagation[] = [];
    const activeChains: ActiveChain[] = [];
    let chainCounter = 0;

    console.log('[indicatorAnalysis] Starting multi-chain propagation detection. Initial indicators:', initialIndicators.length);

    // Create active chains from initial indicators
    for (const initialInd of initialIndicators) {
        const endDatetime = initialInd.end_datetime ? new Date(initialInd.end_datetime.replace(' ', 'T') + 'Z') : null;
        if (!endDatetime) continue;

        chainCounter++;
        const chain: ActiveChain = {
            chainId: `Chain_${chainCounter}`,
            initialDatetime: new Date(initialInd.datetime.replace(' ', 'T') + 'Z'),
            endDatetime: endDatetime,
            trendType: initialInd.trend_type,
            initialOpenPrice: initialInd.open_price,
            currentTimeframeIndex: 0, // Start at highest frequency
            nextExpectedTimeframeIndex: 1, // Next timeframe to check
            propagationLevel: 0,
            isActive: true
        };
        activeChains.push(chain);
        console.log('[indicatorAnalysis] Created chain:', chain.chainId, 'at', initialInd.datetime, 'type:', chain.trendType > 0 ? 'up' : 'down');
    }

    // Collect all signals from all timeframes with their metadata
    interface SignalEvent {
        datetime: Date;
        datetimeString: string;
        timeframeIndex: number;
        timeframe: string;
        value: number;
    }

    const allSignals: SignalEvent[] = [];
    sortedTimeframes.forEach((tf, tfIndex) => {
        const predictions = allPredictions[tf] || [];
        predictions.forEach(pred => {
            if (pred.value !== 0) {
                allSignals.push({
                    datetime: new Date(pred.datetime.replace(' ', 'T') + 'Z'),
                    datetimeString: pred.datetime,
                    timeframeIndex: tfIndex,
                    timeframe: tf,
                    value: pred.value
                });
            }
        });
    });

    // Sort all signals chronologically
    allSignals.sort((a, b) => a.datetime.getTime() - b.datetime.getTime());

    console.log('[indicatorAnalysis] Processing', allSignals.length, 'signals across', sortedTimeframes.length, 'timeframes');

    // Process signals chronologically
    for (const signal of allSignals) {
        // Check each active chain to see if it can propagate or should be invalidated
        for (const chain of activeChains) {
            if (!chain.isActive) continue;

            const signalTime = signal.datetime.getTime();
            const chainStartTime = chain.initialDatetime.getTime();
            const chainEndTime = chain.endDatetime.getTime();

            // Signal must be within the chain's time window
            if (signalTime < chainStartTime || signalTime > chainEndTime) continue;

            // Check if this signal is on the next expected timeframe for this chain
            if (signal.timeframeIndex === chain.nextExpectedTimeframeIndex) {
                if (signal.value === chain.trendType) {
                    // This is a propagation! The chain continues to the next level
                    chain.propagationLevel++;
                    const propOpenPrice = getOpenPriceAtDatetime(csvData, signal.datetimeString, timeToPriceMap);
                    const directionalChange = chain.initialOpenPrice !== 0
                        ? ((propOpenPrice - chain.initialOpenPrice) / chain.initialOpenPrice) * 100
                        : 0;

                    const propagation: Propagation = {
                        propagation_id: chain.chainId,
                        propagation_level: chain.propagationLevel,
                        datetime: signal.datetimeString,
                        trend_type: chain.trendType,
                        higher_freq: sortedTimeframes[chain.currentTimeframeIndex],
                        lower_freq: signal.timeframe,
                        open_price: propOpenPrice,
                        directional_change_percent: directionalChange
                    };

                    propagations.push(propagation);
                    console.log('[indicatorAnalysis] Chain', chain.chainId, 'propagated to level', chain.propagationLevel,
                        'at', signal.datetimeString, 'from', sortedTimeframes[chain.currentTimeframeIndex], 'to', signal.timeframe);

                    // Update chain state
                    chain.currentTimeframeIndex = signal.timeframeIndex;
                    chain.nextExpectedTimeframeIndex = signal.timeframeIndex + 1;

                    // If we've reached the last timeframe, deactivate the chain
                    if (chain.nextExpectedTimeframeIndex >= sortedTimeframes.length) {
                        chain.isActive = false;
                        console.log('[indicatorAnalysis] Chain', chain.chainId, 'completed (reached last timeframe)');
                    }
                } else if (signal.value === -chain.trendType) {
                    // Opposing signal on the next expected timeframe - invalidate this chain
                    chain.isActive = false;
                    console.log('[indicatorAnalysis] Chain', chain.chainId, 'invalidated by opposing signal on',
                        signal.timeframe, 'at', signal.datetimeString);
                }
            }
        }
    }

    const activeChainCount = activeChains.filter(c => c.isActive).length;
    const completedChainCount = activeChains.filter(c => !c.isActive).length;
    console.log('[indicatorAnalysis] Total propagations detected:', propagations.length);
    console.log('[indicatorAnalysis] Chains: ', activeChains.length, 'created,', completedChainCount, 'completed/invalidated,', activeChainCount, 'still active');
    if (propagations.length > 0) {
        console.log('[indicatorAnalysis] Sample propagations:', propagations.slice(0, 5));
    }

    return { initialIndicators, propagations };
}
