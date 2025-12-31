import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import axios from 'axios';
import './App.css';

function App() {
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);

  const [savedRange, setSavedRange] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');

  const [showHeaderInfo, setShowHeaderInfo] = useState(false);

  const SHEET_ID = '4J6P6H6gfxpgCGWmx5gm8GvJH3FX3xHr87m2CxC1';
  const BACKEND_URL = 'http://localhost:3000';

  // ===================== LOAD GLOBAL SYNC STATUS =====================
  const loadSyncStatus = async () => {
    try {
      const res = await axios.get(`${BACKEND_URL}/sync-status`);

      if (res.data?.lastUpdated) {
        setLastUpdated(res.data.lastUpdated);
        setShowHeaderInfo(true);

        if (res.data.type === 'MANUAL' && res.data.range) {
          setSavedRange(res.data.range);
        } else {
          setSavedRange(null);
        }
      }
    } catch (err) {
      console.error('Failed to load sync status');
    }
  };

  // Load on app start
  useEffect(() => {
    loadSyncStatus();
    setStartDate(null);
    setEndDate(null);
  }, []);

  // Auto refresh every 5 minutes
  useEffect(() => {
    const timer = setInterval(loadSyncStatus, 300000);
    return () => clearInterval(timer);
  }, []);

  // ===================== PROGRESS BAR =====================
  useEffect(() => {
    if (!loading) return;

    setProgress(10);
    const timer = setInterval(() => {
      setProgress(p => (p < 90 ? p + 10 : p));
    }, 600);

    return () => clearInterval(timer);
  }, [loading]);

  // ===================== MANUAL UPDATE =====================
  const handleUpdate = async () => {
    if (!startDate || !endDate) {
      setStatus('❗ Please select both start and end dates');
      return;
    }

    if (startDate > endDate) {
      setStatus('❗ From date must be before To date');
      return;
    }

    setLoading(true);
    setStatus('');

    try {
      await axios.post(
        `${BACKEND_URL}/getdays`,
        {
          startDate: format(startDate, 'yyyy-MM-dd'),
          endDate: format(endDate, 'yyyy-MM-dd'),
        },
        { headers: { 'Content-Type': 'application/json' } }
      );

      await loadSyncStatus();

      setStatus('Data updated successfully. Please open and verify the Smartsheet.');
    } catch (err) {
      console.error(err);
      setStatus('Update failed. Please check backend.');
    } finally {
      setTimeout(() => {
        setLoading(false);
        setProgress(0);
      }, 800);
    }
  };

  // ===================== OPEN SMARTSHEET =====================
  const handleOpenSmartsheet = () => {
    window.open(
      `https://app.smartsheet.com/sheets/${SHEET_ID}?view=grid`,
      '_blank',
      'noopener,noreferrer'
    );
    setStatus('');
  };

  // ===================== CLEAR =====================
  const handleClear = async () => {
    if (!startDate || !endDate) {
      setStatus('❗ Please select a date range to clear');
      return;
    }

    const confirmDelete = window.confirm(
      `⚠️ This will DELETE Smartsheet data from\n\n${format(
        startDate,
        'dd MMM yyyy'
      )} → ${format(endDate, 'dd MMM yyyy')}\n\nDo you want to continue?`
    );

    if (!confirmDelete) return;

    setLoading(true);
    setStatus('');

    try {
      const res = await axios.delete(`${BACKEND_URL}/delete-date-range`, {
        data: {
          startDate: format(startDate, 'yyyy-MM-dd'),
          endDate: format(endDate, 'yyyy-MM-dd'),
        },
      });

      setStatus(`${res.data.deleted || 0} rows deleted from Smartsheet.`);
    } catch (err) {
      console.error(err);
      setStatus('Failed to delete data from Smartsheet.');
    } finally {
      setLoading(false);
      setProgress(0);
    }
  };

  const statusClass =
    status.includes('❌') || status.includes('❗') ? 'error' : 'success';

  return (
    <>
      {/* ================= HEADER ================= */}
      <header className="header">
        <div className="header-logo">
          <img
            src="/src/assets/SuprajitLogo.png"
            alt="Suprajit Logo"
            className="company-logo"
          />
        </div>

        <div className="header-title">
          <h1>Suprajit Engineering Limited Attendance Tracker</h1>
          <p className="header-subtitle">
            Enterprise Attendance Management System
          </p>
        </div>

        {showHeaderInfo && (
          <>
            <div className="header-info-row">
              <div className="header-info-panel">
                <div className="info-item">
                  <span>Last Updated:</span>
                  <strong>
                    {format(new Date(lastUpdated), 'dd MMM yyyy, HH:mm')}
                  </strong>
                </div>
              </div>

              {savedRange && (
                <div className="header-info-panel">
                  <div className="info-item">
                    <span>Date Range:</span>
                    <strong>
                      {format(new Date(savedRange.start), 'dd MMM yyyy')} →{' '}
                      {format(new Date(savedRange.end), 'dd MMM yyyy')}
                    </strong>
                  </div>
                </div>
              )}
            </div>

            <div className="header-note-panel">
              <small>
                <strong>Note:</strong> Attendance data is automatically updated
                every day at <strong>10:00 AM</strong> and{' '}
                <strong>10:00 PM</strong>. Select a date range to manually update
                attendance data if required.
              </small>
            </div>
          </>
        )}
      </header>

      {/* ================= MAIN ================= */}
      <main className="main">
        <div className="form-container">
          <div className="date-row">
            <div className="field">
              <label>From Date</label>
              <input
                type="date"
                value={startDate ? format(startDate, 'yyyy-MM-dd') : ''}
                onChange={e =>
                  setStartDate(e.target.value ? new Date(e.target.value) : null)
                }
              />
            </div>

            <div className="field">
              <label>To Date</label>
              <input
                type="date"
                value={endDate ? format(endDate, 'yyyy-MM-dd') : ''}
                onChange={e =>
                  setEndDate(e.target.value ? new Date(e.target.value) : null)
                }
              />
            </div>
          </div>

          <div className="button-group">
            <button
              className="update-btn"
              onClick={handleUpdate}
              disabled={loading}
            >
              {loading ? 'Updating...' : 'Update Data'}
            </button>

            <button
              className="open-sheet-btn"
              onClick={handleOpenSmartsheet}
            >
              Open Smartsheet
            </button>

            <button
              className="clear-btn"
              onClick={handleClear}
              disabled={loading}
            >
              Clear
            </button>
          </div>

          {loading && (
            <div className="progress-section">
              <div className="progress-label">Processing</div>
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="progress-text">{progress}%</div>
            </div>
          )}

          {status && (
            <div className={`status ${statusClass}`}>
              {status}
            </div>
          )}
        </div>
      </main>
    </>
  );
}

export default App;
