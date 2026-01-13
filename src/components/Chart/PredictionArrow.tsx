import React, { useState } from 'react';
import { PredictionArrowProps } from '../../types';
import { getInitialTimeframes } from '../../api/binanceAPI';

// Helper function to get human-readable timeframe label
const getTimeframeLabel = (timeframeId: string): string => {
    const timeframes = getInitialTimeframes('BTCUSDT', false);
    const timeframe = timeframes.find(tf => tf.id === timeframeId);
    return timeframe?.label || timeframeId;
};

const PredictionArrow: React.FC<PredictionArrowProps> = ({ value, position, timeframeId, ticker }) => {
    const [showTooltip, setShowTooltip] = useState(false);

    // Don't render anything if value is 0 (no prediction)
    if (value === 0 || value === null || value === undefined) {
        return null;
    }

    // Debug log to see what values we're getting
    console.log('PredictionArrow rendering:', { value, position, timeframeId, ticker });

    // Determine if prediction is bullish (positive value) or bearish (negative value)
    const isUp = value > 0;
    const color = isUp ? 'rgb(16, 185, 129)' : 'rgb(239, 68, 68)';
    const timeframeLabel = getTimeframeLabel(timeframeId);

    // Calculate dot size based on confidence (absolute value)
    const absValue = Math.abs(value);
    // Ensure minimum size of 4px for visibility, especially for value of 1 or -1
    const dotSize = Math.max(4, Math.min(8, 4 + (absValue / 10))); // Size between 4-8px based on confidence

    const dotStyle: React.CSSProperties = {
        position: 'absolute',
        left: `${position.x + 1}px`,
        top: `${position.y + 2}px`,
        transform: 'translate(-50%, -50%)',
        backgroundColor: color,
        width: `${dotSize}px`,
        height: `${dotSize}px`,
        borderRadius: '50%',
        zIndex: 1,
        boxShadow: '0 0 4px rgba(0, 0, 0, 0.3)',
        cursor: 'pointer',
        opacity: Math.max(0.8, Math.min(1, absValue / 10)), // Higher base opacity for visibility
    };

    const tooltipStyle: React.CSSProperties = {
        position: 'absolute',
        left: `${position.x + 1}px`,
        top: `${position.y - 20}px`,
        transform: 'translate(-50%, -100%)',
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        color: 'white',
        padding: '4px 8px',
        borderRadius: '4px',
        fontSize: '11px',
        whiteSpace: 'nowrap',
        zIndex: 10,
        pointerEvents: 'none',
        border: `1px solid ${color}`,
    };

    // Calculate vertical offset based on timeframe to stack labels at different heights
    const getTimeframeOffset = (timeframeId: string): number => {
        switch (timeframeId) {
            case '1m': return 12;  // Closest to dot
            case '3m': return 20;  // 8px higher
            case '5m': return 28;  // 16px higher
            case '15m': return 36; // 24px higher
            default: return 12;    // Default position
        }
    };

    const timeframeOffset = getTimeframeOffset(timeframeId);

    const labelStyle: React.CSSProperties = {
        position: 'absolute',
        left: `${position.x + 1}px`,
        top: `${position.y - timeframeOffset}px`,
        transform: 'translate(-50%, -100%)',
        color: color,
        fontSize: '8px',
        fontWeight: 'bold',
        textShadow: '1px 1px 2px rgba(0, 0, 0, 0.8)',
        zIndex: 2,
        pointerEvents: 'none',
        fontFamily: 'monospace',
    };

    return (
        <>
            <div
                style={dotStyle}
                onMouseEnter={() => setShowTooltip(true)}
                onMouseLeave={() => setShowTooltip(false)}
            />
            <div style={labelStyle}>
                {timeframeId}
            </div>
            {showTooltip && (
                <div style={tooltipStyle}>
                    {ticker} {timeframeLabel}: {isUp ? '^' : 'v'} {absValue}%
                </div>
            )}
        </>
    );
};

export default PredictionArrow;