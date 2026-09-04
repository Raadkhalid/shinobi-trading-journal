import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BarChart3, TrendingUp, TrendingDown, DollarSign, Target, Plus, Upload, Download, Eye, EyeOff, Edit2, Trash2, Activity, Award, CheckCircle, XCircle, Clock, ChevronLeft, ChevronRight, Loader2, CloudOff, ArrowUpDown, ArrowUp, ArrowDown, Sun, Moon, LogOut, Tag, Filter, BookOpen, Smile, Meh, Frown, LayoutDashboard, Settings, Zap, ChevronDown, PanelLeftClose, PanelLeft, Menu, Calendar, Coffee, Search, Calculator, Share2, MessageSquare } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from 'recharts';
import { AuthProvider, useAuth, supabase } from './AuthContext';
import { LoginScreen, SignupScreen, VerifyScreen, ForgotPasswordScreen, ResetPasswordScreen, CompleteProfileScreen, ProfileScreen } from './AuthScreens';
import { LandingScreen } from './LandingPage';

// Preset tags for trades
const PRESET_TAGS = [
  { name: 'Breakout', color: 'bg-orange-500' },
  { name: 'Reversal', color: 'bg-purple-500' },
  { name: 'Trend', color: 'bg-green-500' },
  { name: 'Scalp', color: 'bg-yellow-500' },
  { name: 'Swing', color: 'bg-amber-500' },
  { name: 'News', color: 'bg-red-500' },
  { name: 'FOMO', color: 'bg-orange-500' },
  { name: 'Revenge', color: 'bg-rose-500' },
  { name: 'A+ Setup', color: 'bg-emerald-500' },
  { name: 'B Setup', color: 'bg-teal-500' },
  { name: 'C Setup', color: 'bg-stone-500' },
];

/*
============================================
SUPABASE TABLE SETUP - Run in SQL Editor
============================================
-- See AuthContext.jsx for Supabase configuration
-- Run the profiles and trades SQL from the setup instructions
============================================
*/

// Main App Component (wrapped with AuthProvider)
export default function TradingJournalApp() {
  return (
    <AuthProvider>
      <TradingJournalMain />
    </AuthProvider>
  );
}

// Convert a database trade row to frontend format
const dbToFrontend = (row) => ({
  id: row.id,
  date: row.date,
  pair: row.pair,
  direction: row.direction,
  entry: parseFloat(row.entry) || 0,
  sl: parseFloat(row.sl) || 0,
  tp: parseFloat(row.tp) || 0,
  lotSize: parseFloat(row.lot_size) || 0,
  risk: parseFloat(row.risk) || 2,
  outcome: row.outcome,
  profit: parseFloat(row.profit) || 0,
  session: row.session,
  preNotes: row.pre_notes,
  postNotes: row.post_notes,
  emotion: row.emotion,
  rulesFollowed: row.rules_followed,
  openedAt: row.opened_at,
  closedAt: row.closed_at,
  screenshot: row.screenshot,
  screenshotAfter: row.screenshot_after,
  tags: row.tags || []
});

// Risk:Reward ratio from entry/SL/TP - null when it can't be computed (missing
// values, or SL sitting exactly on entry). Direction doesn't matter: SL/TP are
// already on the correct sides of entry for a valid trade either way.
const getRiskReward = (trade) => {
  const entry = parseFloat(trade?.entry) || 0;
  const sl = parseFloat(trade?.sl) || 0;
  const tp = parseFloat(trade?.tp) || 0;
  if (!entry || !sl || !tp) return null;
  const risk = Math.abs(entry - sl);
  const reward = Math.abs(tp - entry);
  if (risk <= 0) return null;
  return reward / risk;
};

const formatRR = (rr) => (rr === null || rr === undefined) ? '—' : `1:${rr.toFixed(2)}`;

// ============================================
// BROKER IMPORT PARSERS
// Turns an exported statement (MT4/MT5 HTML report, TradingView order CSV,
// or any generic CSV) into trade objects shaped like dbToFrontend's output.
// ============================================

const parseNum = (str) => {
  if (str === null || str === undefined) return 0;
  const cleaned = String(str).replace(/[^0-9.-]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
};

const normalizeKey = (str) => String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const guessSession = (hour) => {
  if (hour >= 0 && hour < 7) return 'Asia';
  if (hour >= 7 && hour < 12) return 'London';
  if (hour >= 12 && hour < 20) return 'New York';
  return 'Sydney';
};

// Quote-aware single-line CSV splitter (handles "fields, with commas")
const splitCsvLine = (line) => {
  const values = [];
  let current = '';
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') { inQuotes = !inQuotes; }
    else if (char === ',' && !inQuotes) { values.push(current.trim()); current = ''; }
    else { current += char; }
  }
  values.push(current.trim());
  return values;
};

// Parses delimited text into {headers (normalized), rows (array of objects keyed by header)}
const parseDelimitedTable = (text) => {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = splitCsvLine(lines[0]).map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = splitCsvLine(lines[i]);
    if (values.length < 2) continue;
    const row = {};
    headers.forEach((h, idx) => { row[h] = values[idx] || ''; });
    rows.push(row);
  }
  return { headers, rows };
};

// MT4/MT5 "Save as Report" statement (.htm/.html export from the Account History tab).
// Column names/order vary slightly by broker template, so this finds the closed-trades
// table by matching known header keywords rather than assuming fixed positions.
const parseMT4Statement = (html) => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const tables = Array.from(doc.querySelectorAll('table'));
  const KEY_ALIASES = {
    opentime: ['opentime'],
    closetime: ['closetime'],
    type: ['type'],
    size: ['size', 'lots', 'volume', 'lotsize'],
    item: ['item', 'symbol'],
    sl: ['sl'],
    tp: ['tp'],
    commission: ['commission'],
    taxes: ['taxes'],
    swap: ['swap'],
    profit: ['profit'],
  };

  for (const table of tables) {
    const rows = Array.from(table.querySelectorAll('tr'));
    for (let r = 0; r < rows.length; r++) {
      const cells = Array.from(rows[r].querySelectorAll('td, th')).map(c => c.textContent.trim());
      const normCells = cells.map(normalizeKey);
      const colIndex = {};
      const priceIndices = [];
      normCells.forEach((nc, idx) => {
        if (nc === 'price') { priceIndices.push(idx); return; }
        for (const key in KEY_ALIASES) {
          if (KEY_ALIASES[key].includes(nc) && colIndex[key] === undefined) colIndex[key] = idx;
        }
      });
      // Require the markers that uniquely identify the *closed trades* header row
      if (colIndex.opentime === undefined || colIndex.closetime === undefined ||
          colIndex.type === undefined || colIndex.profit === undefined || priceIndices.length === 0) {
        continue;
      }
      colIndex.openPrice = priceIndices[0];
      colIndex.closePrice = priceIndices.length > 1 ? priceIndices[1] : undefined;

      // Found the header row - walk subsequent rows in this table until they stop matching
      const trades = [];
      for (let d = r + 1; d < rows.length; d++) {
        const dCells = Array.from(rows[d].querySelectorAll('td')).map(c => c.textContent.trim());
        if (dCells.length <= Math.max(colIndex.closetime, colIndex.profit, colIndex.type)) continue;

        const typeText = (dCells[colIndex.type] || '').toLowerCase();
        if (!typeText.startsWith('buy') && !typeText.startsWith('sell')) continue; // skip balance/credit/pending rows
        const closeTimeText = dCells[colIndex.closetime];
        if (!closeTimeText || !/\d/.test(closeTimeText)) continue; // still-open position, no close time

        const parseMT4DateTime = (s) => {
          if (!s) return null;
          const [datePart, timePart] = s.trim().split(' ');
          if (!datePart) return null;
          const iso = datePart.replace(/\./g, '-');
          return `${iso}T${timePart || '00:00:00'}`;
        };

        const openedAt = parseMT4DateTime(dCells[colIndex.opentime]);
        const closedAt = parseMT4DateTime(dCells[colIndex.closetime]);
        const profit = parseNum(dCells[colIndex.profit]) +
          (colIndex.commission !== undefined ? parseNum(dCells[colIndex.commission]) : 0) +
          (colIndex.swap !== undefined ? parseNum(dCells[colIndex.swap]) : 0) +
          (colIndex.taxes !== undefined ? parseNum(dCells[colIndex.taxes]) : 0);
        const closedHour = closedAt ? parseInt(closedAt.split('T')[1]) : 0;

        trades.push({
          date: closedAt ? closedAt.split('T')[0] : (openedAt ? openedAt.split('T')[0] : new Date().toISOString().split('T')[0]),
          pair: (dCells[colIndex.item] || '').toUpperCase().replace(/[^A-Z0-9]/g, ''),
          direction: typeText.includes('sell') ? 'sell' : 'buy',
          entry: parseNum(dCells[colIndex.openPrice]),
          sl: colIndex.sl !== undefined ? parseNum(dCells[colIndex.sl]) : 0,
          tp: colIndex.tp !== undefined ? parseNum(dCells[colIndex.tp]) : 0,
          lotSize: colIndex.size !== undefined ? parseNum(dCells[colIndex.size]) : 0,
          profit,
          outcome: profit > 0 ? 'win' : profit < 0 ? 'loss' : null,
          session: guessSession(closedHour),
          preNotes: '',
          postNotes: '',
          emotion: 'Neutral',
          rulesFollowed: true,
          tags: [],
          openedAt,
          closedAt,
        });
      }
      if (trades.length > 0) return trades;
    }
  }
  return [];
};

// TradingView's "Trade History" CSV export is an ORDER log (Side, Qty, Fill Price, Placing
// Time, Closing Time...), not a trade log - it has no profit column at all, and each
// bracket order (entry + stop-loss + take-profit) shows as 3 separate rows sharing the same
// Placing Time. This reconstructs trade pairs (entry fill + exit fill) and pulls entry/exit/
// SL/TP/timing directly from the file, but leaves profit unset - the file simply doesn't
// contain it, and guessing would risk showing a wrong dollar figure in someone's journal.
const parseTradingViewOrders = (text) => {
  const { headers, rows } = parseDelimitedTable(text);
  const hasCol = (name) => headers.includes(name);
  if (!hasCol('side') || !hasCol('symbol') || !hasCol('fill price') || !hasCol('placing time') || !hasCol('closing time')) {
    return null; // not a TradingView export
  }

  const groups = {};
  rows.forEach(row => {
    const key = `${row.symbol}|${row['placing time']}`;
    (groups[key] = groups[key] || []).push(row);
  });

  const trades = [];
  Object.values(groups).forEach(group => {
    const filled = group.filter(r => (r.status || '').toLowerCase() === 'filled' && r['fill price']);
    if (filled.length !== 2) return; // ambiguous (manual close, partial fill, scale-in) - skip rather than guess
    filled.sort((a, b) => new Date(a['closing time']) - new Date(b['closing time']));
    const [entryRow, exitRow] = filled;

    const slRow = group.find(r => r.side !== entryRow.side && (r.type || '').toLowerCase() === 'stop');
    const tpRow = group.find(r => r.side !== entryRow.side && (r.type || '').toLowerCase() === 'limit');

    const openedAt = entryRow['closing time'] ? entryRow['closing time'].replace(' ', 'T') : null;
    const closedAt = exitRow['closing time'] ? exitRow['closing time'].replace(' ', 'T') : null;
    const openedHour = openedAt ? parseInt(openedAt.split('T')[1]) : 0;

    trades.push({
      date: closedAt ? closedAt.split('T')[0] : (openedAt ? openedAt.split('T')[0] : new Date().toISOString().split('T')[0]),
      pair: (entryRow.symbol || '').split(':').pop().toUpperCase().replace(/[^A-Z0-9]/g, ''),
      direction: (entryRow.side || '').toLowerCase() === 'sell' ? 'sell' : 'buy',
      entry: parseNum(entryRow['fill price']),
      sl: slRow ? parseNum(slRow['stop price'] || slRow['fill price']) : 0,
      tp: tpRow ? parseNum(tpRow['limit price'] || tpRow['fill price']) : 0,
      lotSize: parseNum(entryRow.qty),
      profit: 0,
      outcome: null,
      session: guessSession(openedHour),
      preNotes: '',
      postNotes: '',
      emotion: 'Neutral',
      rulesFollowed: true,
      tags: [],
      openedAt,
      closedAt,
      plUnknown: true,
    });
  });
  return trades;
};

// Generic fallback: loosely-named CSV/backup export from any source (or our own CSV export)
const parseGenericCsv = (text) => {
  const { rows } = parseDelimitedTable(text);
  const trades = [];

  rows.forEach(row => {
    const trade = {
      date: row.date || row['close date'] || row['open date'] || row['close time']?.split(' ')[0] || row['open time']?.split(' ')[0] || row['closing time']?.split(' ')[0] || row['placing time']?.split(' ')[0] || new Date().toISOString().split('T')[0],
      pair: (row.pair || row.symbol || row.instrument || row.asset || '').toUpperCase().replace(/[^A-Z0-9]/g, ''),
      direction: (row.direction || row.type || row.side || row.action || 'buy').toLowerCase().includes('sell') ? 'sell' : 'buy',
      entry: parseNum(row.entry || row['entry price'] || row['open price'] || row['fill price'] || row.open || 0),
      sl: parseNum(row.sl || row['stop loss'] || row.stoploss || row['stop price'] || 0),
      tp: parseNum(row.tp || row['take profit'] || row.takeprofit || row['limit price'] || 0),
      lotSize: parseNum(row['lot size'] || row.lots || row.lot || row.volume || row.size || row.quantity || row.qty || 0),
      profit: parseNum(row.profit || row.pnl || row['p&l'] || row['profit/loss'] || row.result || row.net || row['closing pnl'] || 0),
      session: row.session || 'London',
      outcome: null,
      preNotes: row.notes || row.comment || row.comments || '',
      postNotes: '',
      emotion: 'Neutral',
      rulesFollowed: true,
      tags: []
    };

    if (trade.profit > 0) trade.outcome = 'win';
    else if (trade.profit < 0) trade.outcome = 'loss';

    const timeStr = row.time || row['open time'] || row['close time'] || '';
    if (timeStr) {
      const hour = parseInt(timeStr.split(':')[0]) || parseInt(timeStr.split(' ')[1]?.split(':')[0]) || 0;
      trade.session = guessSession(hour);
    }

    if (trade.date && !trade.date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      try {
        const d = new Date(trade.date);
        if (!isNaN(d.getTime())) trade.date = d.toISOString().split('T')[0];
      } catch(e) {}
    }

    if (trade.pair) trades.push(trade);
  });

  return trades;
};

// Half-circle "speedometer" gauge, split green (win portion) / red (loss portion) - always two-tone
const HalfGauge = ({ pct, size = 76 }) => {
  const r = 42, cx = 55, cy = 50, sw = 7;
  const circumference = Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct || 0));
  const offset = circumference * (1 - clamped / 100);
  const d = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  return (
    <svg viewBox="0 0 110 58" style={{ width: size }} className="h-auto block mx-auto">
      {/* Full arc in red first - the green overlay below covers the winning portion, leaving red visible for the rest */}
      <path d={d} fill="none" stroke="#ef4444" strokeWidth={sw} strokeLinecap="round" />
      <path
        d={d}
        fill="none"
        stroke="#10b981"
        strokeWidth={sw}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        style={{ transition: 'stroke-dashoffset 0.5s ease' }}
      />
    </svg>
  );
};

// Full-circle radial gauge, e.g. for Profit Factor
const CircleGauge = ({ pct, color, trackColor, size = 46, strokeWidth = 6 }) => {
  const r = (size - strokeWidth) / 2;
  const cx = size / 2, cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct || 0));
  const offset = circumference * (1 - clamped / 100);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={trackColor} strokeWidth={strokeWidth} />
      <circle
        cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={strokeWidth}
        strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset}
        style={{ transition: 'stroke-dashoffset 0.5s ease' }}
      />
    </svg>
  );
};

// Click-through spotlight tour: highlights one real element per step with a pointing
// tooltip (Next/Back/Skip), runs once per tab on first visit, remembered via localStorage.
// Steps with no `target` render as a centered welcome card instead of a spotlight.
const TourGuide = ({ tourKey, steps, darkMode }) => {
  const storageKey = `tj-tour-v2-${tourKey}`;
  const [active, setActive] = useState(() => {
    try { return localStorage.getItem(storageKey) !== '1'; } catch { return false; }
  });
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState(null);

  const finish = () => {
    try { localStorage.setItem(storageKey, '1'); } catch {}
    setActive(false);
  };

  useEffect(() => {
    if (!active) return;
    const step = steps[stepIndex];
    if (!step) { finish(); return; }
    if (!step.target) { setRect(null); return; }

    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      const el = document.querySelector(step.target);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    const el = document.querySelector(step.target);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const t = setTimeout(measure, 350);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      cancelled = true;
      clearTimeout(t);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, stepIndex]);

  if (!active) return null;
  const step = steps[stepIndex];
  if (!step) return null;
  const isLast = stepIndex === steps.length - 1;

  const cardW = 300;
  let cardStyle = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
  if (rect) {
    const margin = 14;
    let top = rect.bottom + margin;
    if (top + 180 > window.innerHeight) top = Math.max(margin, rect.top - 180 - margin);
    let left = Math.min(Math.max(rect.left, margin), window.innerWidth - cardW - margin);
    cardStyle = { top, left };
  }

  return (
    <>
      {rect && (
        <div
          className="fixed pointer-events-none z-[9998] rounded-xl border-2 border-orange-500 transition-all duration-300"
          style={{
            top: rect.top - 6, left: rect.left - 6,
            width: rect.width + 12, height: rect.height + 12,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.65)',
          }}
        />
      )}
      {!rect && <div className="fixed inset-0 z-[9998]" style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.65)' }} />}
      <div
        className={`fixed z-[9999] rounded-2xl p-5 shadow-2xl transition-all duration-300 ${darkMode ? 'bg-[#1c1611] border border-orange-300/20' : 'bg-white border border-orange-200'}`}
        style={{ width: cardW, ...cardStyle }}
      >
        <p className={`text-xs font-semibold mb-1 ${darkMode ? 'text-orange-400' : 'text-orange-600'}`}>
          Step {stepIndex + 1} of {steps.length}
        </p>
        <h4 className={`font-bold mb-1.5 ${darkMode ? 'text-white' : 'text-stone-900'}`}>{step.title}</h4>
        <p className={`text-sm ${isLast ? 'mb-2' : 'mb-4'} ${darkMode ? 'text-stone-300' : 'text-stone-600'}`}>{step.body}</p>
        {isLast && (
          <p className={`text-xs mb-4 ${darkMode ? 'text-stone-500' : 'text-stone-400'}`}>
            You can replay this tutorial anytime from Settings.
          </p>
        )}
        <div className="flex items-center justify-between gap-2">
          <button onClick={finish} className={`text-xs font-medium ${darkMode ? 'text-stone-500 hover:text-stone-300' : 'text-stone-400 hover:text-stone-600'}`}>
            Skip tour
          </button>
          <div className="flex gap-2">
            {stepIndex > 0 && (
              <button
                onClick={() => setStepIndex(i => i - 1)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${darkMode ? 'bg-white/10 text-stone-300 hover:bg-white/20' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'}`}
              >
                Back
              </button>
            )}
            <button
              onClick={() => isLast ? finish() : setStepIndex(i => i + 1)}
              className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-gradient-to-r from-orange-600 to-amber-600 text-white hover:from-orange-500 hover:to-amber-500"
            >
              {isLast ? 'Finish' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

// Main Journal Component
function TradingJournalMain() {
  const { user, profile, loading: authLoading, profileLoading, passwordRecovery, signOut } = useAuth();
  const [authView, setAuthView] = useState('landing');
  const [verifyEmail, setVerifyEmail] = useState('');
  
  const [activeTab, setActiveTab] = useState('dashboard');
  const [trades, setTrades] = useState([]);
  const [showAddTrade, setShowAddTrade] = useState(false);
  const [showEditTrade, setShowEditTrade] = useState(false);
  const [selectedTrade, setSelectedTrade] = useState(null);
  const [editTrade, setEditTrade] = useState(null);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [tradeToDelete, setTradeToDelete] = useState(null);
  
  // Supabase states
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  
  // Sorting state
  const [sortField, setSortField] = useState('date');
  const [sortDirection, setSortDirection] = useState('desc'); // 'asc' or 'desc'
  
  // Tag filter state
  const [selectedTagFilter, setSelectedTagFilter] = useState(null);
  const [showTagFilter, setShowTagFilter] = useState(false);

  // Search & filter state
  const [tradeSearch, setTradeSearch] = useState('');
  const [filterOutcome, setFilterOutcome] = useState('all'); // all | win | loss | open
  const [filterSession, setFilterSession] = useState('all'); // all | Asia | London | New York | Sydney
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  // Daily Notes state
  const [dailyNotes, setDailyNotes] = useState([]);
  const [showDailyNote, setShowDailyNote] = useState(false);
  const [showImportCSV, setShowImportCSV] = useState(false);
  const [importPreview, setImportPreview] = useState([]);
  const [importError, setImportError] = useState('');
  const [importWarning, setImportWarning] = useState('');
  const [importFormatLabel, setImportFormatLabel] = useState('');

  const [editingNote, setEditingNote] = useState(null);

  // Shareable trade card
  const [showShareCard, setShowShareCard] = useState(false);
  const [shareShowProfit, setShareShowProfit] = useState(false);
  const shareCardRef = useRef(null);
  
  // Sidebar state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  
  // Theme state
  const [darkMode, setDarkMode] = useState(true); // Default to dark mode for modern look

  // Keeps the document background in sync with the theme, so mobile overscroll bounce
  // reveals the right color instead of a flash of the other theme (or plain white).
  useEffect(() => {
    document.body.style.backgroundColor = darkMode ? '#150f0a' : '#fdf6ee';
  }, [darkMode]);


  const [newTrade, setNewTrade] = useState({
    date: new Date().toISOString().split('T')[0],
    pair: '',
    direction: 'buy',
    entry: '',
    sl: '',
    tp: '',
    lotSize: '',
    risk: 2,
    session: 'London',
    preNotes: '',
    emotion: 'Neutral',
    screenshot: null
  });

  // ============================================
  // SUPABASE HELPER FUNCTIONS
  // ============================================

  // Convert frontend format to database row
  const frontendToDb = (trade) => ({
    date: trade.date,
    pair: trade.pair,
    direction: trade.direction,
    entry: trade.entry ? parseFloat(trade.entry) : null,
    sl: trade.sl ? parseFloat(trade.sl) : null,
    tp: trade.tp ? parseFloat(trade.tp) : null,
    lot_size: trade.lotSize ? parseFloat(trade.lotSize) : null,
    risk: trade.risk ? parseFloat(trade.risk) : 2,
    outcome: trade.outcome || null,
    profit: trade.profit ? parseFloat(trade.profit) : 0,
    session: trade.session,
    pre_notes: trade.preNotes || '',
    post_notes: trade.postNotes || '',
    emotion: trade.emotion,
    rules_followed: trade.rulesFollowed !== false,
    opened_at: trade.openedAt,
    closed_at: trade.closedAt,
    screenshot: trade.screenshot,
    screenshot_after: trade.screenshotAfter,
    tags: trade.tags || [],
    user_id: user?.id
  });

  // Fetch all trades from Supabase for current user
  const fetchTrades = useCallback(async () => {
    if (!user) return;
    
    try {
      setIsSyncing(true);
      
      const { data, error } = await supabase
        .from('trades')
        .select('*')
        .eq('user_id', user.id)
        .order('date', { ascending: false })
        .order('opened_at', { ascending: false });
      
      if (error) {
        console.error('Fetch error:', error);
        setIsOnline(false);
        return;
      }

      const formattedTrades = data.map(dbToFrontend);
      setTrades(formattedTrades);
      setIsOnline(true);
    } catch (err) {
      console.error('Error fetching trades:', err);
      setIsOnline(false);
    } finally {
      setIsLoading(false);
      setIsSyncing(false);
    }
  }, [user]);

  // Fetch daily notes from Supabase
  const fetchDailyNotes = useCallback(async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('daily_notes')
        .select('*')
        .eq('user_id', user.id)
        .order('date', { ascending: false });

      if (error) throw error;
      setDailyNotes(data || []);
    } catch (err) {
      console.error('Error fetching daily notes:', err);
    }
  }, [user]);

  // Save or update daily note
  const saveDailyNote = async (note) => {
    if (!user) return { success: false };
    
    try {
      setIsSyncing(true);
      
      const noteData = {
        user_id: user.id,
        date: note.date,
        morning_note: note.morning_note || '',
        evening_note: note.evening_note || '',
        mood: note.mood || 'Neutral',
        market_bias: note.market_bias || 'Neutral',
        updated_at: new Date().toISOString()
      };
      
      const existingNote = dailyNotes.find(n => n.date === note.date);
      
      if (existingNote) {
        const { data, error } = await supabase
          .from('daily_notes')
          .update(noteData)
          .eq('id', existingNote.id)
          .select()
          .single();
        
        if (error) {
          alert('Failed to save note: ' + error.message);
          return { success: false, error };
        }
        
        setDailyNotes(prev => prev.map(n => n.id === existingNote.id ? data : n));
      } else {
        const { data, error } = await supabase
          .from('daily_notes')
          .insert([noteData])
          .select()
          .single();
        
        if (error) {
          alert('Failed to save note: ' + error.message);
          return { success: false, error };
        }
        
        setDailyNotes(prev => [data, ...prev]);
      }
      
      return { success: true };
    } catch (err) {
      console.error('Error saving daily note:', err);
      alert('Error: ' + err.message);
      return { success: false, error: err };
    } finally {
      setIsSyncing(false);
    }
  };

  // Get note for a specific date
  const getNoteForDate = (date) => {
    return dailyNotes.find(n => n.date === date);
  };

  // Delete a daily note
  const deleteDailyNote = async (noteId) => {
    if (!user || !noteId) return { success: false };
    
    try {
      setIsSyncing(true);
      
      const { error } = await supabase
        .from('daily_notes')
        .delete()
        .eq('id', noteId);
      
      if (error) throw error;
      
      setDailyNotes(prev => prev.filter(n => n.id !== noteId));
      return { success: true };
    } catch (err) {
      console.error('Error deleting daily note:', err);
      alert('Failed to delete note. Please try again.');
      return { success: false, error: err };
    } finally {
      setIsSyncing(false);
    }
  };

  // Add a new trade to Supabase
  const addTradeToDb = async (trade) => {
    if (!user?.id) {
      alert('Not logged in. Please refresh the page.');
      return { success: false, error: 'Not logged in' };
    }
    
    try {
      setIsSyncing(true);

      const tradeData = frontendToDb(trade);
      
      const { data, error } = await supabase
        .from('trades')
        .insert([tradeData])
        .select()
        .single();
      
      if (error) {
        console.error('Insert error:', error);
        alert('Failed to add trade: ' + error.message);
        return { success: false, error };
      }
      
      const newTrade = dbToFrontend(data);
      setTrades(prev => [newTrade, ...prev]);
      return { success: true, data: newTrade };
    } catch (err) {
      console.error('Error adding trade:', err);
      alert('Error: ' + err.message);
      return { success: false, error: err };
    } finally {
      setIsSyncing(false);
    }
  };

  // Update a trade in Supabase
  const updateTradeInDb = async (trade) => {
    try {
      setIsSyncing(true);

      const { data, error } = await supabase
        .from('trades')
        .update(frontendToDb(trade))
        .eq('id', trade.id)
        .select()
        .single();
      
      if (error) {
        alert('Failed to update trade: ' + error.message);
        return { success: false, error };
      }
      
      const updatedTrade = dbToFrontend(data);
      setTrades(prev => prev.map(t => t.id === updatedTrade.id ? updatedTrade : t));
      return { success: true, data: updatedTrade };
    } catch (err) {
      console.error('Error updating trade:', err);
      alert('Error: ' + err.message);
      return { success: false, error: err };
    } finally {
      setIsSyncing(false);
    }
  };

  // Delete a trade from Supabase
  const deleteTradeFromDb = async (id) => {
    try {
      setIsSyncing(true);

      const { error } = await supabase
        .from('trades')
        .delete()
        .eq('id', id);
      
      if (error) {
        alert('Failed to delete trade: ' + error.message);
        return { success: false, error };
      }
      
      setTrades(prev => prev.filter(t => t.id !== id));
      return { success: true };
    } catch (err) {
      console.error('Error deleting trade:', err);
      alert('Error: ' + err.message);
      return { success: false, error: err };
    } finally {
      setIsSyncing(false);
    }
  };

  // Fetch trades when user changes (and on mount if user exists)
  useEffect(() => {
    if (user) {
      fetchTrades();
      fetchDailyNotes();
    }
  }, [user, fetchTrades, fetchDailyNotes]);

  // Reflect actual browser connectivity in the sync status indicator
  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    setIsOnline(navigator.onLine);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // Keep data fresh automatically in the background - no manual refresh button needed.
  // Re-syncs whenever the tab regains focus/visibility (e.g. after switching back from
  // another device or tab), plus a periodic poll while the tab stays open and visible.
  useEffect(() => {
    if (!user) return;

    const refresh = () => {
      if (document.visibilityState === 'visible') {
        fetchTrades();
        fetchDailyNotes();
      }
    };

    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    const interval = setInterval(refresh, 60000);

    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      clearInterval(interval);
    };
  }, [user, fetchTrades, fetchDailyNotes]);

  // Safety: if loading gets stuck for more than 5 seconds, force stop
  useEffect(() => {
    if (isLoading && user) {
      const safetyTimeout = setTimeout(() => {
        setIsLoading(false);
        setIsSyncing(false);
      }, 5000);
      return () => clearTimeout(safetyTimeout);
    }
  }, [isLoading, user]);

  // Safety: if syncing gets stuck for more than 10 seconds, force stop
  useEffect(() => {
    if (isSyncing) {
      const syncTimeout = setTimeout(() => {
        setIsSyncing(false);
      }, 10000);
      return () => clearTimeout(syncTimeout);
    }
  }, [isSyncing]);

  // Real-time subscription disabled for now - was causing AbortError
  // Will re-enable once connection issues are resolved
  /*
  useEffect(() => {
    if (!user) return;
    
    let isSubscribed = true;
    
    const channel = supabase
      .channel('trades_changes')
      .on('postgres_changes', 
        { event: '*', schema: 'public', table: 'trades', filter: `user_id=eq.${user.id}` },
        (payload) => {
          if (!isSubscribed) return;
          if (payload.eventType === 'INSERT') {
            const newTrade = dbToFrontend(payload.new);
            setTrades(prev => {
              if (prev.find(t => t.id === newTrade.id)) return prev;
              return [newTrade, ...prev];
            });
          } else if (payload.eventType === 'UPDATE') {
            const updatedTrade = dbToFrontend(payload.new);
            setTrades(prev => prev.map(t => t.id === updatedTrade.id ? updatedTrade : t));
          } else if (payload.eventType === 'DELETE') {
            setTrades(prev => prev.filter(t => t.id !== payload.old.id));
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setIsOnline(true);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('Real-time channel issue:', status);
          setIsOnline(false);
        }
      });

    return () => {
      isSubscribed = false;
      supabase.removeChannel(channel);
    };
  }, [user]);
  */

  const totalTrades = trades.length;
  const winningTrades = trades.filter(t => t.outcome === 'win').length;
  const losingTrades = trades.filter(t => t.outcome === 'loss').length;
  const pendingTrades = trades.filter(t => !t.outcome).length;
  const closedTrades = winningTrades + losingTrades;
  // Win rate is measured against closed trades only - still-open trades shouldn't dilute it
  const winRate = closedTrades > 0 ? ((winningTrades / closedTrades) * 100).toFixed(1) : 0;
  const totalProfit = trades.reduce((sum, t) => sum + (t.profit || 0), 0);
  const grossProfit = trades.filter(t => t.outcome === 'win').reduce((sum, t) => sum + (t.profit || 0), 0);
  const grossLoss = Math.abs(trades.filter(t => t.outcome === 'loss').reduce((sum, t) => sum + (t.profit || 0), 0));
  const avgWin = winningTrades > 0 ? grossProfit / winningTrades : 0;
  const avgLoss = losingTrades > 0 ? grossLoss / losingTrades : 0;
  // Profit factor = gross profit / gross loss (not avg win / avg loss - those only match when win and loss counts are equal).
  // No losses yet doesn't mean "0" (that reads as terrible performance) - it's either no data yet, or a perfect (infinite) factor.
  const profitFactorNum = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : null);
  const profitFactor = profitFactorNum === null ? '—' : profitFactorNum === Infinity ? '∞' : profitFactorNum.toFixed(2);
  const worstTrade = trades.reduce((min, t) => (t.profit < min ? t.profit : min), 0);

  // Average planned Risk:Reward across trades where entry/SL/TP were all set
  const tradesWithRR = trades.map(getRiskReward).filter(rr => rr !== null);
  const avgRR = tradesWithRR.length > 0 ? tradesWithRR.reduce((s, rr) => s + rr, 0) / tradesWithRR.length : null;

  // Day win % - percentage of trading days (days with at least one closed trade) that were net profitable
  const closedTradesByDay = {};
  trades.filter(t => t.outcome).forEach(t => {
    closedTradesByDay[t.date] = (closedTradesByDay[t.date] || 0) + (t.profit || 0);
  });
  const tradingDayProfits = Object.values(closedTradesByDay);
  const winningDays = tradingDayProfits.filter(p => p > 0).length;
  const losingDays = tradingDayProfits.length - winningDays;
  const dayWinRate = tradingDayProfits.length > 0 ? ((winningDays / tradingDayProfits.length) * 100).toFixed(1) : 0;
  
  // Calculate current drawdown dynamically
  // Drawdown = lowest point in equity curve from peak
  const calculateDrawdown = () => {
    if (trades.length === 0) return 0;
    
    // Sort trades by date (oldest first)
    const sortedTrades = [...trades].sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date);
      if (dateCompare !== 0) return dateCompare;
      return (a.openedAt || '').localeCompare(b.openedAt || '');
    });
    
    let runningTotal = 0;
    let peak = 0;
    let maxDrawdown = 0;
    
    for (const trade of sortedTrades) {
      runningTotal += trade.profit || 0;
      if (runningTotal > peak) {
        peak = runningTotal;
      }
      const drawdown = peak - runningTotal;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }
    
    // Current drawdown (from current peak to current position)
    const currentDD = peak - runningTotal;
    return currentDD > 0 ? -currentDD : 0;
  };
  
  const currentDrawdown = calculateDrawdown();
  
  // User-configurable targets (stored in localStorage)
  const [maxDrawdown, setMaxDrawdown] = useState(() => {
    const saved = localStorage.getItem('tj-max-drawdown');
    return saved ? parseFloat(saved) : 0;
  });
  const [profitTarget, setProfitTarget] = useState(() => {
    const saved = localStorage.getItem('tj-profit-target');
    return saved ? parseFloat(saved) : 0;
  });
  const [showTargetSettings, setShowTargetSettings] = useState(false);
  
  const drawdownPercentage = maxDrawdown > 0 ? (Math.abs(currentDrawdown) / maxDrawdown) * 100 : 0;
  const remainingDrawdown = maxDrawdown > 0 ? maxDrawdown - Math.abs(currentDrawdown) : 0;
  const targetProgress = profitTarget > 0 ? ((totalProfit / profitTarget) * 100).toFixed(1) : '0.0';

  // Calculate daily P&L data
  // Calculate Journal Score metrics
  const consistency = totalTrades > 0 ? Math.min(100, (parseFloat(winRate) / 60) * 100) : 0;
  const recoveryFactor = totalTrades > 0 && Math.abs(worstTrade) > 0 ? Math.min(100, (totalProfit / Math.abs(worstTrade)) * 20) : 0;
  const avgWinLossRatio = totalTrades > 0 && avgLoss > 0 ? Math.min(100, (avgWin / avgLoss) * 30) : 0;
  const maxDDScore = totalTrades > 0 ? Math.max(0, 100 - drawdownPercentage * 5) : 0;
  
  const journalScoreData = [
    { metric: 'Win %', value: totalTrades > 0 ? parseFloat(winRate) : 0, fullMark: 100 },
    { metric: 'Consistency', value: consistency, fullMark: 100 },
    { metric: 'Profit Factor', value: profitFactorNum === null ? 0 : Math.min(100, (profitFactorNum === Infinity ? 3 : profitFactorNum) * 40), fullMark: 100 },
    { metric: 'Max Drawdown', value: maxDDScore, fullMark: 100 },
    { metric: 'Avg Win/Loss', value: avgWinLossRatio, fullMark: 100 },
    { metric: 'Recovery Factor', value: recoveryFactor, fullMark: 100 }
  ];

  // Upload image to Supabase Storage
  const uploadScreenshot = async (file) => {
    if (!user?.id) return null;
    
    const fileExt = file.name.split('.').pop();
    const fileName = `${user.id}/${Date.now()}.${fileExt}`;
    
    const { error } = await supabase.storage
      .from('trade-screenshots')
      .upload(fileName, file, {
        cacheControl: '3600',
        upsert: false
      });
    
    if (error) {
      console.error('Upload error:', error);
      throw error;
    }
    
    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('trade-screenshots')
      .getPublicUrl(fileName);
    
    return publicUrl;
  };

  // Delete screenshot from storage
  const deleteScreenshot = async (url) => {
    if (!url || !url.includes('trade-screenshots')) return;
    
    try {
      // Extract path from URL
      const path = url.split('trade-screenshots/')[1];
      if (path) {
        await supabase.storage.from('trade-screenshots').remove([path]);
      }
    } catch (err) {
      console.error('Error deleting screenshot:', err);
    }
  };

  // null, or the target currently uploading: 'new' | 'editBefore' | 'editAfter'
  const [uploadingTarget, setUploadingTarget] = useState(null);

  // target: 'new' (add-trade "before" shot), 'editBefore' (entry shot), or 'editAfter' (result shot)
  const handleFileUpload = async (e, target) => {
    const file = e.target.files[0];
    if (!file) return;

    // Check file size (max 5MB for storage)
    if (file.size > 5 * 1024 * 1024) {
      alert('Image too large. Please use an image under 5MB.');
      return;
    }

    // Check file type
    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file.');
      return;
    }

    try {
      setUploadingTarget(target);
      const url = await uploadScreenshot(file);

      if (url) {
        if (target === 'new') {
          setNewTrade(prev => ({...prev, screenshot: url}));
        } else if (target === 'editBefore') {
          setEditTrade(prev => ({...prev, screenshot: url}));
        } else if (target === 'editAfter') {
          setEditTrade(prev => ({...prev, screenshotAfter: url}));
        }
      }
    } catch (err) {
      console.error('Error uploading image:', err);
      alert('Failed to upload image: ' + err.message);
    } finally {
      setUploadingTarget(null);
    }
  };

  const removeScreenshot = async (target) => {
    if (target === 'editBefore' && editTrade?.screenshot) {
      await deleteScreenshot(editTrade.screenshot);
      setEditTrade({...editTrade, screenshot: null});
    } else if (target === 'editAfter' && editTrade?.screenshotAfter) {
      await deleteScreenshot(editTrade.screenshotAfter);
      setEditTrade({...editTrade, screenshotAfter: null});
    } else if (target === 'new' && newTrade?.screenshot) {
      await deleteScreenshot(newTrade.screenshot);
      setNewTrade({...newTrade, screenshot: null});
    }
  };

  const resetNewTrade = () => {
    setNewTrade({
      date: new Date().toISOString().split('T')[0],
      pair: '',
      direction: 'buy',
      entry: '',
      sl: '',
      tp: '',
      lotSize: '',
      risk: 2,
      session: 'London',
      preNotes: '',
      emotion: 'Neutral',
      screenshot: null
    });
  };

  const handleAddTrade = async () => {
    const now = new Date();
    // Use the date from the form, or default to today if not set
    const tradeDate = newTrade.date || now.toISOString().split('T')[0];
    
    // Create openedAt timestamp using the selected date with current time
    const openedAt = new Date(tradeDate + 'T' + now.toTimeString().split(' ')[0]).toISOString();
    
    const trade = {
      ...newTrade,
      date: tradeDate,
      outcome: null,
      profit: 0,
      postNotes: '',
      rulesFollowed: true,
      openedAt: openedAt,
      closedAt: null
    };
    
    const result = await addTradeToDb(trade);
    if (result.success) {
      setShowAddTrade(false);
      resetNewTrade();
    } else {
      // Show error to user
      alert('Failed to add trade: ' + (result.error?.message || 'Unknown error. Check console for details.'));
      console.error('Add trade error:', result.error);
    }
  };

  const handleUpdateTrade = async () => {
    const now = new Date();
    const existingTrade = trades.find(t => t.id === editTrade.id);
    
    const updatedTrade = {
      ...editTrade,
      closedAt: editTrade.outcome && !existingTrade?.closedAt 
        ? now.toISOString() 
        : editTrade.closedAt || (editTrade.outcome ? now.toISOString() : null)
    };
    
    const result = await updateTradeInDb(updatedTrade);
    if (result.success) {
      setShowEditTrade(false);
      setSelectedTrade(null);
      setEditTrade(null);
    }
  };

  const handleDeleteTrade = (id) => {
    setTradeToDelete(id);
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (tradeToDelete) {
      const result = await deleteTradeFromDb(tradeToDelete);
      if (result.success) {
        setSelectedTrade(null);
        setTradeToDelete(null);
        setShowDeleteConfirm(false);
      }
    }
  };

  const cancelDelete = () => {
    setTradeToDelete(null);
    setShowDeleteConfirm(false);
  };

  const openEditModal = (trade) => {
    setEditTrade({...trade});
    setShowEditTrade(true);
    setSelectedTrade(null);
  };

  // Rasterizes the live share-card SVG (via its ref) into a downloadable PNG.
  // SVG -> blob URL -> Image -> canvas -> PNG blob -> temporary download link.
  const downloadShareCard = () => {
    const svgEl = shareCardRef.current;
    if (!svgEl) return;
    const svgData = new XMLSerializer().serializeToString(svgEl);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1080;
      canvas.height = 1080;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, 1080, 1080);
      URL.revokeObjectURL(svgUrl);
      canvas.toBlob((blob) => {
        if (!blob) return;
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = `trade-${(selectedTrade?.pair || 'share').toLowerCase()}-${selectedTrade?.date || ''}.png`;
        link.href = blobUrl;
        link.click();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      }, 'image/png');
    };
    img.src = svgUrl;
  };

  // Save target settings to localStorage
  const saveTargetSettings = (newMaxDD, newTarget) => {
    const dd = parseFloat(newMaxDD) || 0;
    const target = parseFloat(newTarget) || 0;
    setMaxDrawdown(dd);
    setProfitTarget(target);
    localStorage.setItem('tj-max-drawdown', dd.toString());
    localStorage.setItem('tj-profit-target', target.toString());
    setShowTargetSettings(false);
  };


  // Import Handler - auto-detects MT4/MT5 statement (.htm), TradingView order export,
  // or a generic CSV, and routes to the matching parser.
  const handleCSVImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImportError('');
    setImportWarning('');
    setImportFormatLabel('');

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target.result;
        const looksLikeHtml = /<table/i.test(text) && /<html|<!doctype/i.test(text);

        let trades = [];
        let formatLabel = '';

        if (looksLikeHtml) {
          trades = parseMT4Statement(text);
          formatLabel = 'MT4 / MT5 statement';
          if (trades.length === 0) {
            setImportError("Couldn't find a closed-trades table in this file. Make sure it's the Account History report (right-click the History tab → Save as Report), not the Strategy Tester report.");
            return;
          }
        } else {
          const tvTrades = parseTradingViewOrders(text);
          if (tvTrades !== null) {
            trades = tvTrades;
            formatLabel = 'TradingView';
            if (trades.length > 0) {
              setImportWarning("TradingView's export doesn't include profit/loss, so entry, exit, stop, and target were filled in, but you'll need to enter each trade's $ P&L by hand after importing.");
            }
          } else {
            trades = parseGenericCsv(text);
            formatLabel = 'CSV';
          }
        }

        if (trades.length === 0) {
          setImportError('No valid trades found. Make sure your file has columns like: date, pair/symbol, profit/pnl, direction/type - or is an MT4/MT5 statement export.');
          return;
        }

        setImportFormatLabel(formatLabel);
        setImportPreview(trades);
      } catch (err) {
        setImportError('Failed to parse file: ' + err.message);
      }
    };
    reader.readAsText(file);
  };

  const confirmImport = async () => {
    if (!importPreview.length) return;
    setIsSyncing(true);
    
    let imported = 0;
    for (const trade of importPreview) {
      const result = await addTradeToDb(trade);
      if (result.success) imported++;
    }
    
    setIsSyncing(false);
    setShowImportCSV(false);
    setImportPreview([]);
    setImportError('');
    setImportWarning('');
    setImportFormatLabel('');

    if (imported > 0) {
      await fetchTrades();
    }
  };

  // CSV Export - downloads all trades in a format the importer can read back in
  const escapeCsvField = (value) => {
    const str = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };

  const exportTradesToCSV = () => {
    if (trades.length === 0) {
      alert('No trades to export yet.');
      return;
    }

    const headers = [
      'date', 'pair', 'direction', 'entry', 'sl', 'tp', 'lot size', 'risk',
      'session', 'outcome', 'profit', 'rules followed', 'emotion', 'tags',
      'pre notes', 'post notes', 'opened at', 'closed at'
    ];

    const rows = trades.map(t => [
      t.date, t.pair, t.direction, t.entry, t.sl, t.tp, t.lotSize, t.risk,
      t.session, t.outcome || '', t.profit, t.rulesFollowed ? 'yes' : 'no', t.emotion,
      (t.tags || []).join('; '), t.preNotes || '', t.postNotes || '', t.openedAt || '', t.closedAt || ''
    ]);

    const csv = [headers, ...rows]
      .map(row => row.map(escapeCsvField).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `trades-export-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Helper function to format date and time
  const formatDateTime = (isoString) => {
    if (!isoString) return null;
    const date = new Date(isoString);
    return {
      date: date.toLocaleDateString('en-US', { 
        weekday: 'short',
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      }),
      time: date.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true 
      }),
      full: date.toLocaleString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      })
    };
  };

  // Format a millisecond duration as e.g. "2h 15m", "3d 4h", "45m"
  const formatDuration = (ms) => {
    const totalMinutes = Math.floor(Math.max(ms, 0) / 60000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  // How long a trade has been (or was) open, based on openedAt/closedAt
  const getTradeDuration = (trade) => {
    if (!trade.openedAt) return null;
    const start = new Date(trade.openedAt);
    const end = trade.closedAt ? new Date(trade.closedAt) : new Date();
    const ms = end - start;
    return { ms, label: formatDuration(ms), isOpen: !trade.closedAt };
  };

  // Sorting logic
  const handleSort = (field) => {
    if (sortField === field) {
      // Toggle direction if same field
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // New field, default to descending
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const getSortedTrades = () => {
    let filteredTrades = trades;
    if (selectedTagFilter) {
      filteredTrades = filteredTrades.filter(t => t.tags?.includes(selectedTagFilter));
    }
    if (tradeSearch.trim()) {
      const q = tradeSearch.trim().toUpperCase();
      filteredTrades = filteredTrades.filter(t => t.pair?.toUpperCase().includes(q));
    }
    if (filterOutcome !== 'all') {
      filteredTrades = filterOutcome === 'open'
        ? filteredTrades.filter(t => !t.outcome)
        : filteredTrades.filter(t => t.outcome === filterOutcome);
    }
    if (filterSession !== 'all') {
      filteredTrades = filteredTrades.filter(t => t.session === filterSession);
    }
    if (filterDateFrom) {
      filteredTrades = filteredTrades.filter(t => t.date >= filterDateFrom);
    }
    if (filterDateTo) {
      filteredTrades = filteredTrades.filter(t => t.date <= filterDateTo);
    }

    return [...filteredTrades].sort((a, b) => {
      let aVal, bVal;
      
      switch (sortField) {
        case 'date':
          aVal = a.date || '';
          bVal = b.date || '';
          break;
        case 'pair':
          aVal = a.pair || '';
          bVal = b.pair || '';
          break;
        case 'direction':
          aVal = a.direction || '';
          bVal = b.direction || '';
          break;
        case 'outcome':
          aVal = a.outcome || 'pending';
          bVal = b.outcome || 'pending';
          break;
        case 'openedAt':
          aVal = a.openedAt || '';
          bVal = b.openedAt || '';
          break;
        case 'closedAt':
          aVal = a.closedAt || '';
          bVal = b.closedAt || '';
          break;
        case 'duration':
          aVal = getTradeDuration(a)?.ms || 0;
          bVal = getTradeDuration(b)?.ms || 0;
          break;
        case 'profit':
          aVal = a.profit || 0;
          bVal = b.profit || 0;
          break;
        case 'lotSize':
          aVal = a.lotSize || 0;
          bVal = b.lotSize || 0;
          break;
        case 'risk':
          aVal = a.risk || 0;
          bVal = b.risk || 0;
          break;
        case 'session':
          aVal = a.session || '';
          bVal = b.session || '';
          break;
        case 'rr':
          aVal = getRiskReward(a) ?? -1;
          bVal = getRiskReward(b) ?? -1;
          break;
        default:
          aVal = a.date || '';
          bVal = b.date || '';
      }
      
      // Compare values
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      } else {
        const comparison = String(aVal).localeCompare(String(bVal));
        return sortDirection === 'asc' ? comparison : -comparison;
      }
    });
  };

  const activeFilterCount = [
    !!selectedTagFilter, filterOutcome !== 'all', filterSession !== 'all', !!filterDateFrom, !!filterDateTo
  ].filter(Boolean).length;

  const clearAllFilters = () => {
    setSelectedTagFilter(null);
    setFilterOutcome('all');
    setFilterSession('all');
    setFilterDateFrom('');
    setFilterDateTo('');
  };

  const SortIcon = ({ field }) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-4 h-4 text-stone-400" />;
    }
    return sortDirection === 'asc' 
      ? <ArrowUp className="w-4 h-4 text-orange-600" />
      : <ArrowDown className="w-4 h-4 text-orange-600" />;
  };

  // Calendar functions
  const getDaysInMonth = (date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();
    
    return { daysInMonth, startingDayOfWeek, year, month };
  };

  const getTradesForDate = (dateStr) => {
    return trades.filter(t => t.date === dateStr);
  };

  const getProfitForDate = (dateStr) => {
    const dayTrades = getTradesForDate(dateStr);
    return dayTrades.reduce((sum, t) => sum + (t.profit || 0), 0);
  };

  const changeMonth = (direction) => {
    const newDate = new Date(currentMonth);
    newDate.setMonth(newDate.getMonth() + direction);
    setCurrentMonth(newDate);
  };

  const isToday = (dateStr) => {
    const today = new Date().toISOString().split('T')[0];
    return dateStr === today;
  };

  const CalendarView = () => {
    const { daysInMonth, startingDayOfWeek, year, month } = getDaysInMonth(currentMonth);
    const monthName = currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' });
    
    // Build weeks with their summary data
    const weeks = [];
    let currentWeek = [];
    let weekProfit = 0;
    let weekTrades = 0;
    
    // Empty cells for days before month starts
    for (let i = 0; i < startingDayOfWeek; i++) {
      currentWeek.push({ type: 'empty', key: `empty-start-${i}` });
    }
    
    // Days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dayTrades = getTradesForDate(dateStr);
      const dayProfit = getProfitForDate(dateStr);
      const hasData = dayTrades.length > 0;
      const today = isToday(dateStr);
      
      weekProfit += dayProfit;
      weekTrades += dayTrades.length;
      
      currentWeek.push({
        type: 'day',
        day,
        dateStr,
        dayTrades,
        dayProfit,
        hasData,
        today
      });
      
      // End of week (Saturday) or end of month
      if (currentWeek.length === 7 || day === daysInMonth) {
        // Fill remaining days if last week is incomplete
        while (currentWeek.length < 7) {
          currentWeek.push({ type: 'empty', key: `empty-end-${currentWeek.length}` });
        }
        
        weeks.push({
          days: [...currentWeek],
          weekProfit,
          weekTrades
        });
        
        currentWeek = [];
        weekProfit = 0;
        weekTrades = 0;
      }
    }
    
    return (
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className={`text-lg font-bold ${darkMode ? 'text-white' : 'text-stone-900'}`}>{monthName}</h3>
          <div className="flex gap-2">
            <button
              onClick={() => changeMonth(-1)}
              className={`p-2 rounded-lg transition-colors ${darkMode ? 'hover:bg-white/10 text-stone-300' : 'hover:bg-stone-100'}`}
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={() => changeMonth(1)}
              className={`p-2 rounded-lg transition-colors ${darkMode ? 'hover:bg-white/10 text-stone-300' : 'hover:bg-stone-100'}`}
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
        
        <div className="grid grid-cols-7 sm:grid-cols-8 gap-1 sm:gap-2 mb-2">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Weekly Summary'].map(day => (
            <div
              key={day}
              className={`text-center text-xs sm:text-sm font-semibold py-2 truncate ${day === 'Weekly Summary' ? 'hidden sm:block' : ''} ${darkMode ? 'text-stone-400' : 'text-stone-600'}`}
            >
              {day === 'Weekly Summary' ? 'Week' : day}
            </div>
          ))}
        </div>

        <div className="space-y-1 sm:space-y-2">
          {weeks.map((week, weekIndex) => (
            <div key={weekIndex} className="grid grid-cols-7 sm:grid-cols-8 gap-1 sm:gap-2">
              {week.days.map((dayData, dayIndex) => {
                if (dayData.type === 'empty') {
                  return <div key={dayData.key} className="aspect-square" />;
                }
                
                return (
                  <div
                    key={dayData.day}
                    onClick={() => dayData.hasData && setSelectedDay(dayData.dateStr)}
                    onDoubleClick={() => {
                      setEditingNote({
                        date: dayData.dateStr,
                        ...getNoteForDate(dayData.dateStr)
                      });
                      setShowDailyNote(true);
                    }}
                    className={`aspect-square border rounded-lg p-1 sm:p-2 cursor-pointer transition-all overflow-hidden ${
                      dayData.today ? 'border-orange-500 border-2 bg-orange-500/20' : (darkMode ? 'border-white/10' : 'border-stone-200')
                    } ${
                      dayData.hasData && dayData.dayProfit > 0 ? (darkMode ? 'bg-green-900/30 hover:bg-green-900/50' : 'bg-green-50 hover:bg-green-100') :
                      dayData.hasData && dayData.dayProfit < 0 ? (darkMode ? 'bg-red-900/30 hover:bg-red-900/50' : 'bg-red-50 hover:bg-red-100') :
                      dayData.hasData ? (darkMode ? 'bg-white/5 hover:bg-white/10' : 'bg-stone-50 hover:bg-stone-100') :
                      (darkMode ? 'bg-white/[0.02] hover:bg-white/5' : 'bg-white hover:bg-stone-50')
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div className={`text-xs sm:text-sm font-semibold ${darkMode ? 'text-stone-300' : 'text-stone-700'}`}>{dayData.day}</div>
                      {getNoteForDate(dayData.dateStr) && (
                        <BookOpen className={`w-3 h-3 hidden sm:block ${darkMode ? 'text-orange-400' : 'text-orange-500'}`} />
                      )}
                    </div>
                    {dayData.hasData && (
                      <div className="space-y-1">
                        <div className={`text-xs hidden sm:block ${darkMode ? 'text-stone-400' : 'text-stone-600'}`}>{dayData.dayTrades.length} trade{dayData.dayTrades.length > 1 ? 's' : ''}</div>
                        <div className={`text-[10px] sm:text-xs font-bold truncate ${dayData.dayProfit >= 0 ? (darkMode ? 'text-green-400' : 'text-green-600') : (darkMode ? 'text-red-400' : 'text-red-600')}`}>
                          {dayData.dayProfit >= 0 ? '+' : ''}${dayData.dayProfit.toLocaleString()}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              
              {/* Week Summary Column - hidden on mobile, too narrow to be legible at 7-8 columns wide */}
              <div className={`hidden sm:flex aspect-square border-2 rounded-lg p-2 flex-col items-center justify-center ${
                week.weekProfit > 0 ? (darkMode ? 'bg-green-900/40 border-green-700' : 'bg-green-100 border-green-300') :
                week.weekProfit < 0 ? (darkMode ? 'bg-red-900/40 border-red-700' : 'bg-red-100 border-red-300') :
                (darkMode ? 'bg-white/5 border-white/10' : 'bg-stone-100 border-stone-300')
              }`}>
                <div className={`text-xs mb-1 ${darkMode ? 'text-stone-400' : 'text-stone-600'}`}>W{weekIndex + 1}</div>
                {week.weekTrades > 0 && (
                  <>
                    <div className={`text-sm font-bold ${week.weekProfit >= 0 ? (darkMode ? 'text-green-400' : 'text-green-700') : (darkMode ? 'text-red-400' : 'text-red-700')}`}>
                      {week.weekProfit >= 0 ? '+' : ''}${week.weekProfit.toLocaleString()}
                    </div>
                    <div className={`text-xs ${darkMode ? 'text-stone-400' : 'text-stone-600'}`}>{week.weekTrades}T</div>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className={`flex flex-wrap items-center justify-center gap-4 sm:gap-6 mt-6 pt-6 border-t ${darkMode ? 'border-white/10' : 'border-stone-200'}`}>
          <div className="flex items-center gap-2">
            <div className={`w-4 h-4 rounded ${darkMode ? 'bg-green-900/40 border border-green-700' : 'bg-green-100 border border-green-200'}`}></div>
            <span className={`text-sm ${darkMode ? 'text-stone-400' : 'text-stone-600'}`}>Profitable</span>
          </div>
          <div className="flex items-center gap-2">
            <div className={`w-4 h-4 rounded ${darkMode ? 'bg-red-900/40 border border-red-700' : 'bg-red-100 border border-red-200'}`}></div>
            <span className={`text-sm ${darkMode ? 'text-stone-400' : 'text-stone-600'}`}>Loss</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-orange-500/20 border-2 border-orange-500 rounded"></div>
            <span className={`text-sm ${darkMode ? 'text-stone-400' : 'text-stone-600'}`}>Today</span>
          </div>
          <div className="flex items-center gap-2">
            <BookOpen className={`w-4 h-4 ${darkMode ? 'text-orange-400' : 'text-orange-500'}`} />
            <span className={`text-sm ${darkMode ? 'text-stone-400' : 'text-stone-600'}`}>Has Note</span>
          </div>
        </div>
        <p className={`text-center text-xs mt-2 ${darkMode ? 'text-stone-500' : 'text-stone-400'}`}>
          Double-click any day to add/edit journal note
        </p>
      </div>
    );
  };

  // ============================================
  // AUTH SCREENS
  // ============================================
  
  // Loading screen
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-stone-950 via-orange-950 to-stone-900 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-orange-500 animate-spin mx-auto mb-4" />
          <p className="text-white text-lg">Loading...</p>
        </div>
      </div>
    );
  }

  // User clicked a password-reset email link - force them to set a new password
  if (passwordRecovery) {
    return <ResetPasswordScreen />;
  }

  // Not logged in - show auth screens
  if (!user) {
    if (authView === 'landing') {
      return (
        <LandingScreen
          onSignIn={() => setAuthView('login')}
          onSignUp={() => setAuthView('signup')}
        />
      );
    }
    if (authView === 'signup') {
      return (
        <SignupScreen
          onSwitchToLogin={() => setAuthView('login')}
          onSuccess={(email) => { setVerifyEmail(email); setAuthView('verify'); }}
          onBackToLanding={() => setAuthView('landing')}
        />
      );
    }
    if (authView === 'verify') {
      return <VerifyScreen email={verifyEmail} onBackToLogin={() => setAuthView('login')} />;
    }
    if (authView === 'forgot') {
      return <ForgotPasswordScreen onBackToLogin={() => setAuthView('login')} />;
    }
    return (
      <LoginScreen
        onSwitchToSignup={() => setAuthView('signup')}
        onSwitchToForgot={() => setAuthView('forgot')}
        onBackToLanding={() => setAuthView('landing')}
      />
    );
  }

  // Still fetching the profile row - wait rather than flash the "complete your profile" screen
  if (profileLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-stone-950 via-orange-950 to-stone-900 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-orange-500 animate-spin mx-auto mb-4" />
          <p className="text-white text-lg">Loading...</p>
        </div>
      </div>
    );
  }

  // Phone/location/Instagram are required before using the app - Google sign-in never
  // collects these, and the signup form's fields for them were optional.
  if (!profile?.phone || !profile?.location || !profile?.instagram) {
    return <CompleteProfileScreen />;
  }

  // Profile screen
  if (activeTab === 'profile') {
    const handleReplayTour = () => {
      try {
        localStorage.removeItem('tj-tour-v2-dashboard');
        localStorage.removeItem('tj-tour-v2-trades');
        localStorage.removeItem('tj-tour-v2-journal');
      } catch {}
      setActiveTab('dashboard');
    };
    return <ProfileScreen onBack={() => setActiveTab('dashboard')} onReplayTour={handleReplayTour} darkMode={darkMode} />;
  }

  // ============================================
  // CONTENT COMPONENTS
  // ============================================

  // Selected Day View Component
  const SelectedDayView = () => (
    <div className={`${darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-stone-200'} rounded-2xl border p-6`}>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className={`text-xl font-bold ${darkMode ? 'text-white' : 'text-stone-900'}`}>
            {new Date(selectedDay + 'T00:00:00').toLocaleDateString('en-US', { 
              weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
            })}
          </h3>
          <p className={`text-sm mt-1 ${darkMode ? 'text-stone-400' : 'text-stone-500'}`}>
            {getTradesForDate(selectedDay).length} trade{getTradesForDate(selectedDay).length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => {
              setEditingNote({ date: selectedDay, ...getNoteForDate(selectedDay) });
              setShowDailyNote(true);
            }}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium ${
              getNoteForDate(selectedDay)
                ? 'bg-orange-500/20 text-orange-400 hover:bg-orange-500/30'
                : (darkMode ? 'bg-white/5 text-stone-300 hover:bg-white/10' : 'bg-stone-100 text-stone-700 hover:bg-stone-200')
            }`}
          >
            <BookOpen className="w-4 h-4" />
            {getNoteForDate(selectedDay) ? 'View Note' : 'Add Note'}
          </button>
          <button 
            onClick={() => setSelectedDay(null)}
            className={`p-2 rounded-xl ${darkMode ? 'text-stone-400 hover:bg-white/10' : 'text-stone-500 hover:bg-stone-100'}`}
          >
            <XCircle className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* Note Preview */}
      {getNoteForDate(selectedDay) && (
        <div className={`mb-6 p-4 rounded-xl ${darkMode ? 'bg-orange-500/10 border border-orange-500/20' : 'bg-orange-50 border border-orange-200'}`}>
          <div className="flex items-center gap-2 mb-2">
            <BookOpen className={`w-4 h-4 ${darkMode ? 'text-orange-400' : 'text-orange-600'}`} />
            <span className={`text-sm font-semibold ${darkMode ? 'text-orange-300' : 'text-orange-700'}`}>Journal Note</span>
          </div>
          {getNoteForDate(selectedDay).morning_note && (
            <p className={`text-sm ${darkMode ? 'text-stone-300' : 'text-stone-600'}`}>☀️ {getNoteForDate(selectedDay).morning_note}</p>
          )}
        </div>
      )}
      
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className={`${darkMode ? 'bg-white/5' : 'bg-stone-50'} rounded-xl p-4 text-center`}>
          <p className={`text-xs mb-1 ${darkMode ? 'text-stone-500' : 'text-stone-500'}`}>Trades</p>
          <p className={`text-2xl font-bold ${darkMode ? 'text-white' : 'text-stone-900'}`}>{getTradesForDate(selectedDay).length}</p>
        </div>
        <div className={`${darkMode ? 'bg-white/5' : 'bg-stone-50'} rounded-xl p-4 text-center`}>
          <p className={`text-xs mb-1 ${darkMode ? 'text-stone-500' : 'text-stone-500'}`}>Win Rate</p>
          <p className={`text-2xl font-bold ${darkMode ? 'text-orange-400' : 'text-orange-600'}`}>
            {getTradesForDate(selectedDay).length > 0 
              ? Math.round((getTradesForDate(selectedDay).filter(t => t.outcome === 'win').length / getTradesForDate(selectedDay).filter(t => t.outcome).length) * 100) || 0
              : 0}%
          </p>
        </div>
        <div className={`rounded-xl p-4 text-center ${getProfitForDate(selectedDay) >= 0 ? (darkMode ? 'bg-green-500/10' : 'bg-green-50') : (darkMode ? 'bg-red-500/10' : 'bg-red-50')}`}>
          <p className={`text-xs mb-1 ${darkMode ? 'text-stone-500' : 'text-stone-500'}`}>P&L</p>
          <p className={`text-2xl font-bold ${getProfitForDate(selectedDay) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
            {getProfitForDate(selectedDay) >= 0 ? '+' : ''}${getProfitForDate(selectedDay).toLocaleString()}
          </p>
        </div>
      </div>

      {/* Trade List */}
      <div className="space-y-3">
        {getTradesForDate(selectedDay).map(trade => (
          <div 
            key={trade.id}
            className={`p-4 rounded-xl cursor-pointer transition-all ${
              darkMode ? 'bg-white/5 hover:bg-white/10 border border-white/5' : 'bg-stone-50 hover:bg-stone-100'
            }`}
            onClick={() => setSelectedTrade(trade)}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  trade.outcome === 'win' ? 'bg-green-500/20 text-green-500' : 
                  trade.outcome === 'loss' ? 'bg-red-500/20 text-red-500' : 'bg-yellow-500/20 text-yellow-500'
                }`}>
                  {trade.outcome === 'win' ? <CheckCircle className="w-5 h-5" /> : 
                   trade.outcome === 'loss' ? <XCircle className="w-5 h-5" /> : <Clock className="w-5 h-5" />}
                </div>
                <div>
                  <p className={`font-bold ${darkMode ? 'text-white' : 'text-stone-900'}`}>{trade.pair}</p>
                  <p className={`text-sm ${darkMode ? 'text-stone-400' : 'text-stone-500'}`}>
                    {trade.direction.toUpperCase()} • {trade.session}
                  </p>
                </div>
              </div>
              <p className={`text-lg font-bold ${trade.profit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {trade.profit >= 0 ? '+' : ''}${trade.profit?.toLocaleString() || 0}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // Dashboard Content Component
  const DashboardContent = () => (
    <>
      <TourGuide
        tourKey="dashboard"
        darkMode={darkMode}
        steps={[
          {
            title: "Welcome to Shinobi Trading Journal",
            body: "Quick 30-second look around - here's where everything lives.",
          },
          {
            target: '[data-tour="db-stats"]',
            title: "Your live stats",
            body: "Win rate, profit factor, and net P&L update automatically the moment you log a trade.",
          },
          {
            target: '[data-tour="db-view-all"]',
            title: "See every trade",
            body: "Click here anytime to open your full trade history, with search and filters.",
          },
          {
            target: '[data-tour="db-add-note"]',
            title: "Journal your day",
            body: "Each day on this mini calendar shows your P&L at a glance. Click Add Note to journal today, or double-click any date on the calendar to add a note for that day.",
          },
        ]}
      />
      {/* Key Performance Stats */}
      <div data-tour="db-stats" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 items-stretch">
        {/* Net P&L - headline number, no gauge */}
        <div className={`p-4 rounded-2xl flex flex-col justify-center ${darkMode ? 'bg-white/[0.06] backdrop-blur-xl border border-orange-300/20' : 'bg-white/60 backdrop-blur-xl border border-orange-300/30'}`}>
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl ${darkMode ? 'bg-orange-500/20' : 'bg-orange-100'}`}>
              <DollarSign className={`w-5 h-5 ${darkMode ? 'text-orange-400' : 'text-orange-600'}`} />
            </div>
            <div>
              <p className={`text-xs ${darkMode ? 'text-stone-500' : 'text-stone-500'}`}>Net P&L</p>
              <p className={`text-lg font-bold ${totalProfit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {totalProfit >= 0 ? '+' : ''}${totalProfit.toLocaleString()}
              </p>
            </div>
          </div>
        </div>

        {/* Trade Win % - half-circle speedometer gauge */}
        <div className={`p-4 rounded-2xl ${darkMode ? 'bg-white/[0.06] backdrop-blur-xl border border-orange-300/20' : 'bg-white/60 backdrop-blur-xl border border-orange-300/30'}`}>
          <div className="flex items-center gap-2 mb-1">
            <Target className={`w-4 h-4 ${darkMode ? 'text-purple-400' : 'text-purple-600'}`} />
            <p className={`text-xs ${darkMode ? 'text-stone-500' : 'text-stone-500'}`}>Trade Win %</p>
          </div>
          <div className="relative w-fit mx-auto">
            <HalfGauge pct={parseFloat(winRate)} />
            <div className="absolute inset-x-0 bottom-0 text-center">
              <p className={`text-sm font-bold ${parseFloat(winRate) >= 50 ? 'text-green-500' : 'text-red-500'}`}>{winRate}%</p>
            </div>
          </div>
          <div className="flex justify-center gap-3 text-[10px] font-medium mt-0.5">
            <span className="text-green-500">{winningTrades}W</span>
            <span className="text-red-500">{losingTrades}L</span>
          </div>
        </div>

        {/* Profit Factor - full-circle radial gauge, scaled 0-3 (1.0 = breakeven) */}
        <div className={`p-4 rounded-2xl flex flex-col items-center ${darkMode ? 'bg-white/[0.06] backdrop-blur-xl border border-orange-300/20' : 'bg-white/60 backdrop-blur-xl border border-orange-300/30'}`}>
          <div className="flex items-center gap-2 mb-2 self-start">
            <Activity className={`w-4 h-4 ${darkMode ? 'text-amber-400' : 'text-amber-600'}`} />
            <p className={`text-xs ${darkMode ? 'text-stone-500' : 'text-stone-500'}`}>Profit Factor</p>
          </div>
          <div className="relative">
            <CircleGauge
              pct={profitFactorNum === null ? 0 : Math.min(((profitFactorNum === Infinity ? 3 : profitFactorNum) / 3) * 100, 100)}
              color={profitFactorNum === null ? (darkMode ? '#6b7280' : '#9ca3af') : profitFactorNum >= 1 ? '#10b981' : '#ef4444'}
              trackColor={darkMode ? 'rgba(255,255,255,0.1)' : '#e5e7eb'}
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <p className={`text-xs font-bold ${profitFactorNum === null ? (darkMode ? 'text-stone-500' : 'text-stone-400') : profitFactorNum >= 1 ? 'text-green-500' : 'text-red-500'}`}>{profitFactor}</p>
            </div>
          </div>
          <p className={`text-[10px] mt-1 ${darkMode ? 'text-stone-500' : 'text-stone-400'}`}>Breakeven at 1.0</p>
        </div>

        {/* Day Win % - half-circle speedometer gauge */}
        <div className={`p-4 rounded-2xl ${darkMode ? 'bg-white/[0.06] backdrop-blur-xl border border-orange-300/20' : 'bg-white/60 backdrop-blur-xl border border-orange-300/30'}`}>
          <div className="flex items-center gap-2 mb-1">
            <Calendar className={`w-4 h-4 ${darkMode ? 'text-amber-400' : 'text-amber-600'}`} />
            <p className={`text-xs ${darkMode ? 'text-stone-500' : 'text-stone-500'}`}>Day Win %</p>
          </div>
          <div className="relative w-fit mx-auto">
            <HalfGauge pct={parseFloat(dayWinRate)} />
            <div className="absolute inset-x-0 bottom-0 text-center">
              <p className={`text-sm font-bold ${parseFloat(dayWinRate) >= 50 ? 'text-green-500' : 'text-red-500'}`}>{dayWinRate}%</p>
            </div>
          </div>
          <div className="flex justify-center gap-3 text-[10px] font-medium mt-0.5">
            <span className="text-green-500">{winningDays}W</span>
            <span className="text-red-500">{losingDays}L</span>
          </div>
        </div>

        {/* Avg Win/Loss Trade - bar with the $ amounts shown underneath */}
        <div className={`p-4 rounded-2xl flex flex-col justify-center ${darkMode ? 'bg-white/[0.06] backdrop-blur-xl border border-orange-300/20' : 'bg-white/60 backdrop-blur-xl border border-orange-300/30'}`}>
          <div className="flex items-center gap-2 mb-3">
            <ArrowUpDown className={`w-4 h-4 ${darkMode ? 'text-teal-400' : 'text-teal-600'}`} />
            <p className={`text-xs ${darkMode ? 'text-stone-500' : 'text-stone-500'}`}>Avg Win/Loss Trade</p>
          </div>
          <div className={`h-1.5 rounded-full overflow-hidden flex ${darkMode ? 'bg-white/10' : 'bg-stone-200'}`}>
            <div className="h-full bg-green-500" style={{ width: `${(avgWin + avgLoss) > 0 ? (avgWin / (avgWin + avgLoss)) * 100 : 50}%` }} />
            <div className="h-full bg-red-500" style={{ width: `${(avgWin + avgLoss) > 0 ? (avgLoss / (avgWin + avgLoss)) * 100 : 50}%` }} />
          </div>
          <p className="text-lg font-bold whitespace-nowrap text-center mt-2">
            <span className="text-green-500">${avgWin.toFixed(0)}</span>
            <span className={darkMode ? 'text-stone-500' : 'text-stone-400'}> / </span>
            <span className="text-red-500">${avgLoss.toFixed(0)}</span>
          </p>
        </div>

        {/* Avg Risk:Reward - planned R:R averaged across trades with entry/SL/TP set */}
        <div className={`p-4 rounded-2xl flex flex-col justify-center ${darkMode ? 'bg-white/[0.06] backdrop-blur-xl border border-orange-300/20' : 'bg-white/60 backdrop-blur-xl border border-orange-300/30'}`}>
          <div className="flex items-center gap-2 mb-1">
            <BarChart3 className={`w-4 h-4 ${darkMode ? 'text-orange-400' : 'text-orange-600'}`} />
            <p className={`text-xs ${darkMode ? 'text-stone-500' : 'text-stone-500'}`}>Avg Risk:Reward</p>
          </div>
          <p className={`text-lg font-bold ${avgRR === null ? (darkMode ? 'text-stone-500' : 'text-stone-400') : avgRR >= 1.5 ? 'text-green-500' : avgRR >= 1 ? 'text-amber-500' : 'text-red-500'}`}>
            {formatRR(avgRR)}
          </p>
        </div>
      </div>

      {/* Hero Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className={`relative overflow-hidden rounded-2xl p-6 ${darkMode ? 'bg-gradient-to-br from-red-500/20 to-red-600/10 border border-red-500/20' : 'bg-gradient-to-br from-red-500 to-red-600'}`}>
          <div className="relative z-10">
            <div className="flex justify-between items-start">
              <div>
                <p className={`text-sm ${darkMode ? 'text-red-300' : 'text-white/80'}`}>Current Drawdown</p>
                <p className={`text-3xl font-bold ${darkMode ? 'text-white' : 'text-white'}`}>${Math.abs(currentDrawdown).toLocaleString()}</p>
              </div>
              <button onClick={() => setShowTargetSettings(true)} className={`p-3 rounded-xl ${darkMode ? 'bg-red-500/20 hover:bg-red-500/30' : 'bg-white/20 hover:bg-white/30'}`}>
                <Settings className={`w-6 h-6 ${darkMode ? 'text-red-400' : 'text-white'}`} />
              </button>
            </div>
            {maxDrawdown > 0 ? (
              <div className="mt-4">
                <div className="flex justify-between text-sm mb-2">
                  <span className={darkMode ? 'text-red-300' : 'text-white/80'}>Max: ${maxDrawdown.toLocaleString()}</span>
                  <span className={darkMode ? 'text-red-300' : 'text-white/80'}>${remainingDrawdown.toLocaleString()} left</span>
                </div>
                <div className={`h-2 rounded-full ${darkMode ? 'bg-red-500/20' : 'bg-white/20'}`}>
                  <div className={`h-full rounded-full ${darkMode ? 'bg-red-500' : 'bg-white'}`} style={{width: `${Math.min(drawdownPercentage, 100)}%`}} />
                </div>
              </div>
            ) : (
              <p className={`text-xs mt-3 ${darkMode ? 'text-red-300/60' : 'text-white/60'}`}>Tap ⚙ to set max drawdown limit</p>
            )}
          </div>
        </div>

        <div className={`relative overflow-hidden rounded-2xl p-6 ${darkMode ? 'bg-gradient-to-br from-orange-500/20 to-amber-600/10 border border-orange-500/20' : 'bg-gradient-to-br from-orange-500 to-amber-600'}`}>
          <div className="relative z-10">
            <div className="flex justify-between items-start">
              <div>
                <p className={`text-sm ${darkMode ? 'text-orange-300' : 'text-white/80'}`}>Progress to Target</p>
                <p className={`text-3xl font-bold ${darkMode ? 'text-white' : 'text-white'}`}>{profitTarget > 0 ? targetProgress : '0.0'}%</p>
              </div>
              <button onClick={() => setShowTargetSettings(true)} className={`p-3 rounded-xl ${darkMode ? 'bg-orange-500/20 hover:bg-orange-500/30' : 'bg-white/20 hover:bg-white/30'}`}>
                <Target className={`w-6 h-6 ${darkMode ? 'text-orange-400' : 'text-white'}`} />
              </button>
            </div>
            {profitTarget > 0 ? (
              <div className="mt-4">
                <div className="flex justify-between text-sm mb-2">
                  <span className={darkMode ? 'text-orange-300' : 'text-white/80'}>Target: ${profitTarget.toLocaleString()}</span>
                  <span className={darkMode ? 'text-orange-300' : 'text-white/80'}>${totalProfit.toLocaleString()}</span>
                </div>
                <div className={`h-2 rounded-full ${darkMode ? 'bg-orange-500/20' : 'bg-white/20'}`}>
                  <div className={`h-full rounded-full ${darkMode ? 'bg-orange-500' : 'bg-white'}`} style={{width: `${Math.min(parseFloat(targetProgress), 100)}%`}} />
                </div>
              </div>
            ) : (
              <p className={`text-xs mt-3 ${darkMode ? 'text-orange-300/60' : 'text-white/60'}`}>Tap 🎯 to set profit target</p>
            )}
          </div>
        </div>

        <div className={`relative overflow-hidden rounded-2xl p-6 ${darkMode ? 'bg-gradient-to-br from-green-500/20 to-emerald-600/10 border border-green-500/20' : 'bg-gradient-to-br from-green-500 to-emerald-600'}`}>
          <div className="relative z-10">
            <div className="flex justify-between items-start">
              <div>
                <p className={`text-sm ${darkMode ? 'text-green-300' : 'text-white/80'}`}>Win Rate</p>
                <p className={`text-3xl font-bold ${darkMode ? 'text-white' : 'text-white'}`}>{winRate}%</p>
              </div>
              <div className={`p-3 rounded-xl ${darkMode ? 'bg-green-500/20' : 'bg-white/20'}`}>
                <Award className={`w-6 h-6 ${darkMode ? 'text-green-400' : 'text-white'}`} />
              </div>
            </div>
            <div className="mt-4 flex justify-between">
              <div className="text-center">
                <p className={`text-2xl font-bold ${darkMode ? 'text-green-400' : 'text-white'}`}>{winningTrades}</p>
                <p className={`text-xs ${darkMode ? 'text-green-300' : 'text-white/80'}`}>Wins</p>
              </div>
              <div className="text-center">
                <p className={`text-2xl font-bold ${darkMode ? 'text-red-400' : 'text-white'}`}>{losingTrades}</p>
                <p className={`text-xs ${darkMode ? 'text-green-300' : 'text-white/80'}`}>Losses</p>
              </div>
              <div className="text-center">
                <p className={`text-2xl font-bold ${darkMode ? 'text-yellow-400' : 'text-white'}`}>{pendingTrades}</p>
                <p className={`text-xs ${darkMode ? 'text-green-300' : 'text-white/80'}`}>Open</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className={`p-4 rounded-2xl ${darkMode ? 'bg-white/[0.06] backdrop-blur-xl border border-orange-300/20' : 'bg-white/60 backdrop-blur-xl border border-orange-300/30'}`}>
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl ${darkMode ? 'bg-green-500/20' : 'bg-green-100'}`}>
              <TrendingUp className={`w-5 h-5 ${darkMode ? 'text-green-400' : 'text-green-600'}`} />
            </div>
            <div>
              <p className={`text-xs ${darkMode ? 'text-stone-500' : 'text-stone-500'}`}>Best Trade</p>
              <p className={`text-lg font-bold ${darkMode ? 'text-green-400' : 'text-green-600'}`}>
                +${Math.max(...trades.map(t => t.profit || 0), 0).toLocaleString()}
              </p>
            </div>
          </div>
        </div>
        <div className={`p-4 rounded-2xl ${darkMode ? 'bg-white/[0.06] backdrop-blur-xl border border-orange-300/20' : 'bg-white/60 backdrop-blur-xl border border-orange-300/30'}`}>
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl ${darkMode ? 'bg-red-500/20' : 'bg-red-100'}`}>
              <TrendingDown className={`w-5 h-5 ${darkMode ? 'text-red-400' : 'text-red-600'}`} />
            </div>
            <div>
              <p className={`text-xs ${darkMode ? 'text-stone-500' : 'text-stone-500'}`}>Worst Trade</p>
              <p className={`text-lg font-bold ${darkMode ? 'text-red-400' : 'text-red-600'}`}>
                ${Math.min(...trades.map(t => t.profit || 0), 0).toLocaleString()}
              </p>
            </div>
          </div>
        </div>
        <div className={`p-4 rounded-2xl ${darkMode ? 'bg-white/[0.06] backdrop-blur-xl border border-orange-300/20' : 'bg-white/60 backdrop-blur-xl border border-orange-300/30'}`}>
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl ${darkMode ? 'bg-orange-500/20' : 'bg-orange-100'}`}>
              <DollarSign className={`w-5 h-5 ${darkMode ? 'text-orange-400' : 'text-orange-600'}`} />
            </div>
            <div>
              <p className={`text-xs ${darkMode ? 'text-stone-500' : 'text-stone-500'}`}>Avg Win</p>
              <p className={`text-lg font-bold ${darkMode ? 'text-white' : 'text-stone-900'}`}>
                ${avgWin.toLocaleString()}
              </p>
            </div>
          </div>
        </div>
        <div className={`p-4 rounded-2xl ${darkMode ? 'bg-white/[0.06] backdrop-blur-xl border border-orange-300/20' : 'bg-white/60 backdrop-blur-xl border border-orange-300/30'}`}>
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl ${darkMode ? 'bg-purple-500/20' : 'bg-purple-100'}`}>
              <Activity className={`w-5 h-5 ${darkMode ? 'text-purple-400' : 'text-purple-600'}`} />
            </div>
            <div>
              <p className={`text-xs ${darkMode ? 'text-stone-500' : 'text-stone-500'}`}>Profit Factor</p>
              <p className={`text-lg font-bold ${darkMode ? 'text-white' : 'text-stone-900'}`}>
                {profitFactor}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Equity Curve */}
      <div className={`rounded-2xl p-6 ${darkMode ? 'bg-white/[0.06] backdrop-blur-xl border border-orange-300/20' : 'bg-white/60 backdrop-blur-xl border border-orange-300/30'}`}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className={`text-lg font-bold ${darkMode ? 'text-white' : 'text-stone-900'}`}>Equity Curve</h3>
            <p className={`text-sm ${darkMode ? 'text-stone-500' : 'text-stone-500'}`}>Account growth over time</p>
          </div>
          <div className={`px-3 py-1 rounded-lg text-sm font-medium ${totalProfit >= 0 ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'}`}>
            {totalProfit >= 0 ? '+' : ''}${totalProfit.toLocaleString()}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={(() => {
            const sortedTrades = [...trades].sort((a, b) => a.date.localeCompare(b.date));
            let runningTotal = 0;
            const equityData = [{ date: 'Start', equity: 0 }];
            sortedTrades.forEach((trade) => {
              runningTotal += trade.profit || 0;
              equityData.push({ date: trade.date, equity: runningTotal });
            });
            return equityData;
          })()}>
            <defs>
              <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={totalProfit >= 0 ? "#10b981" : "#ef4444"} stopOpacity={0.3}/>
                <stop offset="95%" stopColor={totalProfit >= 0 ? "#10b981" : "#ef4444"} stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? '#ffffff10' : '#e5e7eb'} />
            <XAxis dataKey="date" tick={{ fill: darkMode ? '#64748b' : '#6b7280', fontSize: 10 }} tickFormatter={(value) => value === 'Start' ? 'Start' : value.slice(5)} />
            <YAxis tick={{ fill: darkMode ? '#64748b' : '#6b7280', fontSize: 10 }} tickFormatter={(value) => `$${value}`} />
            <Tooltip contentStyle={{ backgroundColor: darkMode ? '#1e293b' : '#fff', border: 'none', borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }} />
            <Area type="monotone" dataKey="equity" stroke={totalProfit >= 0 ? "#10b981" : "#ef4444"} fill="url(#equityGradient)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Recent Trades */}
      <div className={`rounded-2xl p-6 ${darkMode ? 'bg-white/[0.06] backdrop-blur-xl border border-orange-300/20' : 'bg-white/60 backdrop-blur-xl border border-orange-300/30'}`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className={`text-lg font-bold ${darkMode ? 'text-white' : 'text-stone-900'}`}>Recent Trades</h3>
          <button data-tour="db-view-all" onClick={() => setActiveTab('trades')} className="text-orange-500 text-sm font-medium hover:text-orange-400">
            View All →
          </button>
        </div>
        <div className="space-y-3">
          {trades.slice(0, 5).map(trade => (
            <div key={trade.id} className={`flex items-center justify-between p-3 rounded-xl ${darkMode ? 'bg-white/5' : 'bg-stone-50'}`}>
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  trade.outcome === 'win' ? 'bg-green-500/20 text-green-500' : 
                  trade.outcome === 'loss' ? 'bg-red-500/20 text-red-500' : 'bg-yellow-500/20 text-yellow-500'
                }`}>
                  {trade.outcome === 'win' ? <TrendingUp className="w-5 h-5" /> : 
                   trade.outcome === 'loss' ? <TrendingDown className="w-5 h-5" /> : <Clock className="w-5 h-5" />}
                </div>
                <div>
                  <p className={`font-semibold ${darkMode ? 'text-white' : 'text-stone-900'}`}>{trade.pair}</p>
                  <p className={`text-xs ${darkMode ? 'text-stone-500' : 'text-stone-500'}`}>{trade.date} • {trade.session}</p>
                </div>
              </div>
              <p className={`font-bold ${trade.profit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {trade.profit >= 0 ? '+' : ''}${trade.profit?.toLocaleString() || 0}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Analytics + Calendar Side by Side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left Half: Journal Score + Equity Curve + Analytics */}
        <div className="space-y-4">
          {/* Journal Score Radar Chart - TOP */}
          <div className={`rounded-2xl p-5 ${darkMode ? 'bg-white/[0.06] backdrop-blur-xl border border-orange-300/20' : 'bg-white/60 backdrop-blur-xl border border-orange-300/30'}`}>
            <div className="flex items-center justify-between mb-2">
              <h3 className={`text-sm font-semibold ${darkMode ? 'text-stone-300' : 'text-stone-700'}`}>📊 Journal Score</h3>
              <span className={`text-2xl font-bold ${
                (journalScoreData.reduce((sum, item) => sum + item.value, 0) / journalScoreData.length) >= 66 ? 'text-green-500' :
                (journalScoreData.reduce((sum, item) => sum + item.value, 0) / journalScoreData.length) >= 33 ? 'text-yellow-500' : 'text-red-500'
              }`}>
                {(journalScoreData.reduce((sum, item) => sum + item.value, 0) / journalScoreData.length).toFixed(1)}%
              </span>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <RadarChart data={journalScoreData}>
                <PolarGrid stroke={darkMode ? '#ffffff10' : '#e5e7eb'} />
                <PolarAngleAxis dataKey="metric" tick={{ fill: darkMode ? '#64748b' : '#6b7280', fontSize: 11 }} />
                <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: darkMode ? '#64748b' : '#9ca3af', fontSize: 9 }} />
                <Radar name="Performance" dataKey="value" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.3} strokeWidth={2} />
              </RadarChart>
            </ResponsiveContainer>
            {/* Score Bar - Red to Yellow to Green */}
            <div className="relative w-full h-3 rounded-full overflow-hidden bg-gradient-to-r from-red-500 via-yellow-500 to-green-500 mt-3">
              <div 
                className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full border-3 shadow-lg transition-all ${darkMode ? 'border-stone-900' : 'border-stone-800'}`}
                style={{ left: `calc(${journalScoreData.reduce((sum, item) => sum + item.value, 0) / journalScoreData.length}% - 8px)`, borderWidth: '3px' }}
              />
            </div>
          </div>

          {/* Equity Curve - Red to Green Line */}
          <div className={`rounded-2xl p-5 ${darkMode ? 'bg-white/[0.06] backdrop-blur-xl border border-orange-300/20' : 'bg-white/60 backdrop-blur-xl border border-orange-300/30'}`}>
            <div className="flex items-center justify-between mb-2">
              <h3 className={`text-sm font-semibold ${darkMode ? 'text-stone-300' : 'text-stone-700'}`}>📈 Equity Curve</h3>
              <span className={`text-sm font-bold px-2 py-0.5 rounded-lg ${totalProfit >= 0 ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'}`}>
                {totalProfit >= 0 ? '+' : ''}${totalProfit.toLocaleString()}
              </span>
            </div>
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={(() => {
                const sortedTrades = [...trades].sort((a, b) => a.date.localeCompare(b.date));
                let runningTotal = 0;
                const equityData = [{ date: 'Start', equity: 0 }];
                sortedTrades.forEach((trade) => {
                  runningTotal += trade.profit || 0;
                  equityData.push({ date: trade.date, equity: runningTotal });
                });
                return equityData;
              })()}>
                <defs>
                  <linearGradient id="equityLineGradient" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#ef4444" />
                    <stop offset="100%" stopColor="#10b981" />
                  </linearGradient>
                  <linearGradient id="equityFillGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0.05}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? '#ffffff08' : '#e5e7eb'} />
                <XAxis dataKey="date" tick={{ fill: darkMode ? '#64748b' : '#6b7280', fontSize: 9 }} tickFormatter={(v) => v === 'Start' ? '' : v.slice(5)} />
                <YAxis tick={{ fill: darkMode ? '#64748b' : '#6b7280', fontSize: 9 }} tickFormatter={(v) => `$${v}`} width={45} />
                <Tooltip contentStyle={{ backgroundColor: darkMode ? '#1e293b' : '#fff', border: 'none', borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }} />
                <Area type="monotone" dataKey="equity" stroke="url(#equityLineGradient)" fill="url(#equityFillGradient)" strokeWidth={2.5} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Profit by Day */}
          <div className={`rounded-2xl p-5 ${darkMode ? 'bg-white/[0.06] backdrop-blur-xl border border-orange-300/20' : 'bg-white/60 backdrop-blur-xl border border-orange-300/30'}`}>
            <h3 className={`text-sm font-semibold mb-3 ${darkMode ? 'text-stone-300' : 'text-stone-700'}`}>📅 Profit by Day</h3>
            <div className="space-y-1.5">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, idx) => {
                const dayTrades = trades.filter(t => new Date(t.date).getDay() === idx);
                const profit = dayTrades.reduce((sum, t) => sum + (t.profit || 0), 0);
                const maxProfit = Math.max(...[0,1,2,3,4,5,6].map(i => {
                  const dt = trades.filter(t => new Date(t.date).getDay() === i);
                  return Math.abs(dt.reduce((sum, t) => sum + (t.profit || 0), 0));
                }), 1);
                return (
                  <div key={day} className="flex items-center gap-2">
                    <span className={`w-8 text-xs font-medium ${darkMode ? 'text-stone-500' : 'text-stone-500'}`}>{day}</span>
                    <div className={`flex-1 h-4 rounded-full overflow-hidden ${darkMode ? 'bg-white/5' : 'bg-stone-100'}`}>
                      <div className={`h-full ${profit >= 0 ? 'bg-green-500' : 'bg-red-500'} rounded-full`} style={{width: `${(Math.abs(profit) / maxProfit) * 100}%`}} />
                    </div>
                    <span className={`w-14 text-xs text-right font-bold ${profit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {dayTrades.length > 0 ? `${profit >= 0 ? '+' : ''}$${profit.toLocaleString()}` : '—'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Session + Top Pairs side by side */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className={`rounded-2xl p-5 ${darkMode ? 'bg-white/[0.06] backdrop-blur-xl border border-orange-300/20' : 'bg-white/60 backdrop-blur-xl border border-orange-300/30'}`}>
              <h3 className={`text-sm font-semibold mb-3 ${darkMode ? 'text-stone-300' : 'text-stone-700'}`}>🕐 By Session</h3>
              <div className="space-y-1.5">
                {['London', 'New York', 'Asia', 'Sydney'].map(session => {
                  const sessionTrades = trades.filter(t => t.session === session);
                  const profit = sessionTrades.reduce((sum, t) => sum + (t.profit || 0), 0);
                  const maxProfit = Math.max(...['London', 'New York', 'Asia', 'Sydney'].map(s => {
                    const st = trades.filter(t => t.session === s);
                    return Math.abs(st.reduce((sum, t) => sum + (t.profit || 0), 0));
                  }), 1);
                  return (
                    <div key={session} className="flex items-center gap-2">
                      <span className={`w-14 text-xs font-medium ${darkMode ? 'text-stone-500' : 'text-stone-500'}`}>{session}</span>
                      <div className={`flex-1 h-4 rounded-full overflow-hidden ${darkMode ? 'bg-white/5' : 'bg-stone-100'}`}>
                        <div className={`h-full ${profit >= 0 ? 'bg-orange-500' : 'bg-red-500'} rounded-full`} style={{width: `${(Math.abs(profit) / maxProfit) * 100}%`}} />
                      </div>
                      <span className={`w-12 text-xs text-right font-bold ${profit >= 0 ? 'text-orange-500' : 'text-red-500'}`}>
                        {sessionTrades.length > 0 ? `${profit >= 0 ? '+' : ''}$${profit.toLocaleString()}` : '—'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className={`rounded-2xl p-5 ${darkMode ? 'bg-white/[0.06] backdrop-blur-xl border border-orange-300/20' : 'bg-white/60 backdrop-blur-xl border border-orange-300/30'}`}>
              <h3 className={`text-sm font-semibold mb-3 ${darkMode ? 'text-stone-300' : 'text-stone-700'}`}>💱 Top Pairs</h3>
              <div className="space-y-1.5">
                {(() => {
                  const pairStats = {};
                  trades.forEach(t => {
                    if (!pairStats[t.pair]) pairStats[t.pair] = { profit: 0, count: 0 };
                    pairStats[t.pair].profit += t.profit || 0;
                    pairStats[t.pair].count++;
                  });
                  const sorted = Object.entries(pairStats).sort((a, b) => b[1].profit - a[1].profit).slice(0, 5);
                  const maxProfit = Math.max(...sorted.map(([_, s]) => Math.abs(s.profit)), 1);
                  return sorted.length > 0 ? sorted.map(([pair, stats]) => (
                    <div key={pair} className="flex items-center gap-2">
                      <span className={`w-14 text-xs font-bold ${darkMode ? 'text-white' : 'text-stone-900'}`}>{pair}</span>
                      <div className={`flex-1 h-4 rounded-full overflow-hidden ${darkMode ? 'bg-white/5' : 'bg-stone-100'}`}>
                        <div className={`h-full ${stats.profit >= 0 ? 'bg-purple-500' : 'bg-red-500'} rounded-full`} style={{width: `${(Math.abs(stats.profit) / maxProfit) * 100}%`}} />
                      </div>
                      <span className={`w-12 text-xs text-right font-bold ${stats.profit >= 0 ? 'text-purple-500' : 'text-red-500'}`}>
                        {stats.profit >= 0 ? '+' : ''}${stats.profit.toLocaleString()}
                      </span>
                    </div>
                  )) : <p className={`text-sm ${darkMode ? 'text-stone-500' : 'text-stone-400'}`}>No trades yet</p>;
                })()}
              </div>
            </div>
          </div>

          <TagPerformance />
        </div>

        {/* Right Half: Calendar */}
        <div className="space-y-4">
          <div className={`rounded-2xl p-5 ${darkMode ? 'bg-white/[0.06] backdrop-blur-xl border border-orange-300/20' : 'bg-white/60 backdrop-blur-xl border border-orange-300/30'}`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className={`text-base font-bold ${darkMode ? 'text-white' : 'text-stone-900'}`}>Trading Calendar</h3>
              <button
                data-tour="db-add-note"
                onClick={() => {
                  const today = new Date().toISOString().split('T')[0];
                  setEditingNote({ date: today, ...getNoteForDate(today) });
                  setShowDailyNote(true);
                }}
                className="flex items-center gap-2 px-3 py-1.5 bg-orange-500/20 text-orange-400 rounded-lg hover:bg-orange-500/30 text-sm font-medium"
              >
                <BookOpen className="w-4 h-4" />
                Add Note
              </button>
            </div>
            <CalendarView />
          </div>
          {selectedDay && <SelectedDayView />}
        </div>
      </div>
    </>
  );

  // Trades Content Component  
  const TradesContent = () => (
    <>
      <TourGuide
        tourKey="trades"
        darkMode={darkMode}
        steps={[
          {
            target: '[data-tour="trades-search"]',
            title: "Find any trade fast",
            body: "Type a pair here to instantly filter, like EURUSD or GBPJPY.",
          },
          {
            target: '[data-tour="trades-filter"]',
            title: "Narrow it down",
            body: "Click here to filter by tag, win/loss, session, or a date range.",
          },
          {
            target: '[data-tour="trades-add"]',
            title: "Log a new trade",
            body: "Click here to add a trade manually, with entry, stop-loss, take-profit, and more.",
          },
        ]}
      />
      {/* Header with Search, Filter & Add Trade */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h3 className={`text-xl font-bold ${darkMode ? 'text-white' : 'text-stone-900'}`}>Trade History</h3>
          <p className={`text-sm ${darkMode ? 'text-stone-400' : 'text-stone-500'}`}>
            {activeFilterCount > 0 || tradeSearch ? `${getSortedTrades().length} of ${trades.length} trades` : `${trades.length} total trades`}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Pair Search */}
          <div data-tour="trades-search" className="relative">
            <Search className={`w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 ${darkMode ? 'text-stone-500' : 'text-stone-400'}`} />
            <input
              type="text"
              value={tradeSearch}
              onChange={(e) => setTradeSearch(e.target.value)}
              placeholder="Search pair..."
              className={`pl-9 pr-3 py-2 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 ${darkMode ? 'bg-white/5 border-white/10 text-white placeholder-stone-500' : 'bg-white border-stone-200 text-stone-900'}`}
            />
          </div>

          {/* Filters */}
          <div data-tour="trades-filter" className="relative">
            <button
              onClick={() => setShowTagFilter(!showTagFilter)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm ${
                activeFilterCount > 0
                  ? 'border-orange-500 bg-orange-500/20 text-orange-400'
                  : (darkMode ? 'border-white/10 bg-white/5 text-stone-300' : 'border-stone-200 bg-white text-stone-700')
              }`}
            >
              <Filter className="w-4 h-4" />
              Filters
              {activeFilterCount > 0 && (
                <span className="w-5 h-5 flex items-center justify-center rounded-full bg-orange-500 text-white text-xs font-bold">{activeFilterCount}</span>
              )}
              <ChevronDown className="w-4 h-4" />
            </button>
            {showTagFilter && (
              <div className={`absolute right-0 mt-2 w-72 rounded-xl shadow-xl z-50 p-4 space-y-3 ${darkMode ? 'bg-[#1c1611]/95 backdrop-blur-xl border border-orange-300/15' : 'bg-white/95 backdrop-blur-xl border border-orange-200/40'}`}>
                <div>
                  <label className={`text-xs font-semibold uppercase tracking-wide ${darkMode ? 'text-stone-400' : 'text-stone-500'}`}>Tag</label>
                  <select
                    value={selectedTagFilter || ''}
                    onChange={(e) => setSelectedTagFilter(e.target.value || null)}
                    className={`w-full mt-1 px-3 py-2 rounded-lg border text-sm ${darkMode ? 'bg-white/5 border-white/10 text-white' : 'bg-white border-stone-300'}`}
                  >
                    <option value="">All Tags</option>
                    {PRESET_TAGS.map(tag => <option key={tag.name} value={tag.name}>{tag.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={`text-xs font-semibold uppercase tracking-wide ${darkMode ? 'text-stone-400' : 'text-stone-500'}`}>Outcome</label>
                  <select
                    value={filterOutcome}
                    onChange={(e) => setFilterOutcome(e.target.value)}
                    className={`w-full mt-1 px-3 py-2 rounded-lg border text-sm ${darkMode ? 'bg-white/5 border-white/10 text-white' : 'bg-white border-stone-300'}`}
                  >
                    <option value="all">All</option>
                    <option value="win">Wins</option>
                    <option value="loss">Losses</option>
                    <option value="open">Open / Pending</option>
                  </select>
                </div>
                <div>
                  <label className={`text-xs font-semibold uppercase tracking-wide ${darkMode ? 'text-stone-400' : 'text-stone-500'}`}>Session</label>
                  <select
                    value={filterSession}
                    onChange={(e) => setFilterSession(e.target.value)}
                    className={`w-full mt-1 px-3 py-2 rounded-lg border text-sm ${darkMode ? 'bg-white/5 border-white/10 text-white' : 'bg-white border-stone-300'}`}
                  >
                    <option value="all">All Sessions</option>
                    <option value="Asia">Asia</option>
                    <option value="London">London</option>
                    <option value="New York">New York</option>
                    <option value="Sydney">Sydney</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={`text-xs font-semibold uppercase tracking-wide ${darkMode ? 'text-stone-400' : 'text-stone-500'}`}>From</label>
                    <input
                      type="date"
                      value={filterDateFrom}
                      onChange={(e) => setFilterDateFrom(e.target.value)}
                      className={`w-full mt-1 px-2 py-2 rounded-lg border text-sm ${darkMode ? 'bg-white/5 border-white/10 text-white' : 'bg-white border-stone-300'}`}
                    />
                  </div>
                  <div>
                    <label className={`text-xs font-semibold uppercase tracking-wide ${darkMode ? 'text-stone-400' : 'text-stone-500'}`}>To</label>
                    <input
                      type="date"
                      value={filterDateTo}
                      onChange={(e) => setFilterDateTo(e.target.value)}
                      className={`w-full mt-1 px-2 py-2 rounded-lg border text-sm ${darkMode ? 'bg-white/5 border-white/10 text-white' : 'bg-white border-stone-300'}`}
                    />
                  </div>
                </div>
                <button
                  onClick={clearAllFilters}
                  disabled={activeFilterCount === 0}
                  className={`w-full text-center px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed ${darkMode ? 'text-orange-400 hover:bg-orange-500/10' : 'text-orange-600 hover:bg-orange-50'}`}
                >
                  Clear all filters
                </button>
              </div>
            )}
          </div>

          <button
            data-tour="trades-add"
            onClick={() => setShowAddTrade(true)}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-600 to-amber-600 text-white rounded-xl hover:from-orange-500 hover:to-amber-500 font-medium shadow-lg shadow-orange-500/25"
          >
            <Plus className="w-4 h-4" />
            Add Trade
          </button>
        </div>
      </div>

      {/* Trades Table */}
      <div className={`rounded-2xl overflow-hidden ${darkMode ? 'bg-white/[0.06] backdrop-blur-xl border border-orange-300/20' : 'bg-white/60 backdrop-blur-xl border border-orange-300/30'}`}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className={darkMode ? 'bg-white/5' : 'bg-stone-50'}>
                {[
                  { label: 'Date', field: 'date' },
                  { label: 'Pair', field: 'pair' },
                  { label: 'Direction', field: 'direction' },
                  { label: 'Entry', field: null },
                  { label: 'R:R', field: 'rr' },
                  { label: 'Duration', field: 'duration' },
                  { label: 'P&L', field: 'profit' },
                  { label: 'Tags', field: null },
                  { label: 'Actions', field: null },
                ].map(({ label, field }) => (
                  <th key={label} className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider ${darkMode ? 'text-stone-400' : 'text-stone-500'}`}>
                    {field ? (
                      <button
                        onClick={() => handleSort(field)}
                        className="flex items-center gap-1 hover:text-orange-500 transition-colors"
                      >
                        {label}
                        <SortIcon field={field} />
                      </button>
                    ) : label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className={`divide-y ${darkMode ? 'divide-white/5' : 'divide-stone-100'}`}>
              {getSortedTrades().map(trade => (
                <tr key={trade.id} className={`${darkMode ? 'hover:bg-white/5' : 'hover:bg-stone-50'} transition-colors`}>
                  <td className={`px-4 py-4 text-sm ${darkMode ? 'text-stone-300' : 'text-stone-900'}`}>
                    <div>{trade.date}</div>
                    {trade.openedAt && (
                      <div className={`text-xs ${darkMode ? 'text-stone-500' : 'text-stone-400'}`}>{formatDateTime(trade.openedAt)?.time}</div>
                    )}
                  </td>
                  <td className={`px-4 py-4 font-semibold ${darkMode ? 'text-white' : 'text-stone-900'}`}>{trade.pair}</td>
                  <td className="px-4 py-4">
                    <span className={`px-2 py-1 rounded-lg text-xs font-semibold ${
                      trade.direction === 'buy' ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'
                    }`}>
                      {trade.direction.toUpperCase()}
                    </span>
                  </td>
                  <td className={`px-4 py-4 text-sm ${darkMode ? 'text-stone-300' : 'text-stone-600'}`}>{trade.entry}</td>
                  <td className={`px-4 py-4 text-sm font-medium ${darkMode ? 'text-stone-300' : 'text-stone-600'}`}>{formatRR(getRiskReward(trade))}</td>
                  <td className={`px-4 py-4 text-sm ${darkMode ? 'text-stone-300' : 'text-stone-600'}`}>
                    {getTradeDuration(trade) ? (
                      <>
                        <div className="whitespace-nowrap">
                          {formatDateTime(trade.openedAt)?.time}
                          {trade.closedAt ? ` → ${formatDateTime(trade.closedAt)?.time}` : ''}
                        </div>
                        <div className={`text-xs ${trade.closedAt ? (darkMode ? 'text-stone-500' : 'text-stone-400') : 'text-amber-500'}`}>
                          {getTradeDuration(trade).label}{!trade.closedAt ? ' (open)' : ''}
                        </div>
                      </>
                    ) : (
                      <span className={darkMode ? 'text-stone-600' : 'text-stone-300'}>—</span>
                    )}
                  </td>
                  <td className={`px-4 py-4 font-bold ${trade.profit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {trade.profit >= 0 ? '+' : ''}${trade.profit?.toLocaleString() || 0}
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex gap-1 flex-wrap">
                      {(trade.tags || []).slice(0, 2).map(tag => {
                        const tagConfig = PRESET_TAGS.find(t => t.name === tag);
                        return (
                          <span key={tag} className={`px-2 py-0.5 rounded text-xs text-white ${tagConfig?.color || 'bg-stone-500'}`}>
                            {tag}
                          </span>
                        );
                      })}
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-1">
                      <button onClick={() => setSelectedTrade(trade)} className={`p-2 rounded-lg ${darkMode ? 'hover:bg-white/10 text-stone-400' : 'hover:bg-stone-100 text-stone-500'}`}>
                        <Eye className="w-4 h-4" />
                      </button>
                      {!trade.outcome ? (
                        <button
                          onClick={() => { setEditTrade({...trade}); setShowEditTrade(true); }}
                          title="Close trade & add results"
                          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold ${darkMode ? 'bg-green-500/15 text-green-400 hover:bg-green-500/25' : 'bg-green-100 text-green-700 hover:bg-green-200'}`}
                        >
                          <CheckCircle className="w-4 h-4" />
                          Close
                        </button>
                      ) : (
                        <button onClick={() => { setEditTrade({...trade}); setShowEditTrade(true); }} title="Edit trade" className={`p-2 rounded-lg ${darkMode ? 'hover:bg-white/10 text-stone-400' : 'hover:bg-stone-100 text-stone-500'}`}>
                          <Edit2 className="w-4 h-4" />
                        </button>
                      )}
                      <button onClick={() => handleDeleteTrade(trade.id)} className={`p-2 rounded-lg ${darkMode ? 'hover:bg-red-500/20 text-stone-400 hover:text-red-400' : 'hover:bg-red-100 text-stone-500 hover:text-red-600'}`}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {trades.length === 0 && (
          <div className="text-center py-12">
            <BarChart3 className={`w-12 h-12 mx-auto mb-3 ${darkMode ? 'text-stone-600' : 'text-stone-300'}`} />
            <p className={`font-semibold ${darkMode ? 'text-stone-400' : 'text-stone-500'}`}>No trades yet</p>
            <p className={`text-sm ${darkMode ? 'text-stone-500' : 'text-stone-400'}`}>Add your first trade to get started</p>
          </div>
        )}
      </div>
    </>
  );

  // Analytics Content Component
  // Tag Performance panel - shows win rate & P&L per trade tag
  const TagPerformance = () => (
    trades.some(t => t.tags && t.tags.length > 0) ? (
      <div className={`rounded-2xl p-6 ${darkMode ? 'bg-white/[0.06] backdrop-blur-xl border border-orange-300/20' : 'bg-white/60 backdrop-blur-xl border border-orange-300/30'}`}>
        <h3 className={`text-lg font-bold mb-4 ${darkMode ? 'text-white' : 'text-stone-900'}`}>Tag Performance</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {PRESET_TAGS.map(tag => {
            const tagTrades = trades.filter(t => t.tags && t.tags.includes(tag.name));
            if (tagTrades.length === 0) return null;
            const profit = tagTrades.reduce((sum, t) => sum + (t.profit || 0), 0);
            const wins = tagTrades.filter(t => t.outcome === 'win').length;
            const winRate = tagTrades.filter(t => t.outcome).length > 0 ? (wins / tagTrades.filter(t => t.outcome).length * 100) : 0;
            return (
              <div key={tag.name} className={`p-3 rounded-xl ${darkMode ? 'bg-white/5' : 'bg-stone-50'}`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`w-2 h-2 rounded-full ${tag.color}`} />
                  <span className={`text-sm font-medium ${darkMode ? 'text-white' : 'text-stone-900'}`}>{tag.name}</span>
                </div>
                <p className={`text-xs ${darkMode ? 'text-stone-500' : 'text-stone-500'}`}>{tagTrades.length} trades</p>
                <p className={`text-sm font-bold ${profit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {profit >= 0 ? '+' : ''}${profit.toLocaleString()}
                </p>
                <p className={`text-xs ${winRate >= 50 ? 'text-green-500' : 'text-red-500'}`}>{winRate.toFixed(0)}% WR</p>
              </div>
            );
          })}
        </div>
      </div>
    ) : null
  );

  // ============================================
  // MAIN DASHBOARD (logged in)
  // ============================================

  // Navigation items for sidebar
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'trades', label: 'All Trades', icon: BarChart3 },
    { id: 'journal', label: 'Journal', icon: BookOpen },
  ];

  return (
    <div className={`relative min-h-screen flex overflow-hidden ${darkMode ? 'bg-gradient-to-br from-stone-950 via-orange-950 to-stone-900' : 'bg-gradient-to-br from-orange-50 via-stone-50 to-orange-100'}`}>
      {/* Ambient glass orbs */}
      <div className="absolute -left-32 top-0 w-[32rem] h-[32rem] rounded-full pointer-events-none z-0" style={{background: 'radial-gradient(circle at 35% 30%, #FFC98A, #F2994A 55%, #D9642B 100%)', filter: 'blur(90px)', opacity: darkMode ? 0.16 : 0.22}}></div>
      <div className="absolute right-0 top-1/3 w-[28rem] h-[28rem] rounded-full pointer-events-none z-0" style={{background: 'radial-gradient(circle at 35% 30%, #FFC98A, #F2994A 60%, #D9642B 100%)', filter: 'blur(100px)', opacity: darkMode ? 0.13 : 0.18}}></div>
      <div className="absolute left-1/3 -bottom-40 w-[36rem] h-[36rem] rounded-full pointer-events-none z-0" style={{background: 'radial-gradient(circle at 35% 30%, #FFC98A, #F2994A 55%, #D9642B 100%)', filter: 'blur(110px)', opacity: darkMode ? 0.12 : 0.16}}></div>

      {/* Mobile sidebar backdrop */}
      {mobileSidebarOpen && (
        <div
          onClick={() => setMobileSidebarOpen(false)}
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
        />
      )}

      {/* Sidebar */}
      <aside className={`w-64 ${sidebarCollapsed ? 'md:w-20' : 'md:w-64'} fixed left-0 top-0 h-full z-50 transition-all duration-300 transform ${
        mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
      } md:translate-x-0 ${
        darkMode
          ? 'bg-[#1c1611]/85 backdrop-blur-2xl border-r border-orange-300/10'
          : 'bg-white/75 backdrop-blur-2xl border-r border-orange-200/40'
      }`}>
        <div className="flex flex-col h-full">
          {/* Logo Section */}
          <div className={`p-4 pt-[calc(1rem+env(safe-area-inset-top))] ${sidebarCollapsed ? 'px-4' : 'px-6'} border-b ${darkMode ? 'border-orange-300/10' : 'border-orange-200/30'}`}>
            <button 
              onClick={() => setActiveTab('dashboard')} 
              className="flex items-center gap-3 w-full"
            >
              <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0 shadow-lg shadow-orange-500/25">
                <img src="/dashboard-icon.png" alt="Shinobi" className="w-full h-full object-cover" />
              </div>
              {!sidebarCollapsed && (
                <div className="text-left">
                  <img src="/stj-wordmark.png" alt="STJ" className="h-5 rounded" />
                  <p className={`text-xs mt-0.5 ${darkMode ? 'text-stone-500' : 'text-stone-400'}`}>Trading Journal</p>
                </div>
              )}
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 p-3 space-y-1 overflow-y-auto scrollbar-thin">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => { setActiveTab(item.id); setMobileSidebarOpen(false); }}
                  className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 group ${
                    isActive
                      ? (darkMode 
                          ? 'bg-gradient-to-r from-orange-600/20 to-amber-600/20 text-orange-400 border border-orange-500/20' 
                          : 'bg-orange-50 text-orange-600 border border-orange-100')
                      : (darkMode 
                          ? 'text-stone-400 hover:text-white hover:bg-white/5' 
                          : 'text-stone-600 hover:text-stone-900 hover:bg-stone-100')
                  } ${sidebarCollapsed ? 'justify-center' : ''}`}
                  title={sidebarCollapsed ? item.label : ''}
                >
                  <Icon className={`w-5 h-5 flex-shrink-0 ${isActive ? '' : 'group-hover:scale-110'} transition-transform`} />
                  {!sidebarCollapsed && (
                    <span className="font-medium">{item.label}</span>
                  )}
                  {isActive && !sidebarCollapsed && (
                    <div className="ml-auto w-1.5 h-1.5 rounded-full bg-orange-500" />
                  )}
                </button>
              );
            })}

            {/* Add Trade Button */}
            <button
              onClick={() => { setShowAddTrade(true); setMobileSidebarOpen(false); }}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 mt-4 ${
                darkMode 
                  ? 'bg-gradient-to-r from-orange-600 to-amber-600 text-white hover:from-orange-500 hover:to-amber-500 shadow-lg shadow-orange-500/25' 
                  : 'bg-gradient-to-r from-orange-600 to-amber-600 text-white hover:from-orange-500 hover:to-amber-500'
              } ${sidebarCollapsed ? 'justify-center' : ''}`}
            >
              <Plus className="w-5 h-5 flex-shrink-0" />
              {!sidebarCollapsed && <span className="font-semibold">New Trade</span>}
            </button>

            {/* Import Trades Button */}
            <button
              onClick={() => { setShowImportCSV(true); setMobileSidebarOpen(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 mt-2 ${
                darkMode 
                  ? 'bg-white/5 text-stone-300 hover:bg-white/10 border border-white/10' 
                  : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
              } ${sidebarCollapsed ? 'justify-center' : ''}`}
            >
              <Upload className="w-4 h-4 flex-shrink-0" />
              {!sidebarCollapsed && <span className="text-sm font-medium">Import Trades</span>}
            </button>

            {/* Export CSV Button */}
            <button
              onClick={() => { exportTradesToCSV(); setMobileSidebarOpen(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 mt-2 ${
                darkMode
                  ? 'bg-white/5 text-stone-300 hover:bg-white/10 border border-white/10'
                  : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
              } ${sidebarCollapsed ? 'justify-center' : ''}`}
            >
              <Download className="w-4 h-4 flex-shrink-0" />
              {!sidebarCollapsed && <span className="text-sm font-medium">Export CSV</span>}
            </button>
          </nav>

          {/* Bottom Section */}
          <div className={`p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] border-t ${darkMode ? 'border-white/5' : 'border-stone-100'} space-y-1 overflow-y-auto scrollbar-thin`}>
            {/* Theme Toggle */}
            <button
              onClick={() => setDarkMode(!darkMode)}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all ${
                darkMode ? 'text-stone-400 hover:text-white hover:bg-white/5' : 'text-stone-600 hover:bg-stone-100'
              } ${sidebarCollapsed ? 'justify-center' : ''}`}
            >
              {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              {!sidebarCollapsed && <span className="font-medium">{darkMode ? 'Light Mode' : 'Dark Mode'}</span>}
            </button>

            {/* Profile Button */}
            <button
              onClick={() => { setActiveTab('profile'); setMobileSidebarOpen(false); }}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all ${
                activeTab === 'profile'
                  ? (darkMode ? 'bg-white/10 text-white' : 'bg-stone-100 text-stone-900')
                  : (darkMode ? 'text-stone-400 hover:text-white hover:bg-white/5' : 'text-stone-600 hover:bg-stone-100')
              } ${sidebarCollapsed ? 'justify-center' : ''}`}
            >
              <Settings className="w-5 h-5" />
              {!sidebarCollapsed && <span className="font-medium">Settings</span>}
            </button>

            {/* Collapse Toggle - desktop only, mobile uses the off-canvas drawer instead */}
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className={`hidden md:flex w-full items-center gap-3 px-3 py-3 rounded-xl transition-all ${
                darkMode ? 'text-stone-400 hover:text-white hover:bg-white/5' : 'text-stone-600 hover:bg-stone-100'
              } ${sidebarCollapsed ? 'justify-center' : ''}`}
            >
              {sidebarCollapsed ? <PanelLeft className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />}
              {!sidebarCollapsed && <span className="font-medium">Collapse</span>}
            </button>

            {/* Support the Developer */}
            <a
              href="https://ko-fi.com/raadkhalid"
              target="_blank"
              rel="noopener noreferrer"
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all ${
                darkMode ? 'text-orange-400 hover:text-orange-300 hover:bg-orange-500/10' : 'text-orange-600 hover:bg-orange-50'
              } ${sidebarCollapsed ? 'justify-center' : ''}`}
            >
              <Coffee className="w-5 h-5 flex-shrink-0" />
              {!sidebarCollapsed && <span className="font-medium">Support the Developer</span>}
            </a>

            {/* Send Feedback */}
            <a
              href="mailto:shinobitradingjournal@gmail.com?subject=Shinobi%20Trading%20Journal%20Feedback"
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all ${
                darkMode ? 'text-stone-400 hover:text-white hover:bg-white/5' : 'text-stone-600 hover:bg-stone-100'
              } ${sidebarCollapsed ? 'justify-center' : ''}`}
            >
              <MessageSquare className="w-5 h-5 flex-shrink-0" />
              {!sidebarCollapsed && <span className="font-medium">Send Feedback</span>}
            </a>

            {/* User Profile Card */}
            {!sidebarCollapsed && (
              <div className={`mt-3 p-3 rounded-xl ${darkMode ? 'bg-white/5' : 'bg-stone-100'}`}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center text-white font-bold text-sm">
                    {(profile?.full_name || 'U')[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`font-semibold truncate text-sm ${darkMode ? 'text-white' : 'text-stone-900'}`}>
                      {profile?.full_name || 'Trader'}
                    </p>
                    <p className={`text-xs truncate ${darkMode ? 'text-stone-500' : 'text-stone-400'}`}>
                      {user?.email}
                    </p>
                  </div>
                  <button
                    onClick={async () => {
                      await signOut();
                      window.location.reload();
                    }}
                    className={`p-2 rounded-lg transition-colors ${darkMode ? 'hover:bg-red-500/20 text-stone-400 hover:text-red-400' : 'hover:bg-red-100 text-stone-400 hover:text-red-600'}`}
                    title="Sign Out"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className={`relative z-10 flex-1 min-w-0 ${sidebarCollapsed ? 'md:ml-20' : 'md:ml-64'} transition-all duration-300`}>
        {/* Top Header Bar */}
        <header className={`sticky top-0 z-30 pt-[env(safe-area-inset-top)] ${darkMode ? 'bg-[#0e0b09]/80 backdrop-blur-xl border-b border-orange-300/10' : 'bg-white/80 backdrop-blur-xl border-b border-orange-200/40'}`}>
          <div className="px-4 sm:px-6 py-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  onClick={() => setMobileSidebarOpen(true)}
                  className={`md:hidden p-2 -ml-2 rounded-lg flex-shrink-0 ${darkMode ? 'text-stone-300 hover:bg-white/10' : 'text-stone-600 hover:bg-stone-100'}`}
                >
                  <Menu className="w-6 h-6" />
                </button>
                <div className="min-w-0">
                  <h2 className={`text-xl sm:text-2xl font-bold truncate ${darkMode ? 'text-white' : 'text-stone-900'}`}>
                    {activeTab === 'dashboard' && 'Dashboard'}
                    {activeTab === 'trades' && 'All Trades'}
                    {activeTab === 'journal' && 'Journal'}
                    {activeTab === 'profile' && 'Settings'}
                  </h2>
                  <p className={`text-sm hidden sm:block ${darkMode ? 'text-stone-500' : 'text-stone-500'}`}>
                    {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 flex-shrink-0">
                {/* Quick Stats */}
                <div className={`hidden md:flex items-center gap-4 px-4 py-2 rounded-xl ${darkMode ? 'bg-white/5' : 'bg-stone-100'}`}>
                  <div className="text-center">
                    <p className={`text-xs ${darkMode ? 'text-stone-500' : 'text-stone-500'}`}>Total P&L</p>
                    <p className={`font-bold ${totalProfit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {totalProfit >= 0 ? '+' : ''}${totalProfit.toLocaleString()}
                    </p>
                  </div>
                  <div className={`w-px h-8 ${darkMode ? 'bg-white/10' : 'bg-stone-300'}`} />
                  <div className="text-center">
                    <p className={`text-xs ${darkMode ? 'text-stone-500' : 'text-stone-500'}`}>Win Rate</p>
                    <p className={`font-bold ${darkMode ? 'text-white' : 'text-stone-900'}`}>{winRate}%</p>
                  </div>
                  <div className={`w-px h-8 ${darkMode ? 'bg-white/10' : 'bg-stone-300'}`} />
                  <div className="text-center">
                    <p className={`text-xs ${darkMode ? 'text-stone-500' : 'text-stone-500'}`}>Trades</p>
                    <p className={`font-bold ${darkMode ? 'text-white' : 'text-stone-900'}`}>{totalTrades}</p>
                  </div>
                </div>

                {/* Syncing happens automatically in the background - no button needed.
                    Only surface something here if there's actually a problem. */}
                {!isOnline && (
                  <div
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl ${darkMode ? 'bg-red-500/10 text-red-400' : 'bg-red-100 text-red-600'}`}
                    title="No connection - changes won't be saved until you're back online"
                  >
                    <CloudOff className="w-4 h-4" />
                    <span className="text-sm font-medium hidden sm:inline">Offline</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <div className="p-6">
          {/* Loading State */}
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20">
              <div className="relative">
                <div className="w-16 h-16 rounded-full border-4 border-orange-500/20 border-t-orange-500 animate-spin" />
                <Zap className="w-6 h-6 text-orange-500 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
              </div>
              <p className={`text-lg font-semibold mt-4 ${darkMode ? 'text-white' : 'text-stone-900'}`}>Loading your trades...</p>
              <p className={`text-sm ${darkMode ? 'text-stone-500' : 'text-stone-500'}`}>Connecting to cloud</p>
            </div>
          ) : activeTab === 'journal' ? (
            <div className="space-y-6">
              <TourGuide
                tourKey="journal"
                darkMode={darkMode}
                steps={[
                  {
                    title: "Your Daily Journal",
                    body: "This is where you capture your mindset, mistakes, and lessons for each trading day - separate from individual trade notes.",
                  },
                  {
                    target: '[data-tour="journal-new-entry"]',
                    title: "Add today's entry",
                    body: "Click here to log today's morning mindset and evening reflection.",
                  },
                ]}
              />
              <div className="flex items-center justify-between">
                <div>
                  <h3 className={`text-xl font-bold ${darkMode ? 'text-white' : 'text-stone-900'}`}>Daily Journal</h3>
                  <p className={`text-sm ${darkMode ? 'text-stone-400' : 'text-stone-500'}`}>Your trading reflections and notes</p>
                </div>
                <button
                  data-tour="journal-new-entry"
                  onClick={() => {
                    const today = new Date().toISOString().split('T')[0];
                    setEditingNote({ date: today, ...getNoteForDate(today) });
                    setShowDailyNote(true);
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-600 to-amber-600 text-white rounded-xl hover:from-orange-500 hover:to-amber-500 text-sm font-medium shadow-lg shadow-orange-500/25"
                >
                  <Plus className="w-4 h-4" />
                  New Entry
                </button>
              </div>
              
              {/* Journal Entries Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {dailyNotes.length > 0 ? dailyNotes.map(note => (
                  <div 
                    key={note.id}
                    className={`p-5 rounded-2xl border transition-all hover:scale-[1.02] ${
                      darkMode ? 'bg-white/5 border-white/10 hover:border-orange-500/50' : 'bg-white border-stone-200 hover:border-orange-300'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <p className={`text-sm font-bold ${darkMode ? 'text-white' : 'text-stone-900'}`}>
                        {new Date(note.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                      </p>
                      <div className="flex items-center gap-2">
                        {note.mood && (
                          <span className="text-lg">
                            {note.mood === 'Great' ? '😊' : note.mood === 'Bad' ? '😔' : '😐'}
                          </span>
                        )}
                        {note.market_bias && (
                          <span className="text-lg">
                            {note.market_bias === 'Bullish' ? '📈' : note.market_bias === 'Bearish' ? '📉' : '➡️'}
                          </span>
                        )}
                      </div>
                    </div>
                    <div 
                      onClick={() => {
                        setEditingNote({ date: note.date, ...note });
                        setShowDailyNote(true);
                      }}
                      className="cursor-pointer"
                    >
                      {note.morning_note && (
                        <p className={`text-sm mb-2 line-clamp-2 ${darkMode ? 'text-stone-400' : 'text-stone-600'}`}>
                          ☀️ {note.morning_note}
                        </p>
                      )}
                      {note.evening_note && (
                        <p className={`text-sm line-clamp-2 ${darkMode ? 'text-stone-400' : 'text-stone-600'}`}>
                          🌙 {note.evening_note}
                        </p>
                      )}
                      {!note.morning_note && !note.evening_note && (
                        <p className={`text-sm ${darkMode ? 'text-stone-500' : 'text-stone-400'}`}>Click to add notes...</p>
                      )}
                    </div>
                    <div className={`mt-3 pt-3 border-t ${darkMode ? 'border-white/10' : 'border-stone-100'} flex items-center justify-between`}>
                      <div className="flex items-center gap-3">
                        {getTradesForDate(note.date).length > 0 && (
                          <>
                            <span className={`text-xs ${darkMode ? 'text-stone-500' : 'text-stone-400'}`}>
                              {getTradesForDate(note.date).length} trades
                            </span>
                            <span className={`text-xs font-bold ${getProfitForDate(note.date) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                              {getProfitForDate(note.date) >= 0 ? '+' : ''}${getProfitForDate(note.date).toLocaleString()}
                            </span>
                          </>
                        )}
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm('Delete this journal entry?')) {
                            deleteDailyNote(note.id);
                          }
                        }}
                        className={`p-1.5 rounded-lg transition-colors ${darkMode ? 'hover:bg-red-500/20 text-stone-500 hover:text-red-400' : 'hover:bg-red-100 text-stone-400 hover:text-red-600'}`}
                        title="Delete note"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )) : (
                  <div className={`col-span-full text-center py-12 rounded-2xl border-2 border-dashed ${darkMode ? 'border-white/10' : 'border-stone-200'}`}>
                    <BookOpen className={`w-12 h-12 mx-auto mb-3 ${darkMode ? 'text-stone-600' : 'text-stone-300'}`} />
                    <p className={`font-semibold ${darkMode ? 'text-stone-400' : 'text-stone-500'}`}>No journal entries yet</p>
                    <p className={`text-sm ${darkMode ? 'text-stone-500' : 'text-stone-400'}`}>Start documenting your trading journey</p>
                  </div>
                )}
              </div>
            </div>
          ) : activeTab === 'dashboard' ? (
            <div className="space-y-6">
              <DashboardContent />
            </div>
          ) : (
            <div className="space-y-6">
              <TradesContent />
            </div>
          )}
        </div>
      </main>

      {showAddTrade && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className={`${darkMode ? 'bg-[#1c1611]/85 backdrop-blur-2xl border border-orange-300/15' : 'bg-white/75 backdrop-blur-2xl border border-orange-200/40'} rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto scrollbar-thin`}>
            <div className={`p-4 sm:p-6 border-b flex justify-between sticky top-0 ${darkMode ? 'bg-[#1c1611]/90 backdrop-blur-xl border-orange-300/15' : 'bg-white/85 backdrop-blur-xl border-orange-200/40'}`}>
              <h2 className={`text-xl sm:text-2xl font-bold ${darkMode ? 'text-white' : 'text-stone-900'}`}>Add New Trade</h2>
              <button onClick={() => setShowAddTrade(false)} className={`p-2 rounded-lg ${darkMode ? 'hover:bg-white/10 text-stone-400' : 'hover:bg-stone-100'}`}>
                <XCircle className="w-6 h-6" />
              </button>
            </div>
            
            <div className="p-4 sm:p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={`block text-sm font-semibold mb-2 ${darkMode ? 'text-stone-300' : 'text-stone-700'}`}>Date</label>
                  {/* iOS ignores CSS height/padding on native date inputs, so the real
                      input is made invisible and sized to fill this box exactly (absolute
                      positioning isn't affected by its native content size); taps still open
                      the native picker. What's actually seen is this fully-controlled div. */}
                  <div className="relative group">
                    <div className={`w-full h-[50px] px-4 border rounded-xl flex items-center group-focus-within:ring-2 group-focus-within:ring-orange-500 ${darkMode ? 'bg-white/5 border-white/10 text-white' : 'border-stone-300 text-stone-900'}`}>
                      {newTrade.date
                        ? new Date(newTrade.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                        : <span className={darkMode ? 'text-stone-500' : 'text-stone-400'}>Select date</span>}
                    </div>
                    <input
                      type="date"
                      value={newTrade.date}
                      onChange={(e) => setNewTrade({...newTrade, date: e.target.value})}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                  </div>
                </div>
                <div>
                  <label className={`block text-sm font-semibold mb-2 ${darkMode ? 'text-stone-300' : 'text-stone-700'}`}>Pair</label>
                  <input 
                    type="text" 
                    placeholder="NZDCAD"
                    value={newTrade.pair}
                    onChange={(e) => setNewTrade({...newTrade, pair: e.target.value.replace(/[^a-zA-Z]/g, '').toUpperCase()})}
                    className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-orange-500 ${darkMode ? 'bg-white/5 border-white/10 text-white placeholder-stone-500' : 'border-stone-300'}`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={`block text-sm font-semibold mb-2 ${darkMode ? 'text-stone-300' : 'text-stone-700'}`}>Direction</label>
                  <select 
                    value={newTrade.direction}
                    onChange={(e) => setNewTrade({...newTrade, direction: e.target.value})}
                    className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-orange-500 ${darkMode ? 'bg-[#241c15] border-white/10 text-white [&>option]:bg-[#241c15] [&>option]:text-white' : 'border-stone-300'}`}
                  >
                    <option value="buy">Buy</option>
                    <option value="sell">Sell</option>
                  </select>
                </div>
                <div>
                  <label className={`block text-sm font-semibold mb-2 ${darkMode ? 'text-stone-300' : 'text-stone-700'}`}>Session</label>
                  <select 
                    value={newTrade.session}
                    onChange={(e) => setNewTrade({...newTrade, session: e.target.value})}
                    className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-orange-500 ${darkMode ? 'bg-[#241c15] border-white/10 text-white [&>option]:bg-[#241c15] [&>option]:text-white' : 'border-stone-300'}`}
                  >
                    <option value="London">London</option>
                    <option value="New York">New York</option>
                    <option value="Asia">Asia</option>
                    <option value="Sydney">Sydney</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className={`block text-sm font-semibold mb-2 ${darkMode ? 'text-stone-300' : 'text-stone-700'}`}>Entry</label>
                  <input 
                    type="number" 
                    step="0.00001"
                    value={newTrade.entry}
                    onChange={(e) => setNewTrade({...newTrade, entry: e.target.value})}
                    className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-orange-500 ${darkMode ? 'bg-white/5 border-white/10 text-white' : 'border-stone-300'}`}
                  />
                </div>
                <div>
                  <label className={`block text-sm font-semibold mb-2 ${darkMode ? 'text-stone-300' : 'text-stone-700'}`}>Stop Loss</label>
                  <input 
                    type="number" 
                    step="0.00001"
                    value={newTrade.sl}
                    onChange={(e) => setNewTrade({...newTrade, sl: e.target.value})}
                    className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-orange-500 ${darkMode ? 'bg-white/5 border-white/10 text-white' : 'border-stone-300'}`}
                  />
                </div>
                <div>
                  <label className={`block text-sm font-semibold mb-2 ${darkMode ? 'text-stone-300' : 'text-stone-700'}`}>Take Profit</label>
                  <input
                    type="number"
                    step="0.00001"
                    value={newTrade.tp}
                    onChange={(e) => setNewTrade({...newTrade, tp: e.target.value})}
                    className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-orange-500 ${darkMode ? 'bg-white/5 border-white/10 text-white' : 'border-stone-300'}`}
                  />
                </div>
              </div>

              {newTrade.entry && newTrade.sl && newTrade.tp && (
                <div className={`rounded-xl px-4 py-2.5 text-sm font-medium ${darkMode ? 'bg-orange-500/10 text-orange-400' : 'bg-orange-50 text-orange-700'}`}>
                  Risk:Reward — {formatRR(getRiskReward(newTrade))}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className={`block text-sm font-semibold ${darkMode ? 'text-stone-300' : 'text-stone-700'}`}>Lot Size</label>
                    <a
                      href="https://www.myfxbook.com/forex-calculators/position-size"
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`flex items-center gap-1 text-xs font-medium ${darkMode ? 'text-orange-400 hover:text-orange-300' : 'text-orange-600 hover:text-orange-700'}`}
                    >
                      <Calculator className="w-3.5 h-3.5" />
                      Calculate
                    </a>
                  </div>
                  <input 
                    type="number" 
                    step="0.1"
                    value={newTrade.lotSize}
                    onChange={(e) => setNewTrade({...newTrade, lotSize: e.target.value})}
                    className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-orange-500 ${darkMode ? 'bg-white/5 border-white/10 text-white' : 'border-stone-300'}`}
                  />
                </div>
                <div>
                  <label className={`block text-sm font-semibold mb-2 ${darkMode ? 'text-stone-300' : 'text-stone-700'}`}>Risk %</label>
                  <div className="relative">
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      placeholder="2"
                      value={newTrade.risk}
                      onChange={(e) => setNewTrade({...newTrade, risk: e.target.value})}
                      className={`w-full pl-4 pr-8 py-3 border rounded-xl focus:ring-2 focus:ring-orange-500 ${darkMode ? 'bg-white/5 border-white/10 text-white' : 'border-stone-300'}`}
                    />
                    <span className={`absolute right-4 top-1/2 -translate-y-1/2 text-sm pointer-events-none ${darkMode ? 'text-stone-400' : 'text-stone-400'}`}>%</span>
                  </div>
                </div>
              </div>

              <div>
                <label className={`block text-sm font-semibold mb-2 ${darkMode ? 'text-stone-300' : 'text-stone-700'}`}>
                  Pre-Trade Analysis
                  <span className={`text-xs font-normal ml-2 ${newTrade.preNotes.length > 900 ? 'text-red-500' : darkMode ? 'text-stone-500' : 'text-stone-400'}`}>
                    {newTrade.preNotes.length}/1000
                  </span>
                </label>
                <textarea 
                  rows="4"
                  maxLength={1000}
                  placeholder="Why are you taking this trade? What's your analysis?"
                  value={newTrade.preNotes}
                  onChange={(e) => setNewTrade({...newTrade, preNotes: e.target.value})}
                  className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-orange-500 resize-none ${darkMode ? 'bg-white/5 border-white/10 text-white placeholder-stone-500' : 'border-stone-300'}`}
                />
              </div>

              <div>
                <label className={`block text-sm font-semibold mb-2 ${darkMode ? 'text-stone-300' : 'text-stone-700'}`}>How Are You Feeling?</label>
                <select 
                  value={newTrade.emotion}
                  onChange={(e) => setNewTrade({...newTrade, emotion: e.target.value})}
                  className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-orange-500 ${darkMode ? 'bg-[#241c15] border-white/10 text-white [&>option]:bg-[#241c15] [&>option]:text-white' : 'border-stone-300'}`}
                >
                  <option value="Confident">Confident</option>
                  <option value="Neutral">Neutral</option>
                  <option value="Anxious">Anxious</option>
                  <option value="Fearful">Fearful</option>
                  <option value="Revenge">Revenge</option>
                </select>
              </div>

              <div>
                <label className={`block text-sm font-semibold mb-3 ${darkMode ? 'text-stone-300' : 'text-stone-700'}`}>Entry Screenshot (Before)</label>
                <p className={`text-xs mb-3 -mt-2 ${darkMode ? 'text-stone-500' : 'text-stone-400'}`}>Capture the chart as it looks right now, before you know the outcome. You'll add a result screenshot when you close the trade.</p>
                <div className={`border-2 border-dashed rounded-xl p-8 text-center ${darkMode ? 'border-white/20 hover:border-orange-500' : 'border-stone-300 hover:border-orange-500'}`}>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => handleFileUpload(e, 'new')}
                    className="hidden"
                    id="screenshot-upload"
                    disabled={uploadingTarget === 'new'}
                  />
                  {uploadingTarget === 'new' ? (
                    <div className="flex flex-col items-center gap-2">
                      <Loader2 className={`w-12 h-12 animate-spin ${darkMode ? 'text-orange-400' : 'text-orange-500'}`} />
                      <p className={`text-sm ${darkMode ? 'text-stone-400' : 'text-stone-500'}`}>Uploading...</p>
                    </div>
                  ) : newTrade.screenshot ? (
                    <div className="space-y-3">
                      <img src={newTrade.screenshot} alt="Entry screenshot" className="max-h-48 mx-auto rounded-lg" />
                      <div className="flex gap-2 justify-center">
                        <label htmlFor="screenshot-upload" className={`px-4 py-2 rounded-lg cursor-pointer text-sm font-medium ${darkMode ? 'bg-orange-500/20 text-orange-400 hover:bg-orange-500/30' : 'bg-orange-100 text-orange-700 hover:bg-orange-200'}`}>
                          Change
                        </label>
                        <button
                          type="button"
                          onClick={() => removeScreenshot('new')}
                          className={`px-4 py-2 rounded-lg text-sm font-medium ${darkMode ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30' : 'bg-red-100 text-red-700 hover:bg-red-200'}`}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ) : (
                    <label htmlFor="screenshot-upload" className="cursor-pointer block">
                      <Upload className={`w-12 h-12 mx-auto mb-3 ${darkMode ? 'text-stone-500' : 'text-stone-400'}`} />
                      <p className={`text-sm ${darkMode ? 'text-stone-400' : 'text-stone-500'}`}>Click to upload chart screenshot</p>
                      <p className={`text-xs mt-1 ${darkMode ? 'text-stone-600' : 'text-stone-400'}`}>Max 5MB - PNG, JPG</p>
                    </label>
                  )}
                </div>
              </div>
            </div>

            <div className={`p-4 sm:p-6 border-t flex gap-3 sticky bottom-0 ${darkMode ? 'bg-[#1c1611]/90 backdrop-blur-xl border-orange-300/15' : 'bg-white/85 backdrop-blur-xl border-orange-200/40'}`}>
              <button
                onClick={() => setShowAddTrade(false)}
                className={`flex-1 px-4 sm:px-6 py-3 border-2 rounded-xl font-semibold text-sm sm:text-base ${darkMode ? 'border-white/20 text-stone-300 hover:bg-white/5' : 'border-stone-300 hover:bg-stone-50'}`}
                disabled={isSyncing}
              >
                Cancel
              </button>
              <button
                onClick={handleAddTrade}
                disabled={isSyncing || !newTrade.pair}
                className="flex-1 px-4 sm:px-6 py-3 bg-gradient-to-r from-orange-600 to-amber-600 text-white rounded-xl hover:from-orange-500 hover:to-amber-500 font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm sm:text-base"
              >
                {isSyncing ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Add Trade'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {showEditTrade && editTrade && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-2 sm:p-4 pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <div className={`${darkMode ? 'bg-[#1c1611]/85 backdrop-blur-2xl border border-orange-300/15' : 'bg-white/75 backdrop-blur-2xl border border-orange-200/40'} rounded-2xl max-w-3xl w-full max-h-[95vh] overflow-y-auto scrollbar-thin`}>
            <div className={`p-4 sm:p-6 border-b flex justify-between sticky top-0 ${darkMode ? 'bg-[#1c1611]/90 backdrop-blur-xl border-orange-300/15' : 'bg-white/85 backdrop-blur-xl border-orange-200/40'}`}>
              <div>
                <h2 className={`text-xl sm:text-2xl font-bold ${darkMode ? 'text-white' : ''}`}>
                  {trades.find(t => t.id === editTrade.id)?.outcome ? 'Edit Trade' : 'Close Trade & Add Results'}
                </h2>
                {!trades.find(t => t.id === editTrade.id)?.outcome && (
                  <p className={`text-sm mt-1 ${darkMode ? 'text-stone-400' : 'text-stone-500'}`}>Set the outcome, add your review, and upload an "after" screenshot to compare with your entry.</p>
                )}
              </div>
              <button onClick={() => {setShowEditTrade(false); setEditTrade(null);}} className={`p-2 rounded-lg ${darkMode ? 'hover:bg-white/10 text-stone-400' : 'hover:bg-stone-100'}`}>
                <XCircle className="w-6 h-6" />
              </button>
            </div>

            <div className="p-4 sm:p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={`block text-sm font-semibold mb-2 ${darkMode ? 'text-stone-300' : ''}`}>Outcome</label>
                  <select 
                    value={editTrade.outcome || ''}
                    onChange={(e) => {
                      const newOutcome = e.target.value || null;
                      let newProfit = editTrade.profit;
                      if (newOutcome === 'loss' && newProfit > 0) {
                        newProfit = -Math.abs(newProfit);
                      } else if (newOutcome === 'win' && newProfit < 0) {
                        newProfit = Math.abs(newProfit);
                      }
                      setEditTrade({...editTrade, outcome: newOutcome, profit: newProfit});
                    }}
                    className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-orange-500 text-base ${darkMode ? 'bg-[#241c15] border-white/10 text-white [&>option]:bg-[#241c15] [&>option]:text-white' : 'border-stone-300'}`}
                  >
                    <option value="">Pending</option>
                    <option value="win">Win</option>
                    <option value="loss">Loss</option>
                  </select>
                </div>
                
                <div>
                  <label className={`block text-sm font-semibold mb-2 ${darkMode ? 'text-stone-300' : ''}`}>
                    Profit/Loss ($) {editTrade.outcome === 'loss' && <span className="text-red-500 text-xs">(auto-negative)</span>}
                  </label>
                  <input
                    type="number"
                    value={editTrade.profit ? Math.abs(editTrade.profit) : ''}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === '') {
                        setEditTrade({...editTrade, profit: ''});
                        return;
                      }
                      const parsed = parseFloat(raw);
                      if (isNaN(parsed)) return;
                      const value = editTrade.outcome === 'loss' ? -Math.abs(parsed) : Math.abs(parsed);
                      setEditTrade({...editTrade, profit: value});
                    }}
                    className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-orange-500 text-base ${darkMode ? 'bg-white/5 border-white/10 text-white' : 'border-stone-300'}`}
                    placeholder="Enter amount (positive number)"
                  />
                </div>
              </div>

              <div>
                <label className={`block text-sm font-semibold mb-2 ${darkMode ? 'text-stone-300' : ''}`}>
                  Post-Trade Review
                  <span className={`text-xs font-normal ml-2 ${(editTrade.postNotes || '').length > 900 ? 'text-red-500' : darkMode ? 'text-stone-500' : 'text-stone-400'}`}>
                    {(editTrade.postNotes || '').length}/1000
                  </span>
                </label>
                <textarea 
                  rows="3"
                  maxLength={1000}
                  placeholder="What happened? Did you follow your rules?"
                  value={editTrade.postNotes || ''}
                  onChange={(e) => setEditTrade({...editTrade, postNotes: e.target.value})}
                  className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-orange-500 resize-none text-base ${darkMode ? 'bg-white/5 border-white/10 text-white placeholder-stone-500' : 'border-stone-300'}`}
                />
              </div>

              {/* Before / After Screenshots */}
              <div>
                <label className={`block text-sm font-semibold mb-1 ${darkMode ? 'text-stone-300' : ''}`}>Trade Screenshots</label>
                <p className={`text-xs mb-3 ${darkMode ? 'text-stone-500' : 'text-stone-400'}`}>See how the setup looked before you entered vs. how it played out.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Before */}
                  <div>
                    <p className={`text-xs font-semibold mb-2 uppercase tracking-wide ${darkMode ? 'text-stone-400' : 'text-stone-500'}`}>Before (Entry)</p>
                    <div className={`border-2 border-dashed rounded-xl p-4 ${darkMode ? 'border-white/20' : 'border-stone-300'}`}>
                      {uploadingTarget === 'editBefore' ? (
                        <div className="flex flex-col items-center gap-2 py-4">
                          <Loader2 className={`w-8 h-8 animate-spin ${darkMode ? 'text-orange-400' : 'text-orange-500'}`} />
                          <span className={`text-xs ${darkMode ? 'text-stone-400' : 'text-stone-500'}`}>Uploading...</span>
                        </div>
                      ) : editTrade.screenshot ? (
                        <div className="space-y-3">
                          <img
                            src={editTrade.screenshot}
                            alt="Entry screenshot"
                            className="max-h-40 w-full object-contain rounded-lg"
                          />
                          <div className="flex gap-2 justify-center">
                            <label className={`px-3 py-1.5 rounded-lg cursor-pointer text-xs font-medium ${darkMode ? 'bg-orange-500/20 text-orange-400 hover:bg-orange-500/30' : 'bg-orange-100 text-orange-700 hover:bg-orange-200'}`}>
                              Change
                              <input type="file" accept="image/*" onChange={(e) => handleFileUpload(e, 'editBefore')} className="hidden" />
                            </label>
                            <button
                              type="button"
                              onClick={() => removeScreenshot('editBefore')}
                              className={`px-3 py-1.5 rounded-lg text-xs font-medium ${darkMode ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30' : 'bg-red-100 text-red-700 hover:bg-red-200'}`}
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      ) : (
                        <label className="flex flex-col items-center gap-2 cursor-pointer py-4">
                          <Upload className={`w-8 h-8 ${darkMode ? 'text-stone-500' : 'text-stone-400'}`} />
                          <span className={`text-xs ${darkMode ? 'text-stone-400' : 'text-stone-500'}`}>Upload entry screenshot</span>
                          <input type="file" accept="image/*" onChange={(e) => handleFileUpload(e, 'editBefore')} className="hidden" />
                        </label>
                      )}
                    </div>
                  </div>

                  {/* After */}
                  <div>
                    <p className={`text-xs font-semibold mb-2 uppercase tracking-wide ${darkMode ? 'text-stone-400' : 'text-stone-500'}`}>After (Result)</p>
                    <div className={`border-2 border-dashed rounded-xl p-4 ${darkMode ? 'border-white/20' : 'border-stone-300'}`}>
                      {uploadingTarget === 'editAfter' ? (
                        <div className="flex flex-col items-center gap-2 py-4">
                          <Loader2 className={`w-8 h-8 animate-spin ${darkMode ? 'text-orange-400' : 'text-orange-500'}`} />
                          <span className={`text-xs ${darkMode ? 'text-stone-400' : 'text-stone-500'}`}>Uploading...</span>
                        </div>
                      ) : editTrade.screenshotAfter ? (
                        <div className="space-y-3">
                          <img
                            src={editTrade.screenshotAfter}
                            alt="Result screenshot"
                            className="max-h-40 w-full object-contain rounded-lg"
                          />
                          <div className="flex gap-2 justify-center">
                            <label className={`px-3 py-1.5 rounded-lg cursor-pointer text-xs font-medium ${darkMode ? 'bg-orange-500/20 text-orange-400 hover:bg-orange-500/30' : 'bg-orange-100 text-orange-700 hover:bg-orange-200'}`}>
                              Change
                              <input type="file" accept="image/*" onChange={(e) => handleFileUpload(e, 'editAfter')} className="hidden" />
                            </label>
                            <button
                              type="button"
                              onClick={() => removeScreenshot('editAfter')}
                              className={`px-3 py-1.5 rounded-lg text-xs font-medium ${darkMode ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30' : 'bg-red-100 text-red-700 hover:bg-red-200'}`}
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      ) : (
                        <label className="flex flex-col items-center gap-2 cursor-pointer py-4">
                          <Upload className={`w-8 h-8 ${darkMode ? 'text-stone-500' : 'text-stone-400'}`} />
                          <span className={`text-xs ${darkMode ? 'text-stone-400' : 'text-stone-500'}`}>Upload result screenshot</span>
                          <input type="file" accept="image/*" onChange={(e) => handleFileUpload(e, 'editAfter')} className="hidden" />
                        </label>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <label className="flex items-center gap-3">
                  <input 
                    type="checkbox"
                    checked={editTrade.rulesFollowed}
                    onChange={(e) => setEditTrade({...editTrade, rulesFollowed: e.target.checked})}
                    className="w-5 h-5 text-orange-600 rounded"
                  />
                  <span className={`text-sm font-semibold ${darkMode ? 'text-stone-300' : ''}`}>I followed all my trading rules</span>
                </label>
              </div>

              {/* Trade Tags */}
              <div>
                <label className={`block text-sm font-semibold mb-2 ${darkMode ? 'text-stone-300' : ''}`}>
                  <Tag className="w-4 h-4 inline mr-1" />
                  Trade Tags
                </label>
                <div className="flex flex-wrap gap-2">
                  {PRESET_TAGS.map(tag => {
                    const isSelected = editTrade.tags?.includes(tag.name);
                    return (
                      <button
                        key={tag.name}
                        type="button"
                        onClick={() => {
                          const currentTags = editTrade.tags || [];
                          if (isSelected) {
                            setEditTrade({...editTrade, tags: currentTags.filter(t => t !== tag.name)});
                          } else {
                            setEditTrade({...editTrade, tags: [...currentTags, tag.name]});
                          }
                        }}
                        className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                          isSelected 
                            ? `${tag.color} text-white` 
                            : darkMode ? 'bg-white/10 text-stone-300 hover:bg-white/20' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                        }`}
                      >
                        {tag.name}
                      </button>
                    );
                  })}
                </div>
                {editTrade.tags?.length > 0 && (
                  <p className={`text-xs mt-2 ${darkMode ? 'text-stone-500' : 'text-stone-500'}`}>
                    Selected: {editTrade.tags.join(', ')}
                  </p>
                )}
              </div>
            </div>

            <div className={`p-4 sm:p-6 border-t flex gap-3 sticky bottom-0 ${darkMode ? 'bg-[#1c1611]/90 backdrop-blur-xl border-orange-300/15' : 'bg-white/85 backdrop-blur-xl border-orange-200/40'}`}>
              <button 
                onClick={() => {setShowEditTrade(false); setEditTrade(null);}}
                className={`flex-1 px-4 sm:px-6 py-3 border-2 rounded-xl font-semibold text-sm sm:text-base ${darkMode ? 'border-white/20 text-stone-300 hover:bg-white/5' : 'border-stone-300 hover:bg-stone-50'}`}
                disabled={isSyncing}
              >
                Cancel
              </button>
              <button 
                onClick={handleUpdateTrade}
                disabled={isSyncing}
                className="flex-1 px-4 sm:px-6 py-3 bg-orange-600 text-white rounded-xl hover:bg-orange-700 font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm sm:text-base"
              >
                {isSyncing ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Saving...
                  </>
                ) : trades.find(t => t.id === editTrade.id)?.outcome ? (
                  'Save Changes'
                ) : (
                  'Close Trade'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedTrade && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className={`${darkMode ? 'bg-[#1c1611]/85 backdrop-blur-2xl border border-orange-300/15' : 'bg-white/75 backdrop-blur-2xl border border-orange-200/40'} rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto scrollbar-thin`}>
            <div className={`p-6 border-b flex justify-between sticky top-0 ${darkMode ? 'bg-[#1c1611]/90 backdrop-blur-xl border-orange-300/15' : 'bg-white/85 backdrop-blur-xl border-orange-200/40'}`}>
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                  selectedTrade.outcome === 'win' ? 'bg-green-100' : selectedTrade.outcome === 'loss' ? 'bg-red-100' : 'bg-yellow-100'
                }`}>
                  {selectedTrade.outcome === 'win' ? (
                    <CheckCircle className="w-6 h-6 text-green-600" />
                  ) : selectedTrade.outcome === 'loss' ? (
                    <XCircle className="w-6 h-6 text-red-600" />
                  ) : (
                    <Clock className="w-6 h-6 text-yellow-600" />
                  )}
                </div>
                <div>
                  <h2 className="text-2xl font-bold">{selectedTrade.pair}</h2>
                  <p className="text-sm text-stone-500">{selectedTrade.date} • {selectedTrade.session}</p>
                  {selectedTrade.openedAt && (
                    <p className="text-xs text-orange-600 mt-1">
                      Opened: {formatDateTime(selectedTrade.openedAt)?.full}
                    </p>
                  )}
                  {selectedTrade.closedAt && (
                    <p className="text-xs text-green-600">
                      Closed: {formatDateTime(selectedTrade.closedAt)?.full}
                    </p>
                  )}
                  {getTradeDuration(selectedTrade) && (
                    <p className={`text-xs mt-1 font-semibold ${selectedTrade.closedAt ? 'text-stone-500' : 'text-amber-600'}`}>
                      Duration: {getTradeDuration(selectedTrade).label}{!selectedTrade.closedAt ? ' (still open)' : ''}
                    </p>
                  )}
                </div>
              </div>
              <button onClick={() => setSelectedTrade(null)} className="p-2 hover:bg-stone-100 rounded-lg">
                <XCircle className="w-6 h-6" />
              </button>
            </div>
            
            <div className="p-6 space-y-6">
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
                <div className="bg-stone-50 rounded-xl p-4 border">
                  <p className="text-xs font-semibold text-stone-600 mb-1">DIRECTION</p>
                  <p className={`text-xl font-bold ${selectedTrade.direction === 'buy' ? 'text-green-600' : 'text-red-600'}`}>
                    {selectedTrade.direction === 'buy' ? '↑ BUY' : '↓ SELL'}
                  </p>
                </div>
                <div className="bg-stone-50 rounded-xl p-4 border">
                  <p className="text-xs font-semibold text-stone-600 mb-1">ENTRY</p>
                  <p className="text-xl font-bold text-orange-600">{selectedTrade.entry}</p>
                </div>
                <div className="bg-stone-50 rounded-xl p-4 border">
                  <p className="text-xs font-semibold text-stone-600 mb-1">STOP LOSS</p>
                  <p className="text-xl font-bold text-red-600">{selectedTrade.sl}</p>
                </div>
                <div className="bg-stone-50 rounded-xl p-4 border">
                  <p className="text-xs font-semibold text-stone-600 mb-1">TAKE PROFIT</p>
                  <p className="text-xl font-bold text-green-600">{selectedTrade.tp}</p>
                </div>
                <div className="bg-stone-50 rounded-xl p-4 border">
                  <p className="text-xs font-semibold text-stone-600 mb-1">RISK:REWARD</p>
                  <p className="text-xl font-bold text-orange-600">{formatRR(getRiskReward(selectedTrade))}</p>
                </div>
              </div>

              {(selectedTrade.screenshot || selectedTrade.screenshotAfter) && (
                <div>
                  <h3 className="font-semibold mb-3">Chart Screenshots</h3>
                  <div className={`grid gap-4 ${selectedTrade.screenshot && selectedTrade.screenshotAfter ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
                    {selectedTrade.screenshot && (
                      <div>
                        <p className="text-xs font-semibold mb-2 uppercase tracking-wide text-stone-500">Before (Entry)</p>
                        <img src={selectedTrade.screenshot} alt="Entry chart" className="w-full rounded-xl border-2 shadow-lg" />
                      </div>
                    )}
                    {selectedTrade.screenshotAfter && (
                      <div>
                        <p className="text-xs font-semibold mb-2 uppercase tracking-wide text-stone-500">After (Result)</p>
                        <img src={selectedTrade.screenshotAfter} alt="Result chart" className="w-full rounded-xl border-2 shadow-lg" />
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div>
                <h3 className="font-semibold mb-3">Pre-Trade Analysis</h3>
                <div className="bg-orange-50 border border-orange-200 rounded-xl p-5">
                  <p className="text-stone-800">{selectedTrade.preNotes}</p>
                  <div className="mt-4 pt-4 border-t border-orange-200">
                    <span className="text-sm text-stone-600">Emotion: </span>
                    <span className="px-3 py-1 bg-white rounded-lg text-sm font-semibold">{selectedTrade.emotion}</span>
                  </div>
                </div>
              </div>

              {selectedTrade.postNotes && (
                <div>
                  <h3 className="font-semibold mb-3">Post-Trade Review</h3>
                  <div className="bg-purple-50 border border-purple-200 rounded-xl p-5">
                    <p className="text-stone-800">{selectedTrade.postNotes}</p>
                    <div className="mt-4 pt-4 border-t border-purple-200">
                      <span className={`px-3 py-1 rounded-lg text-sm font-semibold ${
                        selectedTrade.rulesFollowed ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {selectedTrade.rulesFollowed ? '✓ Rules Followed' : '✗ Rules Broken'}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Trade Tags */}
              {selectedTrade.tags?.length > 0 && (
                <div>
                  <h3 className="font-semibold mb-3 flex items-center gap-2">
                    <Tag className="w-4 h-4" />
                    Trade Tags
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {selectedTrade.tags.map(tagName => {
                      const tagInfo = PRESET_TAGS.find(t => t.name === tagName);
                      return (
                        <span 
                          key={tagName}
                          className={`px-3 py-1.5 rounded-full text-sm font-medium text-white ${tagInfo?.color || 'bg-stone-500'}`}
                        >
                          {tagName}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}

              {selectedTrade.outcome && (
                <div className={`rounded-xl p-6 border-2 ${
                  selectedTrade.outcome === 'win' 
                    ? 'bg-gradient-to-br from-green-50 to-green-100 border-green-300' 
                    : 'bg-gradient-to-br from-red-50 to-red-100 border-red-300'
                }`}>
                  <div className="flex justify-between">
                    <div>
                      <p className="text-sm font-semibold text-stone-600 mb-1">OUTCOME</p>
                      <p className={`text-4xl font-bold ${selectedTrade.outcome === 'win' ? 'text-green-600' : 'text-red-600'}`}>
                        {selectedTrade.outcome === 'win' ? 'WIN' : 'LOSS'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-stone-600 mb-1">PROFIT/LOSS</p>
                      <p className={`text-4xl font-bold ${selectedTrade.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {selectedTrade.profit >= 0 ? '+' : ''}${selectedTrade.profit?.toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className={`p-6 border-t flex gap-3 sticky bottom-0 ${darkMode ? 'bg-[#1c1611]/90 backdrop-blur-xl border-orange-300/15' : 'bg-white/85 backdrop-blur-xl border-orange-200/40'}`}>
              <button
                onClick={() => openEditModal(selectedTrade)}
                className="flex-1 px-6 py-3 bg-orange-600 text-white rounded-xl hover:bg-orange-700 font-semibold flex items-center justify-center gap-2"
              >
                <Edit2 className="w-4 h-4" />
                Edit Trade
              </button>
              {selectedTrade.outcome && (
                <button
                  onClick={() => { setShareShowProfit(false); setShowShareCard(true); }}
                  className="px-6 py-3 border-2 border-orange-200 text-orange-600 rounded-xl hover:bg-orange-50 font-semibold flex items-center justify-center gap-2"
                >
                  <Share2 className="w-4 h-4" />
                  Share
                </button>
              )}
              <button
                onClick={() => setSelectedTrade(null)}
                className="px-6 py-3 border-2 rounded-xl hover:bg-stone-50 font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Share Trade Card Modal */}
      {showShareCard && selectedTrade && (() => {
        const isWin = selectedTrade.outcome === 'win';
        const rr = getRiskReward(selectedTrade);
        const tags = (selectedTrade.tags || []).slice(0, 3);
        const dateLabel = selectedTrade.date
          ? new Date(selectedTrade.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          : '';
        return (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className={`${darkMode ? 'bg-[#1c1611]/85 backdrop-blur-2xl border border-orange-300/15' : 'bg-white/75 backdrop-blur-2xl border border-orange-200/40'} rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto scrollbar-thin`}>
              <div className={`p-6 border-b flex justify-between items-start sticky top-0 ${darkMode ? 'bg-[#1c1611]/90 backdrop-blur-xl border-orange-300/15' : 'bg-white/85 backdrop-blur-xl border-orange-200/40'}`}>
                <div>
                  <h2 className={`text-xl font-bold flex items-center gap-2 ${darkMode ? 'text-white' : 'text-stone-900'}`}>
                    <Share2 className="w-5 h-5 text-orange-500" />
                    Share This Trade
                  </h2>
                  <p className={`text-sm mt-1 ${darkMode ? 'text-stone-400' : 'text-stone-500'}`}>Download a shareable card - no account numbers, just the result</p>
                </div>
                <button onClick={() => setShowShareCard(false)} className={`p-2 rounded-lg ${darkMode ? 'hover:bg-white/10 text-stone-400' : 'hover:bg-stone-100'}`}>
                  <XCircle className="w-6 h-6" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                {/* Live preview - this exact SVG is what gets rasterized to PNG */}
                <div className="rounded-2xl overflow-hidden shadow-xl">
                  <svg ref={shareCardRef} viewBox="0 0 1080 1080" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
                    <defs>
                      <linearGradient id="shareBg" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#1c1210" />
                        <stop offset="50%" stopColor="#2b1710" />
                        <stop offset="100%" stopColor="#1c1611" />
                      </linearGradient>
                      <radialGradient id="shareOrb" cx="35%" cy="30%" r="75%">
                        <stop offset="0%" stopColor="#FFC98A" />
                        <stop offset="55%" stopColor="#F2994A" />
                        <stop offset="100%" stopColor="#D9642B" />
                      </radialGradient>
                      <linearGradient id="shareLogoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#f2994a" />
                        <stop offset="100%" stopColor="#c2410c" />
                      </linearGradient>
                      <filter id="shareBlur1" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="90" /></filter>
                      <filter id="shareBlur2" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="70" /></filter>
                    </defs>

                    <rect width="1080" height="1080" fill="url(#shareBg)" />
                    <circle cx="120" cy="60" r="260" fill="url(#shareOrb)" opacity="0.3" filter="url(#shareBlur1)" />
                    <circle cx="980" cy="1000" r="280" fill="url(#shareOrb)" opacity="0.25" filter="url(#shareBlur2)" />

                    {/* Brand mark */}
                    <rect x="60" y="60" width="52" height="52" rx="14" fill="url(#shareLogoGrad)" />
                    <text x="86" y="94" fontFamily="Arial Black, Arial, sans-serif" fontSize="18" fontWeight="900" fill="#fff" textAnchor="middle">STJ</text>
                    <text x="126" y="93" fontFamily="-apple-system, Segoe UI, Arial, sans-serif" fontSize="17" fontWeight="700" fill="#f2994a" letterSpacing="1">SHINOBI TRADING JOURNAL</text>

                    {/* Pair + direction */}
                    <text x="60" y="330" fontFamily="-apple-system, Segoe UI, Arial, sans-serif" fontSize="88" fontWeight="800" fill="#ffffff">{selectedTrade.pair}</text>
                    <text x="60" y="375" fontFamily="-apple-system, Segoe UI, Arial, sans-serif" fontSize="28" fontWeight="600" fill={darkMode ? '#b3a394' : '#b3a394'}>
                      {selectedTrade.direction === 'buy' ? '↑ LONG' : '↓ SHORT'} · {selectedTrade.session || ''}
                    </text>

                    {/* Outcome badge */}
                    <rect x="60" y="420" width="220" height="90" rx="20" fill={isWin ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'} stroke={isWin ? '#10b981' : '#ef4444'} strokeWidth="2" />
                    <text x="170" y="478" fontFamily="-apple-system, Segoe UI, Arial, sans-serif" fontSize="40" fontWeight="800" fill={isWin ? '#10b981' : '#ef4444'} textAnchor="middle">{isWin ? 'WIN' : 'LOSS'}</text>

                    {shareShowProfit && (
                      <text x="300" y="480" fontFamily="-apple-system, Segoe UI, Arial, sans-serif" fontSize="40" fontWeight="800" fill={selectedTrade.profit >= 0 ? '#10b981' : '#ef4444'}>
                        {selectedTrade.profit >= 0 ? '+' : ''}${Math.abs(selectedTrade.profit).toLocaleString()}
                      </text>
                    )}

                    {/* Risk:Reward */}
                    <text x="60" y="590" fontFamily="-apple-system, Segoe UI, Arial, sans-serif" fontSize="20" fontWeight="600" fill="#b3a394" letterSpacing="2">RISK : REWARD</text>
                    <text x="60" y="655" fontFamily="-apple-system, Segoe UI, Arial, sans-serif" fontSize="56" fontWeight="800" fill="#f2994a">{formatRR(rr)}</text>

                    {/* Tags */}
                    {tags.map((tag, i) => (
                      <g key={tag} transform={`translate(${60 + i * 170}, 720)`}>
                        <rect width="155" height="46" rx="23" fill="rgba(255,255,255,0.07)" stroke="rgba(253,186,116,0.25)" />
                        <text x="77.5" y="30" fontFamily="-apple-system, Segoe UI, Arial, sans-serif" fontSize="18" fontWeight="600" fill="#f5efe8" textAnchor="middle">{tag}</text>
                      </g>
                    ))}

                    {/* Footer */}
                    <text x="60" y="950" fontFamily="-apple-system, Segoe UI, Arial, sans-serif" fontSize="20" fill="#6b5d4f">{dateLabel}</text>
                    <text x="60" y="1010" fontFamily="-apple-system, Segoe UI, Arial, sans-serif" fontSize="18" fill="#4a4039">Tracked with Shinobi Trading Journal</text>
                  </svg>
                </div>

                <label className={`flex items-center justify-between gap-3 rounded-xl px-4 py-3 cursor-pointer ${darkMode ? 'bg-white/5' : 'bg-stone-100'}`}>
                  <span className={`text-sm font-medium flex items-center gap-2 ${darkMode ? 'text-stone-300' : 'text-stone-700'}`}>
                    {shareShowProfit ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    Show dollar amount
                  </span>
                  <input
                    type="checkbox"
                    checked={shareShowProfit}
                    onChange={(e) => setShareShowProfit(e.target.checked)}
                    className="w-5 h-5 accent-orange-500"
                  />
                </label>
                <p className={`text-xs ${darkMode ? 'text-stone-500' : 'text-stone-400'}`}>
                  Off by default - the card shows your result without revealing your account size.
                </p>

                <button
                  onClick={downloadShareCard}
                  className="w-full px-6 py-3 bg-gradient-to-r from-orange-600 to-amber-600 text-white rounded-xl hover:from-orange-500 hover:to-amber-500 font-semibold flex items-center justify-center gap-2"
                >
                  <Download className="w-5 h-5" />
                  Download Image
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className={`${darkMode ? 'bg-[#1c1611]/85 backdrop-blur-2xl border border-orange-300/15' : 'bg-white/75 backdrop-blur-2xl border border-orange-200/40'} rounded-2xl max-w-md w-full p-6`}>
            <div className="flex items-center gap-4 mb-4">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center ${darkMode ? 'bg-red-500/20' : 'bg-red-100'}`}>
                <Trash2 className="w-6 h-6 text-red-500" />
              </div>
              <div>
                <h3 className={`text-xl font-bold ${darkMode ? 'text-white' : 'text-stone-900'}`}>Delete Trade</h3>
                <p className={darkMode ? 'text-sm text-stone-400' : 'text-sm text-stone-500'}>This action cannot be undone</p>
              </div>
            </div>
            <p className={darkMode ? 'text-stone-300 mb-6' : 'text-stone-600 mb-6'}>
              Are you sure you want to delete this trade? All data associated with this trade will be permanently removed.
            </p>
            <div className="flex gap-3">
              <button
                onClick={cancelDelete}
                className={`flex-1 px-6 py-3 border-2 rounded-xl font-semibold ${darkMode ? 'border-white/20 text-stone-300 hover:bg-white/5' : 'hover:bg-stone-50'}`}
                disabled={isSyncing}
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={isSyncing}
                className="flex-1 px-6 py-3 bg-red-600 text-white rounded-xl hover:bg-red-700 font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isSyncing ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  'Delete'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Daily Journal Note Modal */}
      {showDailyNote && editingNote && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className={`${darkMode ? 'bg-stone-800/85 backdrop-blur-2xl border border-orange-300/10' : 'bg-white/75 backdrop-blur-2xl border border-orange-200/40'} rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto scrollbar-thin`}>
            <div className={`p-6 border-b ${darkMode ? 'border-stone-700' : ''} flex justify-between sticky top-0 ${darkMode ? 'bg-stone-800/85 backdrop-blur-2xl border border-orange-300/10' : 'bg-white/75 backdrop-blur-2xl border border-orange-200/40'}`}>
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${darkMode ? 'bg-orange-900/50' : 'bg-orange-100'}`}>
                  <BookOpen className={`w-6 h-6 ${darkMode ? 'text-orange-400' : 'text-orange-600'}`} />
                </div>
                <div>
                  <h2 className={`text-xl font-bold ${darkMode ? 'text-white' : 'text-stone-900'}`}>Daily Journal</h2>
                  <p className={`text-sm ${darkMode ? 'text-stone-400' : 'text-stone-500'}`}>
                    {new Date(editingNote.date + 'T00:00:00').toLocaleDateString('en-US', { 
                      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' 
                    })}
                  </p>
                </div>
              </div>
              <button 
                onClick={() => { setShowDailyNote(false); setEditingNote(null); }} 
                className={`p-2 rounded-lg ${darkMode ? 'hover:bg-stone-700' : 'hover:bg-stone-100'}`}
              >
                <XCircle className="w-6 h-6" />
              </button>
            </div>
            
            <div className="p-6 space-y-6">
              {/* Mood & Market Bias */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={`block text-sm font-semibold mb-2 ${darkMode ? 'text-stone-300' : 'text-stone-700'}`}>
                    Your Mood Today
                  </label>
                  <div className="flex gap-2">
                    {[
                      { value: 'Great', icon: Smile, color: 'text-green-500' },
                      { value: 'Neutral', icon: Meh, color: 'text-yellow-500' },
                      { value: 'Bad', icon: Frown, color: 'text-red-500' }
                    ].map(mood => (
                      <button
                        key={mood.value}
                        type="button"
                        onClick={() => setEditingNote({...editingNote, mood: editingNote.mood === mood.value ? null : mood.value})}
                        className={`flex-1 flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all ${
                          editingNote.mood === mood.value
                            ? `border-orange-500 ${darkMode ? 'bg-orange-900/30' : 'bg-orange-50'}`
                            : (darkMode ? 'border-stone-600 hover:border-stone-500' : 'border-stone-200 hover:border-stone-300')
                        }`}
                      >
                        <mood.icon className={`w-6 h-6 ${mood.color}`} />
                        <span className={`text-xs font-medium ${darkMode ? 'text-stone-300' : 'text-stone-600'}`}>{mood.value}</span>
                      </button>
                    ))}
                  </div>
                </div>
                
                <div>
                  <label className={`block text-sm font-semibold mb-2 ${darkMode ? 'text-stone-300' : 'text-stone-700'}`}>
                    Market Bias
                  </label>
                  <div className="flex gap-2">
                    {[
                      { value: 'Bullish', color: 'bg-green-500', icon: '📈' },
                      { value: 'Neutral', color: 'bg-yellow-500', icon: '➡️' },
                      { value: 'Bearish', color: 'bg-red-500', icon: '📉' }
                    ].map(bias => (
                      <button
                        key={bias.value}
                        type="button"
                        onClick={() => setEditingNote({...editingNote, market_bias: editingNote.market_bias === bias.value ? null : bias.value})}
                        className={`flex-1 flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all ${
                          editingNote.market_bias === bias.value
                            ? `border-orange-500 ${darkMode ? 'bg-orange-900/30' : 'bg-orange-50'}`
                            : (darkMode ? 'border-stone-600 hover:border-stone-500' : 'border-stone-200 hover:border-stone-300')
                        }`}
                      >
                        <span className="text-xl">{bias.icon}</span>
                        <span className={`text-xs font-medium ${darkMode ? 'text-stone-300' : 'text-stone-600'}`}>{bias.value}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Morning Notes */}
              <div>
                <label className={`block text-sm font-semibold mb-2 ${darkMode ? 'text-stone-300' : 'text-stone-700'}`}>
                  ☀️ Morning Notes
                </label>
                <p className={`text-xs mb-2 ${darkMode ? 'text-stone-500' : 'text-stone-400'}`}>
                  Market outlook, trading plan, key levels to watch
                  <span className={`ml-2 ${(editingNote.morning_note || '').length > 900 ? 'text-red-500' : ''}`}>
                    ({(editingNote.morning_note || '').length}/1000)
                  </span>
                </p>
                <textarea 
                  rows="4"
                  maxLength={1000}
                  placeholder="What's your plan for today? Key levels? News events?"
                  value={editingNote.morning_note || ''}
                  onChange={(e) => setEditingNote({...editingNote, morning_note: e.target.value})}
                  className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-orange-500 resize-none ${
                    darkMode ? 'bg-stone-700 border-stone-600 text-white placeholder-stone-400' : 'border-stone-300'
                  }`}
                />
              </div>

              {/* Evening Notes */}
              <div>
                <label className={`block text-sm font-semibold mb-2 ${darkMode ? 'text-stone-300' : 'text-stone-700'}`}>
                  🌙 Evening Reflection
                </label>
                <p className={`text-xs mb-2 ${darkMode ? 'text-stone-500' : 'text-stone-400'}`}>
                  What went well? What could improve? Lessons learned
                  <span className={`ml-2 ${(editingNote.evening_note || '').length > 900 ? 'text-red-500' : ''}`}>
                    ({(editingNote.evening_note || '').length}/1000)
                  </span>
                </p>
                <textarea 
                  rows="4"
                  maxLength={1000}
                  placeholder="How did the day go? Any lessons learned? What will you do differently?"
                  value={editingNote.evening_note || ''}
                  onChange={(e) => setEditingNote({...editingNote, evening_note: e.target.value})}
                  className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-orange-500 resize-none ${
                    darkMode ? 'bg-stone-700 border-stone-600 text-white placeholder-stone-400' : 'border-stone-300'
                  }`}
                />
              </div>

              {/* Day Summary (if trades exist) */}
              {getTradesForDate(editingNote.date).length > 0 && (
                <div className={`rounded-xl p-4 ${darkMode ? 'bg-stone-700/50' : 'bg-stone-50'}`}>
                  <h3 className={`text-sm font-semibold mb-3 ${darkMode ? 'text-stone-300' : 'text-stone-700'}`}>
                    📊 Day Summary
                  </h3>
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <p className={`text-xs ${darkMode ? 'text-stone-400' : 'text-stone-500'}`}>Trades</p>
                      <p className={`text-xl font-bold ${darkMode ? 'text-white' : 'text-stone-900'}`}>
                        {getTradesForDate(editingNote.date).length}
                      </p>
                    </div>
                    <div>
                      <p className={`text-xs ${darkMode ? 'text-stone-400' : 'text-stone-500'}`}>Win Rate</p>
                      <p className={`text-xl font-bold ${darkMode ? 'text-white' : 'text-stone-900'}`}>
                        {(() => {
                          const dayTrades = getTradesForDate(editingNote.date);
                          const wins = dayTrades.filter(t => t.outcome === 'win').length;
                          const completed = dayTrades.filter(t => t.outcome).length;
                          return completed > 0 ? `${((wins/completed)*100).toFixed(0)}%` : '—';
                        })()}
                      </p>
                    </div>
                    <div>
                      <p className={`text-xs ${darkMode ? 'text-stone-400' : 'text-stone-500'}`}>P&L</p>
                      <p className={`text-xl font-bold ${getProfitForDate(editingNote.date) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {getProfitForDate(editingNote.date) >= 0 ? '+' : ''}${getProfitForDate(editingNote.date).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className={`p-6 border-t ${darkMode ? 'border-stone-700' : ''} flex gap-3 sticky bottom-0 ${darkMode ? 'bg-stone-800/85 backdrop-blur-2xl border border-orange-300/10' : 'bg-white/75 backdrop-blur-2xl border border-orange-200/40'}`}>
              <button 
                onClick={() => { setShowDailyNote(false); setEditingNote(null); }}
                className={`flex-1 px-6 py-3 border-2 rounded-xl font-semibold ${darkMode ? 'border-stone-600 text-stone-300 hover:bg-stone-700' : 'hover:bg-stone-50'}`}
                disabled={isSyncing}
              >
                Cancel
              </button>
              <button 
                onClick={async () => {
                  const result = await saveDailyNote(editingNote);
                  if (result.success) {
                    setShowDailyNote(false);
                    setEditingNote(null);
                  }
                }}
                disabled={isSyncing}
                className="flex-1 px-6 py-3 bg-orange-600 text-white rounded-xl hover:bg-orange-700 font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isSyncing ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <BookOpen className="w-5 h-5" />
                    Save Note
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Target Settings Modal */}
      {showTargetSettings && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className={`${darkMode ? 'bg-[#1c1611]/85 backdrop-blur-2xl border border-orange-300/15' : 'bg-white/75 backdrop-blur-2xl border border-orange-200/40'} rounded-2xl max-w-md w-full`}>
            <div className={`p-6 border-b ${darkMode ? 'border-white/10' : ''}`}>
              <h2 className={`text-xl font-bold ${darkMode ? 'text-white' : 'text-stone-900'}`}>Set Your Targets</h2>
              <p className={`text-sm mt-1 ${darkMode ? 'text-stone-400' : 'text-stone-500'}`}>Configure your drawdown limit and profit goal</p>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className={`block text-sm font-semibold mb-2 ${darkMode ? 'text-stone-300' : 'text-stone-700'}`}>Max Drawdown Limit ($)</label>
                <input 
                  type="number" 
                  id="target-maxdd"
                  defaultValue={maxDrawdown || ''}
                  placeholder="e.g. 5000"
                  className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-red-500 ${darkMode ? 'bg-white/5 border-white/10 text-white placeholder-stone-500' : 'border-stone-300'}`}
                />
                <p className={`text-xs mt-1 ${darkMode ? 'text-stone-500' : 'text-stone-400'}`}>Maximum loss you're willing to accept. Set to 0 to hide.</p>
              </div>
              <div>
                <label className={`block text-sm font-semibold mb-2 ${darkMode ? 'text-stone-300' : 'text-stone-700'}`}>Profit Target ($)</label>
                <input 
                  type="number" 
                  id="target-profit"
                  defaultValue={profitTarget || ''}
                  placeholder="e.g. 10000"
                  className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-orange-500 ${darkMode ? 'bg-white/5 border-white/10 text-white placeholder-stone-500' : 'border-stone-300'}`}
                />
                <p className={`text-xs mt-1 ${darkMode ? 'text-stone-500' : 'text-stone-400'}`}>Your profit goal. Set to 0 to hide progress bar.</p>
              </div>
            </div>
            <div className={`p-6 border-t ${darkMode ? 'border-white/10' : ''} flex gap-3`}>
              <button 
                onClick={() => setShowTargetSettings(false)}
                className={`flex-1 px-6 py-3 border-2 rounded-xl font-semibold ${darkMode ? 'border-white/20 text-stone-300 hover:bg-white/5' : 'border-stone-300 hover:bg-stone-50'}`}
              >
                Cancel
              </button>
              <button 
                onClick={() => {
                  const dd = document.getElementById('target-maxdd').value;
                  const target = document.getElementById('target-profit').value;
                  saveTargetSettings(dd, target);
                }}
                className="flex-1 px-6 py-3 bg-gradient-to-r from-orange-600 to-amber-600 text-white rounded-xl hover:from-orange-500 hover:to-amber-500 font-semibold"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CSV Import Modal */}
      {showImportCSV && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className={`${darkMode ? 'bg-[#1c1611]/85 backdrop-blur-2xl border border-orange-300/15' : 'bg-white/75 backdrop-blur-2xl border border-orange-200/40'} rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto scrollbar-thin`}>
            <div className={`p-6 border-b ${darkMode ? 'border-white/10' : ''}`}>
              <div className="flex justify-between items-center">
                <div>
                  <h2 className={`text-xl font-bold ${darkMode ? 'text-white' : 'text-stone-900'}`}>Import Trades</h2>
                  <p className={`text-sm mt-1 ${darkMode ? 'text-stone-400' : 'text-stone-500'}`}>From MT4, MT5, TradingView, or any CSV</p>
                </div>
                <button onClick={() => { setShowImportCSV(false); setImportPreview([]); setImportError(''); setImportWarning(''); setImportFormatLabel(''); }} className={`p-2 rounded-lg ${darkMode ? 'hover:bg-white/10 text-stone-400' : 'hover:bg-stone-100'}`}>
                  <XCircle className="w-6 h-6" />
                </button>
              </div>
            </div>
            <div className="p-6 space-y-4">
              {/* File Upload */}
              <div className={`border-2 border-dashed rounded-xl p-8 text-center ${darkMode ? 'border-white/20 hover:border-orange-500' : 'border-stone-300 hover:border-orange-500'}`}>
                <input
                  type="file"
                  accept=".csv,.txt,.htm,.html"
                  onChange={handleCSVImport}
                  className="hidden"
                  id="csv-upload"
                />
                <label htmlFor="csv-upload" className="cursor-pointer">
                  <Upload className={`w-12 h-12 mx-auto mb-3 ${darkMode ? 'text-stone-500' : 'text-stone-400'}`} />
                  <p className={`text-sm font-medium ${darkMode ? 'text-stone-300' : 'text-stone-700'}`}>Click to upload a statement or CSV file</p>
                  <p className={`text-xs mt-1 ${darkMode ? 'text-stone-500' : 'text-stone-400'}`}>MT4/MT5 .htm statement, TradingView .csv, or any custom CSV</p>
                </label>
              </div>

              {/* How to export - per platform */}
              <div className={`rounded-xl p-4 space-y-2 ${darkMode ? 'bg-white/5' : 'bg-orange-50'}`}>
                <p className={`text-sm font-semibold ${darkMode ? 'text-orange-400' : 'text-orange-700'}`}>How to get your file:</p>
                <p className={`text-xs ${darkMode ? 'text-stone-400' : 'text-orange-600'}`}>
                  <strong>MT4/MT5:</strong> Terminal → History tab → right-click → Save as Report (saves an .htm file)
                </p>
                <p className={`text-xs ${darkMode ? 'text-stone-400' : 'text-orange-600'}`}>
                  <strong>TradingView:</strong> Trading panel → History tab → export/download icon → CSV
                </p>
                <p className={`text-xs ${darkMode ? 'text-stone-400' : 'text-orange-600'}`}>
                  <strong>Other brokers:</strong> any CSV with columns like date, pair/symbol, direction, entry, sl, tp, lot size, profit
                </p>
              </div>

              {importFormatLabel && !importError && (
                <div className={`rounded-xl px-4 py-2.5 text-sm font-medium ${darkMode ? 'bg-green-500/10 text-green-400' : 'bg-green-50 text-green-700'}`}>
                  Detected format: {importFormatLabel}
                </div>
              )}

              {importWarning && (
                <div className={`rounded-xl p-4 border ${darkMode ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>
                  <p className="text-sm">{importWarning}</p>
                </div>
              )}

              {/* Error */}
              {importError && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
                  <p className="text-sm text-red-500">{importError}</p>
                </div>
              )}

              {/* Preview */}
              {importPreview.length > 0 && (
                <div>
                  <h3 className={`text-sm font-semibold mb-3 ${darkMode ? 'text-stone-300' : 'text-stone-700'}`}>
                    Preview ({importPreview.length} trades found)
                  </h3>
                  <div className={`rounded-xl overflow-hidden border ${darkMode ? 'border-white/10' : 'border-stone-200'}`}>
                    <div className="max-h-64 overflow-y-auto scrollbar-thin">
                      <table className="w-full text-sm">
                        <thead className={`sticky top-0 ${darkMode ? 'bg-white/10' : 'bg-stone-50'}`}>
                          <tr>
                            <th className={`px-3 py-2 text-left text-xs font-semibold ${darkMode ? 'text-stone-300' : 'text-stone-600'}`}>Date</th>
                            <th className={`px-3 py-2 text-left text-xs font-semibold ${darkMode ? 'text-stone-300' : 'text-stone-600'}`}>Pair</th>
                            <th className={`px-3 py-2 text-left text-xs font-semibold ${darkMode ? 'text-stone-300' : 'text-stone-600'}`}>Dir</th>
                            <th className={`px-3 py-2 text-left text-xs font-semibold ${darkMode ? 'text-stone-300' : 'text-stone-600'}`}>Lots</th>
                            <th className={`px-3 py-2 text-right text-xs font-semibold ${darkMode ? 'text-stone-300' : 'text-stone-600'}`}>P&L</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importPreview.slice(0, 50).map((trade, i) => (
                            <tr key={i} className={`border-t ${darkMode ? 'border-white/5' : 'border-stone-100'}`}>
                              <td className={`px-3 py-2 ${darkMode ? 'text-stone-400' : 'text-stone-600'}`}>{trade.date}</td>
                              <td className={`px-3 py-2 font-medium ${darkMode ? 'text-white' : 'text-stone-900'}`}>{trade.pair}</td>
                              <td className={`px-3 py-2 ${trade.direction === 'buy' ? 'text-green-500' : 'text-red-500'}`}>{trade.direction.toUpperCase()}</td>
                              <td className={`px-3 py-2 ${darkMode ? 'text-stone-400' : 'text-stone-600'}`}>{trade.lotSize || '—'}</td>
                              <td className={`px-3 py-2 text-right font-bold ${trade.plUnknown ? (darkMode ? 'text-stone-500 font-normal italic' : 'text-stone-400 font-normal italic') : trade.profit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                {trade.plUnknown ? 'enter manually' : `${trade.profit >= 0 ? '+' : ''}$${trade.profit.toLocaleString()}`}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {importPreview.length > 50 && (
                      <p className={`text-xs text-center py-2 ${darkMode ? 'text-stone-500' : 'text-stone-400'}`}>
                        ...and {importPreview.length - 50} more trades
                      </p>
                    )}
                  </div>

                  {/* Summary */}
                  <div className={`mt-3 grid grid-cols-3 gap-3`}>
                    <div className={`rounded-lg p-3 text-center ${darkMode ? 'bg-white/5' : 'bg-stone-50'}`}>
                      <p className={`text-xs ${darkMode ? 'text-stone-400' : 'text-stone-500'}`}>Total Trades</p>
                      <p className={`text-lg font-bold ${darkMode ? 'text-white' : 'text-stone-900'}`}>{importPreview.length}</p>
                    </div>
                    <div className={`rounded-lg p-3 text-center ${darkMode ? 'bg-white/5' : 'bg-stone-50'}`}>
                      <p className={`text-xs ${darkMode ? 'text-stone-400' : 'text-stone-500'}`}>Wins</p>
                      <p className="text-lg font-bold text-green-500">{importPreview.filter(t => t.outcome === 'win').length}</p>
                    </div>
                    <div className={`rounded-lg p-3 text-center ${darkMode ? 'bg-white/5' : 'bg-stone-50'}`}>
                      <p className={`text-xs ${darkMode ? 'text-stone-400' : 'text-stone-500'}`}>Total P&L</p>
                      <p className={`text-lg font-bold ${importPreview.reduce((s,t) => s + t.profit, 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        ${importPreview.reduce((s,t) => s + t.profit, 0).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  {importPreview.some(t => t.plUnknown) && (
                    <p className={`text-xs mt-2 ${darkMode ? 'text-stone-500' : 'text-stone-400'}`}>
                      P&L totals exclude {importPreview.filter(t => t.plUnknown).length} trade(s) with no profit data - edit those after importing.
                    </p>
                  )}
                </div>
              )}
            </div>

            {importPreview.length > 0 && (
              <div className={`p-6 border-t ${darkMode ? 'border-white/10' : ''} flex gap-3`}>
                <button
                  onClick={() => { setImportPreview([]); setImportWarning(''); setImportFormatLabel(''); }}
                  className={`flex-1 px-6 py-3 border-2 rounded-xl font-semibold ${darkMode ? 'border-white/20 text-stone-300 hover:bg-white/5' : 'border-stone-300 hover:bg-stone-50'}`}
                >
                  Clear
                </button>
                <button 
                  onClick={confirmImport}
                  disabled={isSyncing}
                  className="flex-1 px-6 py-3 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-xl hover:from-green-500 hover:to-emerald-500 font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isSyncing ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Importing...
                    </>
                  ) : (
                    <>
                      <Upload className="w-5 h-5" />
                      Import {importPreview.length} Trades
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
