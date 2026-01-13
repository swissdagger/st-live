import { PredictionEntry } from '../types';
import { SUPPORTED_PREDICTION_INTERVALS } from '../api/sumtymeAPI';

export interface InitialIndicator {
    datetime: string;
    trend_type: number;
    timeframe: string;
    open: number;
    end_datetime: string | null;
    ticker: string;
}

export interface Propagation {
    propagation_id: string;
    propagation_level: number;
    datetime: string;
    trend_type: number;
    higher_freq: string;
    lower_freq: string;
    open: number;
    ticker: string;
}

// Convert timeframe string to seconds for sorting
const timeframeToSeconds = (timeframe: string): number => {
    const match = timeframe.match(/^(\d+)(s|m|h|d|w|mo)$/);
    if (!match) return 0;

    const value = parseInt(match[1]);
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
};

// Parse datetime string to timestamp for comparisons
const parseDateTime = (datetime: string): number => {
    return new Date(datetime.replace(' ', 'T') + 'Z').getTime();
};

/**
 * Extracts initial directional indicators from the highest frequency timeframe
 * and tracks their propagation across lower frequency timeframes with propagation IDs and levels.
 */
export const extractTrendIndicators = (
    allPredictions: Record<string, PredictionEntry[]>,
    ticker: string
): { initialIndicators: InitialIndicator[], propagations: Propagation[] } => {
    // Get all timeframes and sort by frequency (highest to lowest)
    const timeframes = Object.keys(allPredictions).filter(tf => allPredictions[tf].length > 0);
    const sortedTimeframes = timeframes.sort((a, b) => timeframeToSeconds(a) - timeframeToSeconds(b));

    if (sortedTimeframes.length === 0) {
        return { initialIndicators: [], propagations: [] };
    }

    const highestFreqTimeframe = sortedTimeframes[0];
    const highestFreqPredictions = allPredictions[highestFreqTimeframe] || [];

    // --- Step 1: Identify initial directional indicators ---
    const initialIndicators: InitialIndicator[] = [];
    let lastSignal: number | null = null;

    for (const prediction of highestFreqPredictions) {
        const currentSignal = prediction.value;
        
        if (currentSignal !== 0) {
            if (lastSignal === null || Math.sign(currentSignal) !== Math.sign(lastSignal)) {
                initialIndicators.push({
                    datetime: prediction.datetime,
                    trend_type: Math.sign(currentSignal),
                    timeframe: highestFreqTimeframe,
                    open: 0,
                    end_datetime: null,
                    ticker: ticker
                });
                lastSignal = currentSignal;
            }
        }
    }

    // Assign end_datetime based on the next opposing signal
    for (let i = 0; i < initialIndicators.length; i++) {
        const startDatetime = initialIndicators[i].datetime;
        const trendType = initialIndicators[i].trend_type;
        const opposingSignalValue = -trendType;
        
        const startTimestamp = parseDateTime(startDatetime);

        const laterSignals = highestFreqPredictions.filter(pred => {
            const predTimestamp = parseDateTime(pred.datetime);
            return predTimestamp > startTimestamp && Math.sign(pred.value) === opposingSignalValue;
        });

        if (laterSignals.length > 0) {
            initialIndicators[i].end_datetime = laterSignals[0].datetime;
        } else {
            const lastPred = highestFreqPredictions[highestFreqPredictions.length - 1];
            initialIndicators[i].end_datetime = lastPred ? lastPred.datetime : startDatetime;
        }
    }

    // --- Step 2: Identify cross-timeframe propagations (Chained Logic with ID and Level) ---
    const propagations: Propagation[] = [];
    let propagationCounter = 0;

    for (const initialInd of initialIndicators) {
        const currentDatetime = initialInd.datetime;
        const currentType = initialInd.trend_type;
        const currentTimeframeIndex = sortedTimeframes.indexOf(initialInd.timeframe);
        const endDatetime = initialInd.end_datetime;

        if (!endDatetime) continue;

        let currentChainDatetime = currentDatetime;
        let currentChainTimeframeIndex = currentTimeframeIndex;
        let propagationLevel = 0;

        propagationCounter++;
        const currentPropagationId = `Prop_${propagationCounter}`;

        const endTimestamp = parseDateTime(endDatetime);

        // Continue the chain through lower timeframes
        for (let j = currentChainTimeframeIndex + 1; j < sortedTimeframes.length; j++) {
            const nextLowerTimeframe = sortedTimeframes[j];
            const nextLowerPredictions = allPredictions[nextLowerTimeframe] || [];

            // Find the first occurrence of the same signal in the next lower timeframe
            const laterSignals = nextLowerPredictions.filter(pred => {
                const predTimestamp = parseDateTime(pred.datetime);
                const chainTimestamp = parseDateTime(currentChainDatetime);
                return predTimestamp >= chainTimestamp && 
                       predTimestamp <= endTimestamp && 
                       Math.sign(pred.value) === currentType;
            });

            if (laterSignals.length === 0) break;

            const nextSignal = laterSignals[0];
            const nextSignalDatetime = nextSignal.datetime;
            const nextSignalTimestamp = parseDateTime(nextSignalDatetime);

            // Check for opposing signal in the initial frequency timeframe 
            const initialFreqPredictions = allPredictions[sortedTimeframes[currentTimeframeIndex]] || [];
            const opposingSignalValue = -currentType;

            const intermediatePredictions = initialFreqPredictions.filter(pred => {
                const predTimestamp = parseDateTime(pred.datetime);
                const chainTimestamp = parseDateTime(currentChainDatetime);
                return predTimestamp > chainTimestamp && 
                       predTimestamp <= nextSignalTimestamp;
            });

            const opposingSignalFound = intermediatePredictions.some(pred => 
                Math.sign(pred.value) === opposingSignalValue
            );

            if (!opposingSignalFound) {
                propagationLevel++;
                propagations.push({
                    propagation_id: currentPropagationId,
                    propagation_level: propagationLevel,
                    datetime: nextSignalDatetime,
                    trend_type: currentType,
                    higher_freq: sortedTimeframes[currentChainTimeframeIndex],
                    lower_freq: nextLowerTimeframe,
                    open: 0,
                    ticker: ticker
                });

                currentChainDatetime = nextSignalDatetime;
                currentChainTimeframeIndex = j;
            } else {
                break;
            }
        }
    }

    return { initialIndicators, propagations };
};

/**
 * Organize all predictions by ticker and timeframe for propagation analysis
 */
export const organizePredictionsByTicker = (
    predictions: PredictionEntry[]
): Record<string, Record<string, PredictionEntry[]>> => {
    const organized: Record<string, Record<string, PredictionEntry[]>> = {};
    
    for (const pred of predictions) {
        if (!organized[pred.ticker]) {
            organized[pred.ticker] = {};
            SUPPORTED_PREDICTION_INTERVALS.forEach(interval => {
                organized[pred.ticker][interval] = [];
            });
        }
        
        if (SUPPORTED_PREDICTION_INTERVALS.includes(pred.timeframeId)) {
            if (!organized[pred.ticker][pred.timeframeId]) {
                organized[pred.ticker][pred.timeframeId] = [];
            }
            organized[pred.ticker][pred.timeframeId].push(pred);
        }
    }
    
    // Sort each timeframe's predictions by datetime
    Object.keys(organized).forEach(ticker => {
        Object.keys(organized[ticker]).forEach(timeframe => {
            organized[ticker][timeframe].sort((a, b) => 
                parseDateTime(a.datetime) - parseDateTime(b.datetime)
            );
        });
    });
    
    return organized;
};

/**
 * Get predictions to display based on propagation logic
 * Only shows initial indicators and their propagations, not all signals
 */
export const getPredictionsToDisplay = (
    allPredictions: Record<string, PredictionEntry[]>,
    ticker: string,
    showAllInsights: boolean = false
): PredictionEntry[] => {
    // If showing all insights, return all non-zero predictions
    if (showAllInsights) {
        const allPreds: PredictionEntry[] = [];
        Object.values(allPredictions).forEach(predictions => {
            predictions.filter(p => p.value !== 0 && p.ticker === ticker).forEach(p => allPreds.push(p));
        });
        return allPreds;
    }

    // Otherwise, use propagation logic
    const { initialIndicators, propagations } = extractTrendIndicators(allPredictions, ticker);
    
    const displayPredictions: PredictionEntry[] = [];

    // Add initial indicators
    for (const indicator of initialIndicators) {
        displayPredictions.push({
            datetime: indicator.datetime,
            value: indicator.trend_type,
            timeframeId: indicator.timeframe,
            ticker: indicator.ticker
        });
    }

    // Add propagations
    for (const prop of propagations) {
        displayPredictions.push({
            datetime: prop.datetime,
            value: prop.trend_type,
            timeframeId: prop.lower_freq,
            ticker: prop.ticker
        });
    }

    return displayPredictions;
};
