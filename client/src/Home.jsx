import { useState, useEffect } from 'react';
import './Home.css';

const API_BASE = '';

const DEFAULT_ROLES = [
  { id: 'vp-sales', label: 'VP of Sales' },
  { id: 'vp-ta', label: 'VP of TA' },
  { id: 'account-executive', label: 'Account Executive' },
];

export default function Home({ onStart, recoveryData, onRecoveryStart, onRecoveryClear }) {
  const [roles, setRoles] = useState(DEFAULT_ROLES);
  const [selectedRole, setSelectedRole] = useState('vp-sales');
  const [rolesLoading, setRolesLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/api/roles`)
      .then((r) => r.ok ? r.json() : Promise.resolve({ roles: [] }))
      .then((data) => {
        if (data.roles?.length) {
          setRoles(data.roles);
          if (!data.roles.some((r) => r.id === selectedRole)) setSelectedRole(data.roles[0].id);
        }
      })
      .catch(() => {})
      .finally(() => setRolesLoading(false));
  }, []);

  const handleStart = () => onStart(selectedRole);

  return (
    <div className="home">
      <header className="home-header">
        <h1>Live Interview Evaluation</h1>
        <p className="subtitle">Real-time rubric scoring and follow-up suggestions</p>
      </header>

      <section className="role-selector">
        <h2>Choose role to evaluate</h2>
        {rolesLoading ? (
          <p className="muted">Loading roles…</p>
        ) : (
          <div className="role-options">
            {roles.map((r) => (
              <label key={r.id} className={`role-card ${selectedRole === r.id ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="role"
                  value={r.id}
                  checked={selectedRole === r.id}
                  onChange={() => setSelectedRole(r.id)}
                />
                <span className="role-label">{r.label}</span>
              </label>
            ))}
          </div>
        )}
      </section>

      <section className="instructions">
        <h2>Instructions for the interviewer</h2>
        <ul>
          <li><strong>Before starting:</strong> Choose your audio source (mic, meeting tab, or both). For video calls, share the meeting tab with &quot;Share tab audio&quot; checked so the candidate&apos;s voice is captured.</li>
          <li><strong>Suggested questions:</strong> Use the list on the right to go deeper—ask behavioral and situational questions so the candidate can demonstrate real experience.</li>
          <li><strong>Live evaluation:</strong> Scores, strengths, red flags, and current impression update as you talk. Use them to guide follow-ups.</li>
          <li><strong>End interview:</strong> Click &quot;End Interview&quot; when done. The full report is generated and you can download it as a PDF file.</li>
        </ul>
      </section>

      {recoveryData && (
        <div className="recovery-banner">
          <p><strong>Your last interview didn’t finish.</strong> The transcript was saved. You can generate the report now or clear it.</p>
          <div className="recovery-banner-actions">
            <button type="button" className="btn btn-primary" onClick={onRecoveryStart}>
              Generate report
            </button>
            <button type="button" className="btn btn-secondary" onClick={onRecoveryClear}>
              Clear
            </button>
          </div>
        </div>
      )}

      <button className="btn-start" onClick={handleStart}>
        Start Interview
      </button>
    </div>
  );
}
