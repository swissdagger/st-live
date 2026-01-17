import React, { useEffect, useState, useCallback, useMemo } from 'react';
import ChartContainer from '../Chart/ChartContainer';
import QuadView from './QuadView';
import { getInitialTimeframes, startKlinePolling, calculateDataLimit, convertIntervalToMinutes, fetchKlineData, fetchKlineDataForDateRange} from '../../api/binanceAPI';
import { subscribeToPredictionUpdates, setSixteenTimesMode } from '../../services/predictionService';
import { CryptoSymbol, TimeframeConfig, PredictionEntry, CandlestickData } from '../../types';
import { SUPPORTED_PREDICTION_INTERVALS, addPollingTicker } from '../../api/sumtymeAPI';
import { Info, X, Calendar, Search, ChevronLeft, ChevronRight } from 'lucide-react';
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

// Info Modal Component
const InfoModal: React.FC<{ 
    onClose: () => void;
    initialIndicators: InitialIndicator[];
    propagations: Propagation[];
    allPredictions: Record<string, Record<string, PredictionEntry[]>>;
    currentSymbol: string;
}> = ({ onClose, initialIndicators, propagations, allPredictions, currentSymbol }) => {
    const [currentSlide, setCurrentSlide] = useState(0);
    const totalSlides = 4;
    
    // Analyze active chains
    const chainAnalysis = useMemo(() => {
        if (!allPredictions[currentSymbol]) return { totalActive: 0, upChains: 0, downChains: 0, chains: [] };

        const tickerPredictions = allPredictions[currentSymbol];
        
        // 1. Group propagations by chain ID
        const chainGroups = new Map<string, Propagation[]>();
        propagations.forEach(prop => {
            if (!chainGroups.has(prop.propagation_id)) {
                chainGroups.set(prop.propagation_id, []);
            }
            chainGroups.get(prop.propagation_id)!.push(prop);
        });
        
        // 2. Build complete chain objects
        const processedChains = initialIndicators.map((initialInd, index) => {
            // Construct ID based on index (matching logic in indicatorAnalysis)
            const chainId = `Chain_${index + 1}`;
            const props = chainGroups.get(chainId) || [];
            
            // Sort propagations by level
            const sortedProps = [...props].sort((a, b) => a.propagation_level - b.propagation_level);
            
            // Determine the "Longest Timescale" reached
            const maxProp = sortedProps.length > 0 ? sortedProps[sortedProps.length - 1] : null;
            const currentMaxTimeframe = maxProp ? maxProp.lower_freq : initialInd.timeframe;
            const lastActionTime = maxProp ? maxProp.datetime : initialInd.datetime;
            const lastActionTimestamp = new Date(lastActionTime.replace(' ', 'T') + 'Z').getTime();
            const direction = initialInd.trend_type; // 1 or -1

            // 3. Check for Termination
            // A chain ends ONLY if the longest timescale it reached shows an opposing signal LATER than the propagation
            const timeframePredictions = tickerPredictions[currentMaxTimeframe] || [];
            
            const terminatingSignal = timeframePredictions.find(pred => {
                const predTime = new Date(pred.datetime.replace(' ', 'T') + 'Z').getTime();
                // Must be after the chain reached this level AND be an opposing signal
                return predTime > lastActionTimestamp && pred.value === -direction;
            });

            const isActive = !terminatingSignal;

            return {
                chainId,
                direction: direction > 0 ? 'UP' : 'DOWN',
                maxLevel: maxProp ? maxProp.propagation_level : 0,
                latestTimeframe: currentMaxTimeframe,
                startTime: initialInd.datetime,
                latestTime: lastActionTime,
                latestTimestamp: lastActionTimestamp,
                isActive,
                timeframes: sortedProps.map(p => p.lower_freq),
                initialTimeframe: initialInd.timeframe
            };
        });

        // 4. Filter only Active chains
        const activeChains = processedChains.filter(chain => chain.isActive);
        
        return {
            totalActive: activeChains.length,
            upChains: activeChains.filter(c => c.direction === 'UP').length,
            downChains: activeChains.filter(c => c.direction === 'DOWN').length,
            chains: activeChains.sort((a, b) => {
                // Sort by Level (Desc), then by Latest Timestamp (Desc)
                if (b.maxLevel !== a.maxLevel) return b.maxLevel - a.maxLevel;
                return b.latestTimestamp - a.latestTimestamp;
            })
        };
    }, [initialIndicators, propagations, allPredictions, currentSymbol]);

    const nextSlide = () => setCurrentSlide(prev => Math.min(prev + 1, totalSlides - 1));
    const prevSlide = () => setCurrentSlide(prev => Math.max(prev - 1, 0));

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg max-w-4xl w-full max-h-[85vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-[#2a2a2a]">
                    <h2 className="text-white text-lg font-semibold">Understanding Causal Chains</h2>
                    <button onClick={onClose}><X size={20} className="text-[#999] hover:text-white" /></button>
                </div>

                {/* Slide Indicators */}
                <div className="flex justify-center gap-2 py-3 border-b border-[#2a2a2a]">
                    {[0, 1, 2, 3].map(index => (
                        <button
                            key={index}
                            onClick={() => setCurrentSlide(index)}
                            className={`h-2 rounded-full transition-all ${
                                currentSlide === index ? 'w-8 bg-blue-500' : 'w-2 bg-[#3a3a3a]'
                            }`}
                        />
                    ))}
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {currentSlide === 0 && (
                        <div className="space-y-6">
                            <div className="text-center mb-8">
                                <h3 className="text-2xl font-bold text-white mb-2">Don't Predict the Price.</h3>
                                <h3 className="text-2xl font-bold text-blue-400">Track Directional Changes Live.</h3>
                            </div>

                            <div className="bg-[#2a2a2a] p-6 rounded-lg space-y-4">
                                <p className="text-[#ccc] leading-relaxed">
                                    Statistical models try to guess where the price will be in 1 hour. <span className="text-white font-semibold">Our technology doesn't.</span>
                                </p>
                                <p className="text-[#ccc] leading-relaxed">
                                    Instead, <span className="text-blue-400 font-semibold">sumtyme.ai</span> detects when a directional move <span className="text-green-400">starts</span> and tracks it as it <span className="text-green-400">grows stronger</span> using different timescales.
                                </p>
                                <div className="bg-[#1a1a1a] p-4 rounded border border-[#3a3a3a] mt-4">
                                    <p className="text-white italic">
                                        💡 Think of it like a <span className="text-blue-400">snowball rolling down a hill</span> - it starts small, but as it keeps rolling, it gains size and momentum.
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-start gap-4 bg-[#2a2a2a] p-4 rounded-lg">
                                <div className="flex-shrink-0 w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center text-white font-bold text-xl">
                                    ✓
                                </div>
                                <div>
                                    <h4 className="text-white font-semibold mb-1">Key Takeaway</h4>
                                    <p className="text-[#ccc]">We track the <span className="text-blue-400 font-semibold">causal chain of events of a directional move</span> - we don't forecast for a fixed period.</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {currentSlide === 1 && (
                        <div className="space-y-6">
                            <div className="text-center mb-6">
                                <h3 className="text-2xl font-bold text-white mb-2">The Chain Reaction</h3>
                                <p className="text-[#999]">How change evolves from small to large timeframes</p>
                            </div>

                            <p className="text-[#ccc] leading-relaxed">
                                Directional moves start on <span className="text-green-400 font-semibold">smallest timescale</span> and then move to larger timescales and they evolve. We call this a <span className="text-blue-400 font-semibold">Causal Chain</span>.
                            </p>

                            {/* Domino Effect Visual */}
                            <div className="bg-[#2a2a2a] p-6 rounded-lg">
                                <div className="flex items-center justify-center gap-4 mb-6">
                                    <div className="text-center">
                                        <div className="w-12 h-16 bg-green-500 rounded mb-2 transform -rotate-12 opacity-50"></div>
                                        <span className="text-xs text-white font-mono">1m</span>
                                    </div>
                                    <div className="text-green-400 text-2xl">→</div>
                                    <div className="text-center">
                                        <div className="w-16 h-20 bg-green-500 rounded mb-2 transform -rotate-6"></div>
                                        <span className="text-xs text-white font-mono">3m</span>
                                    </div>
                                    <div className="text-green-400 text-2xl">→</div>
                                    <div className="text-center">
                                        <div className="w-20 h-24 bg-green-500 rounded mb-2"></div>
                                        <span className="text-xs text-white font-mono">5m</span>
                                    </div>
                                </div>
                            </div>

                            {/* Three Stages */}
                            <div className="space-y-4">
                                <div className="flex items-start gap-3 bg-[#2a2a2a] p-4 rounded-lg">
                                    <div className="flex-shrink-0 w-8 h-8 bg-green-600 rounded-full flex items-center justify-center text-white font-bold">1</div>
                                    <div>
                                        <h4 className="text-white font-semibold mb-1">The Spark (Initiation)</h4>
                                        <p className="text-[#ccc] text-sm">For example, suppose we detect a <span className="font-mono text-green-400">+1</span> signal (a green dot) on the smallest timeframe (<span className="font-mono text-green-400">1m</span> in this example). The first domino has fallen. <span className="text-green-400">● Your first dot appears.</span></p>
                                    </div>
                                </div>

                                <div className="flex items-start gap-3 bg-[#2a2a2a] p-4 rounded-lg">
                                    <div className="flex-shrink-0 w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white font-bold">2</div>
                                    <div>
                                        <h4 className="text-white font-semibold mb-1">The Spread (Propagation)</h4>
                                        <p className="text-[#ccc] text-sm">If that directional change is growing into a sustained, prolonged change, that <span className="font-mono text-green-400">1m</span> signal will trigger a matching signal on lower timeframes. In this example, that would be a green dot on the <span className="font-mono text-blue-400">3m</span> timescale, then a green dot on the <span className="font-mono text-blue-400">5m</span> 5m timescale. <span className="text-blue-400">● Aligning dots appear, connected by the same chain.</span> Crucially, whenever we see a dot on one timescale, we then move to the next longest one for the chain we're tracking.</p>
                                    </div>
                                </div>

                                <div className="flex items-start gap-3 bg-[#2a2a2a] p-4 rounded-lg">
                                    <div className="flex-shrink-0 w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center text-white font-bold">3</div>
                                    <div>
                                        <h4 className="text-white font-semibold mb-1">The Directional Move</h4>
                                        <p className="text-[#ccc] text-sm">As long as the chain is propagating to larger timeframes, the directional move is <span className="text-green-400 font-semibold">healthy and growing</span>. The longer the chain, the more prolonged and sustained the change on its path to a large-scale, macro movement.</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {currentSlide === 2 && (
                        <div className="space-y-6">
                            <div className="text-center mb-6">
                                <h3 className="text-2xl font-bold text-white mb-2">The Chain Breaks</h3>
                                <p className="text-[#999]">When a chain ends</p>
                            </div>

                            <div className="bg-[#2a2a2a] p-6 rounded-lg space-y-4">
                                <p className="text-[#ccc] leading-relaxed">
                                    A chain doesn't last forever. It ends when we detect an <span className="text-red-400 font-semibold">Opposing Signal</span> on the <span className="text-white font-semibold">longest timeframe it has reached</span>.
                                </p>
                                <div className="bg-[#1a1a1a] p-4 rounded border border-red-900">
                                    <p className="text-[#ccc]">
                                        If you are tracking an <span className="text-green-400 font-semibold">UP chain</span> that has reached the <span className="text-blue-400 font-semibold">15m</span> timeframe, it stays active until a <span className="text-red-400 font-semibold">DOWN signal</span> appears on the <span className="text-blue-400 font-semibold">15m</span> timeframe.
                                    </p>
                                </div>
                            </div>

                            {/* Summary Table */}
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm border-collapse">
                                    <thead>
                                        <tr className="bg-[#2a2a2a]">
                                            <th className="border border-[#3a3a3a] px-3 py-2 text-left text-white">Stage</th>
                                            <th className="border border-[#3a3a3a] px-3 py-2 text-left text-white">Visual Indicator</th>
                                            <th className="border border-[#3a3a3a] px-3 py-2 text-left text-white">Meaning</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr className="hover:bg-[#252525]">
                                            <td className="border border-[#3a3a3a] px-3 py-2 text-green-400 font-semibold">Initiation</td>
                                            <td className="border border-[#3a3a3a] px-3 py-2">
                                                <span className="text-green-400">● First Dot (1m)</span>
                                            </td>
                                            <td className="border border-[#3a3a3a] px-3 py-2 text-[#ccc]">"Something is starting."</td>
                                        </tr>
                                        <tr className="hover:bg-[#252525]">
                                            <td className="border border-[#3a3a3a] px-3 py-2 text-blue-400 font-semibold">Propagation</td>
                                            <td className="border border-[#3a3a3a] px-3 py-2">
                                                <span className="text-blue-400">● New Dots (3m, 5m)</span>
                                            </td>
                                            <td className="border border-[#3a3a3a] px-3 py-2 text-[#ccc]">"The chain is continuing."</td>
                                        </tr>
                                        <tr className="hover:bg-[#252525]">
                                            <td className="border border-[#3a3a3a] px-3 py-2 text-red-400 font-semibold">Termination</td>
                                            <td className="border border-[#3a3a3a] px-3 py-2">
                                                <span className="text-red-400">● Opposing Dot (on the max timescale reached)</span>
                                            </td>
                                            <td className="border border-[#3a3a3a] px-3 py-2 text-[#ccc]">"The chain is over."</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {currentSlide === 3 && (
                        <div className="space-y-6">
                            <div className="text-center mb-6">
                                <h3 className="text-2xl font-bold text-white mb-2">Live Chain Status</h3>
                                <p className="text-[#999]">What's happening right now</p>
                            </div>

                            {/* Summary Stats */}
                            <div className="grid grid-cols-3 gap-4">
                                <div className="bg-[#2a2a2a] p-4 rounded-lg text-center">
                                    <div className="text-3xl font-bold text-blue-400">{chainAnalysis.totalActive}</div>
                                    <div className="text-xs text-[#999] mt-1">Active Chains</div>
                                </div>
                                <div className="bg-[#2a2a2a] p-4 rounded-lg text-center">
                                    <div className="text-3xl font-bold text-green-400">{chainAnalysis.upChains}</div>
                                    <div className="text-xs text-[#999] mt-1">Upward</div>
                                </div>
                                <div className="bg-[#2a2a2a] p-4 rounded-lg text-center">
                                    <div className="text-3xl font-bold text-red-400">{chainAnalysis.downChains}</div>
                                    <div className="text-xs text-[#999] mt-1">Downward</div>
                                </div>
                            </div>

                            {chainAnalysis.totalActive > 0 ? (
                                <>
                                    <div className="bg-[#2a2a2a] p-4 rounded-lg">
                                        <h4 className="text-white font-semibold mb-3">Current Active Chains</h4>
                                        <div className="space-y-3 max-h-64 overflow-y-auto">
                                            {chainAnalysis.chains.map((chain, idx) => (
                                                <div key={chain.chainId} className="bg-[#1a1a1a] p-3 rounded border border-[#3a3a3a]">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-mono text-xs text-[#999]">{chain.chainId}</span>
                                                            <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                                                                chain.direction === 'UP' ? 'bg-green-900 text-green-400' : 'bg-red-900 text-red-400'
                                                            }`}>
                                                                {chain.direction === 'UP' ? '↑ UP' : '↓ DOWN'}
                                                            </span>
                                                        </div>
                                                        <span className={`text-xs font-semibold ${
                                                            chain.maxLevel >= 3 ? 'text-purple-400' : chain.maxLevel >= 2 ? 'text-blue-400' : 'text-green-400'
                                                        }`}>
                                                            Level {chain.maxLevel}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-2 text-xs text-[#999]">
                                                        <span className="font-mono">{chain.initialTimeframe}</span>
                                                        {chain.timeframes.map((tf, i) => (
                                                            <React.Fragment key={i}>
                                                                <span className="text-blue-400">→</span>
                                                                <span className="font-mono text-blue-400">{tf}</span>
                                                            </React.Fragment>
                                                        ))}
                                                    </div>
                                                    <div className="text-xs text-[#666] mt-2">
                                                        Started: {chain.startTime} • Latest Step: {chain.latestTimeframe}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="bg-blue-900/20 border border-blue-900 p-4 rounded-lg">
                                        <p className="text-sm text-blue-300">
                                            💡 <strong>Tip:</strong> Chains remain active until an opposing chain <strong>reaches the same level of propagation.</strong>
                                        </p>
                                    </div>
                                </>
                            ) : (
                                <div className="bg-[#2a2a2a] p-8 rounded-lg text-center">
                                    <div className="text-4xl mb-3">🔍</div>
                                    <p className="text-white font-semibold mb-2">No Active Chains Detected</p>
                                    <p className="text-[#999] text-sm">
                                        When a new directional signal appears on the shortest timeframe (1m), it will show here as an active chain. Check back soon!
                                    </p>
                                </div>
                            )}

                            {/* Additional Info */}
                            <div className="bg-[#2a2a2a] p-4 rounded-lg space-y-3 border-t-2 border-[#3a3a3a] mt-6">
                                <h4 className="text-white font-semibold">About This Demo</h4>
                                <p className="text-[#ccc] text-sm">
                                    This deployment tracks BTCUSDT across <span className="font-mono text-blue-400">1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 8h, 12h, and 1d</span> timeframes for simplcity.
                                </p>
                                <p className="text-[#999] text-xs">
                                    Live data from api.binance.com starting January 13, 2026 20:30:00 GMT (maintenance Jan 14-17)
                                </p>
                                <p className="text-[#ccc] text-sm">
                                    This live demonstration is just the tip of the iceberg. To learn more about the technology and build more powerful applications for yourself (like tracking directionality during overlapping chain periods) <strong>in any environment,</strong> visit <a href="https://www.sumtyme.ai" className="text-white-500 underline hover:text-blue-300">our website</a> to learn more and sign up for free API credits.
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Navigation */}
                <div className="flex items-center justify-between p-4 border-t border-[#2a2a2a]">
                    <button
                        onClick={prevSlide}
                        disabled={currentSlide === 0}
                        className="flex items-center gap-2 px-4 py-2 rounded text-sm font-medium bg-[#2a2a2a] text-white hover:bg-[#3a3a3a] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <ChevronLeft size={16} />
                        Previous
                    </button>
                    
                    <span className="text-[#999] text-sm">
                        {currentSlide + 1} / {totalSlides}
                    </span>

                    {currentSlide < totalSlides - 1 ? (
                        <button
                            onClick={nextSlide}
                            className="flex items-center gap-2 px-4 py-2 rounded text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                        >
                            Next
                            <ChevronRight size={16} />
                        </button>
                    ) : (
                        <button
                            onClick={onClose}
                            className="px-4 py-2 rounded text-sm font-medium bg-green-600 text-white hover:bg-green-700 transition-colors"
                        >
                            Got it!
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
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
                <InfoModal 
                    onClose={() => setShowInfoModal(false)} 
                    initialIndicators={initialIndicators}
                    propagations={propagations}
                    allPredictions={allPredictionsData}
                    currentSymbol={currentSymbol}
                />
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