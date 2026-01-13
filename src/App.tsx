import React, { useEffect } from 'react';
import Dashboard from './components/Dashboard/Dashboard';
import { initializePredictionService, cleanupPredictionService } from './services/predictionService';

function App() {
  useEffect(() => {
    // Initialize the global prediction service when the app starts
    initializePredictionService();

    // Cleanup when the app unmounts
    return () => {
      cleanupPredictionService();
    };
  }, []);

  return (
    <div className="h-screen bg-[#2a2a2a] overflow-hidden">
      <main className="h-full">
        <Dashboard />
      </main>
    </div>
  );
}

export default App;