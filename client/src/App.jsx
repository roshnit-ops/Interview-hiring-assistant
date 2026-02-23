import { useState, useEffect } from 'react';
import Home from './Home';
import Interview, { getPendingReport, clearPendingReport } from './Interview';

export default function App() {
  const [started, setStarted] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState(null);
  const [recoveryData, setRecoveryData] = useState(null);

  useEffect(() => {
    const pending = getPendingReport();
    if (pending) setRecoveryData(pending);
  }, []);

  const handleStart = (email) => {
    setRecipientEmail(email || null);
    setRecoveryData(null);
    setStarted(true);
  };

  const handleRecoveryStart = () => {
    setStarted(true);
  };

  const handleRecoveryClear = () => {
    clearPendingReport();
    setRecoveryData(null);
  };

  const handleEnd = () => {
    setStarted(false);
    const pending = getPendingReport();
    if (pending) setRecoveryData(pending);
  };

  return started ? (
    <Interview
      recipientEmail={recipientEmail}
      onEnd={handleEnd}
      recoveryData={recoveryData || undefined}
    />
  ) : (
    <Home
      onStart={handleStart}
      recoveryData={recoveryData}
      onRecoveryStart={handleRecoveryStart}
      onRecoveryClear={handleRecoveryClear}
    />
  );
}
