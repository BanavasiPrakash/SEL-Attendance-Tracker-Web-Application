// ======================= IMPORTS =======================
const cron = require('node-cron');
const express = require('express');
const axios = require('axios');
const sql = require('mssql');
const cors = require('cors');

// ======================= APP SETUP =======================
const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

// ======================= CONFIG =======================
const CONFIG = {
  PORT: 3000,
  SHEET_ID: '4J6P6H6gfxpgCGWmx5gm8GvJH3FX3xHr87m2CxC1',
  API_TOKEN: 'cjwFTOnosztE445MUWkPPDhii6JaLHpSWdZRZ',
  DB_SERVER: '192.168.0.10',
  DB_USER: 'sa',
  DB_PASS: 'suprajit@123',
};

// ======================= GLOBAL SYNC STATE =======================
let LAST_SYNC_INFO = {
  lastUpdated: null, // ISO string
  type: null,        // 'AUTO' | 'MANUAL'
  range: null        // { start, end } for manual sync
};

// ======================= DB CONFIG =======================
const dbConfig = {
  user: CONFIG.DB_USER,
  password: CONFIG.DB_PASS,
  server: CONFIG.DB_SERVER,
  database: 'master',
  options: { trustServerCertificate: true },
};

// ======================= DATE HELPERS =======================
function parseDDMMYYYY(value) {
  if (!value || typeof value !== 'string') return null;
  const [dd, mm, yyyy] = value.split('/').map(Number);
  if (!dd || !mm || !yyyy) return null;
  return new Date(Date.UTC(yyyy, mm - 1, dd));
}

function normalizeDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().split('T')[0];

  if (typeof value === 'string') {
    if (value.includes('/')) {
      const parsed = parseDDMMYYYY(value);
      if (parsed) return parsed.toISOString().split('T')[0];
    }
    const d = new Date(value);
    if (!isNaN(d)) return d.toISOString().split('T')[0];
  }
  return null;
}

function formatDateIST(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

// ======================= READ EXISTING SMARTSHEET KEYS =======================
async function getExistingKeysFromSheet() {
  const res = await axios.get(
    `https://api.smartsheet.com/2.0/sheets/${CONFIG.SHEET_ID}`,
    { headers: { Authorization: `Bearer ${CONFIG.API_TOKEN}` } }
  );

  const { rows, columns } = res.data;
  const empIdCol = columns.find(c => c.title.trim().toLowerCase() === 'empid');
  const dateCol = columns.find(c => c.title.trim().toLowerCase() === 'date');

  const keys = new Set();
  for (const row of rows) {
    const empId = row.cells.find(c => c.columnId === empIdCol.id)?.value;
    const rawDate = row.cells.find(c => c.columnId === dateCol.id)?.value;
    const normalized = normalizeDate(rawDate);
    if (empId && normalized) keys.add(`${empId}_${normalized}`);
  }
  return keys;
}

// ======================= FETCH SQL DATA =======================
async function fetchSQLData(startDate, endDate) {
  const pool = await sql.connect({ ...dbConfig, database: 'iAS_Web_Suprajit' });
  try {
    const result = await pool.query(`
      SELECT 
        e.PAYCODE AS EmpId,
        LTRIM(RTRIM(e.EMPNAME)) AS EmpName,
        CONVERT(date, t.DateOFFICE) AS [Date],
        FORMAT(t.IN1, 'HH:mm:ss') AS IN_Time,
        CASE WHEN t.OUT2 IS NULL THEN 'IN-PROGRESS'
             ELSE FORMAT(t.OUT2, 'HH:mm:ss') END AS Out_Time,
        COALESCE(t.STATUS, 'ACTIVE') AS STATUS,
        CASE 
          WHEN t.OUT2 IS NULL THEN 'IN-PROGRESS'
          ELSE RIGHT('0' + CAST(DATEDIFF(MINUTE, t.IN1, t.OUT2) / 60 AS VARCHAR), 2)
               + ':' +
               RIGHT('0' + CAST(DATEDIFF(MINUTE, t.IN1, t.OUT2) % 60 AS VARCHAR), 2)
        END AS WorkingHours
      FROM tblemployee e
      INNER JOIN tbltimeregister t ON e.PAYCODE = t.PAYCODE
      WHERE e.COMPANYCODE = 'SEL'
        AND e.DepartmentCode = 'CRP'
        AND CONVERT(date, t.DateOFFICE) BETWEEN '${startDate}' AND '${endDate}'
        AND t.IN1 IS NOT NULL
      ORDER BY t.DateOFFICE DESC;
    `);

    const unique = new Map();
    result.recordset.forEach(r => {
      const key = `${r.EmpId}_${normalizeDate(r.Date)}`;
      if (!unique.has(key)) unique.set(key, r);
    });

    return Array.from(unique.values());
  } finally {
    await pool.close();
  }
}

// ======================= UPLOAD TO SMARTSHEET =======================
async function batchUpload(columns, records) {
  const writableCols = columns.filter(c => !c.formula);

  for (let i = 0; i < records.length; i += 50) {
    const chunk = records.slice(i, i + 50).map(r => ({
      cells: writableCols.map(col => {
        let value = r[col.title.replace(/ /g, '')] || r[col.title] || '';
        if (col.title.trim().toLowerCase() === 'date') {
          value = formatDateIST(r.Date);
        }
        return { columnId: col.id, value };
      })
    }));

    await axios.post(
      `https://api.smartsheet.com/2.0/sheets/${CONFIG.SHEET_ID}/rows`,
      chunk,
      { headers: { Authorization: `Bearer ${CONFIG.API_TOKEN}` } }
    );
    await new Promise(r => setTimeout(r, 800));
  }
}

// ======================= MAIN SYNC =======================
async function syncEmployeeData(startDate, endDate) {
  const sheet = await axios.get(
    `https://api.smartsheet.com/2.0/sheets/${CONFIG.SHEET_ID}`,
    { headers: { Authorization: `Bearer ${CONFIG.API_TOKEN}` } }
  );

  const sqlData = await fetchSQLData(startDate, endDate);
  const existingKeys = await getExistingKeysFromSheet();

  const newRows = sqlData.filter(r =>
    !existingKeys.has(`${r.EmpId}_${normalizeDate(r.Date)}`)
  );

  if (newRows.length) {
    await batchUpload(sheet.data.columns, newRows);
  }

  return { inserted: newRows.length, skipped: sqlData.length - newRows.length };
}

// ======================= ROUTES =======================

// MANUAL SYNC
app.post('/getdays', async (req, res) => {
  const { startDate, endDate } = req.body;
  try {
    const result = await syncEmployeeData(startDate, endDate);

    LAST_SYNC_INFO = {
      lastUpdated: new Date().toISOString(),
      type: 'MANUAL',
      range: { start: startDate, end: endDate }
    };

    res.json({
      success: true,
      ...result,
      lastUpdated: LAST_SYNC_INFO.lastUpdated
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE RANGE
app.delete('/delete-date-range', async (req, res) => {
  res.json({ success: true, deleted: 0 });
});

// SYNC STATUS (GLOBAL)
app.get('/sync-status', (req, res) => {
  res.json(LAST_SYNC_INFO);
});

// ======================= AUTO SYNC =======================
const runAutoSync = async (label) => {
  const today = new Date().toISOString().split('T')[0];
  await syncEmployeeData(today, today);

  LAST_SYNC_INFO = {
    lastUpdated: new Date().toISOString(),
    type: 'AUTO',
    range: null
  };

  console.log(`Auto Sync SUCCESS - ${label}`);
};

cron.schedule('0 10 * * *', () => runAutoSync('10:00 AM IST'), {
  timezone: 'Asia/Kolkata'
});

cron.schedule('0 22 * * *', () => runAutoSync('10:00 PM IST'), {
  timezone: 'Asia/Kolkata'
});

// ======================= SERVER START =======================
app.listen(CONFIG.PORT, () => {
  console.log(`Backend running on http://localhost:${CONFIG.PORT}`);
  console.log('GLOBAL Auto + Manual Sync READY');
});
