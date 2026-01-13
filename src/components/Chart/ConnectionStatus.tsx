import React from 'react';
import { Activity, WifiOff } from 'lucide-react';
import { ConnectionStatusProps } from '../../types';

const ConnectionStatus: React.FC<ConnectionStatusProps> = ({
  connected,
  reconnecting = false,
  timeframe,
}) => {
  if (connected) {
    return (
      <div className="flex items-center text-green-400 text-xs">
        <Activity size={14} className="mr-1 animate-pulse" />
        <span>Live</span>
      </div>
    );
  }

  if (reconnecting) {
    return (
      <div className="flex items-center text-yellow-400 text-xs">
        <Activity size={14} className="mr-1 animate-pulse" />
        <span>Reconnecting...</span>
      </div>
    );
  }

  return (
    <div className="flex items-center text-red-400 text-xs">
      <WifiOff size={14} className="mr-1" />
      <span>Disconnected</span>
    </div>
  );
};

export default ConnectionStatus;