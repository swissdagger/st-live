import React from 'react';
import { TrendingUp, Menu, X, Github } from 'lucide-react';

interface HeaderProps {
  currentPrice: number;
  priceChange: number;
  isMobileMenuOpen: boolean;
  toggleMobileMenu: () => void;
}

const Header: React.FC<HeaderProps> = ({ 
  currentPrice, 
  priceChange, 
  isMobileMenuOpen,
  toggleMobileMenu
}) => {
  const priceChangePercent = (priceChange / currentPrice) * 100;
  const isPriceUp = priceChange >= 0;

  return (
    <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-20">
      <div className="container mx-auto px-4 py-3">
        <div className="flex justify-between items-center">
          <div className="flex items-center">
            <TrendingUp className="text-blue-500 mr-2\" size={24} />
            <h1 className="text-white text-xl font-bold">BTC Dashboard</h1>
          </div>
          
          <div className="hidden md:flex items-center space-x-6">
            <div className="flex flex-col items-end">
              <div className="text-white font-mono text-lg font-semibold">
                ${currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className={`text-sm font-mono ${isPriceUp ? 'text-green-400' : 'text-red-400'}`}>
                {isPriceUp ? '+' : ''}{priceChange.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 
                ({isPriceUp ? '+' : ''}{priceChangePercent.toFixed(2)}%)
              </div>
            </div>
            
            <a 
              href="https://github.com/yourusername/btc-trading-dashboard" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-gray-400 hover:text-white transition-colors"
            >
              <Github size={20} />
            </a>
          </div>
          
          <button 
            className="md:hidden text-gray-400 hover:text-white"
            onClick={toggleMobileMenu}
          >
            {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>
      
      {/* Mobile menu */}
      {isMobileMenuOpen && (
        <div className="md:hidden bg-slate-800 py-4 px-4 absolute w-full border-b border-slate-700">
          <div className="flex justify-between items-center mb-4">
            <div className="text-white font-mono text-lg font-semibold">
              ${currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className={`text-sm font-mono ${isPriceUp ? 'text-green-400' : 'text-red-400'}`}>
              {isPriceUp ? '+' : ''}{priceChange.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 
              ({isPriceUp ? '+' : ''}{priceChangePercent.toFixed(2)}%)
            </div>
          </div>
          
          <a 
            href="https://github.com/yourusername/btc-trading-dashboard" 
            target="_blank" 
            rel="noopener noreferrer"
            className="block py-2 text-gray-400 hover:text-white transition-colors"
          >
            <div className="flex items-center">
              <Github size={18} className="mr-2" />
              <span>GitHub Repository</span>
            </div>
          </a>
        </div>
      )}
    </header>
  );
};

export default Header;