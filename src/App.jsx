import React, { useState, useEffect, useRef } from 'react';
import { 
  Users, 
  TrendingUp, 
  Activity,
  Globe,
  Radio,
  Newspaper,
  Bug,
  CheckCircle2,
  XCircle,
  Sun,
  Moon,
  Zap,
  ArrowUp,
  ArrowDown,
  Minus,
  Percent
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot, collection } from 'firebase/firestore';

// --- API Configuration ---
// Safe access to import.meta.env
const getEnvVar = (key) => {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      return import.meta.env[key] || "";
    }
  } catch (e) {
    return "";
  }
  return "";
};

const apiKey = getEnvVar('VITE_GEMINI_API_KEY');

// --- Firebase Configuration ---
let firebaseConfig = null;
try {
  const envConfig = getEnvVar('VITE_FIREBASE_CONFIG');
  if (envConfig) {
    firebaseConfig = JSON.parse(envConfig);
  } else if (typeof __firebase_config !== 'undefined') {
    firebaseConfig = JSON.parse(__firebase_config);
  }
} catch (e) {
  console.error("Firebase Config Parsing Error:", e);
}

// Initialize Firebase (Conditional for safety)
let db, auth;
if (firebaseConfig) {
  try {
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
  } catch (e) {
    console.warn("Firebase init failed. Falling back to local mode.", e);
  }
}

const appId = typeof __app_id !== 'undefined' ? __app_id : 'freedom-pulse';
const modelName = "gemini-2.5-flash-preview-09-2025";

async function callGemini(prompt, systemInstruction = "", useSearch = false) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
  
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
  };

  if (useSearch) {
    payload.tools = [{ google_search: {} }];
  } else {
    payload.generationConfig = { responseMimeType: "application/json" };
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
       const errorText = await response.text();
       throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    
    const data = await response.json();
    let text = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";

    if (useSearch) {
      text = text.replace(/```json/g, '').replace(/```/g, '').trim();
    }

    return text;
  } catch (error) {
    console.error("Gemini API Error:", error);
    throw error;
  }
}

export default function App() {
  // --- State Management ---
  const [totalActive, setTotalActive] = useState(0);
  const [displayNumber, setDisplayNumber] = useState(0); 
  const [trend, setTrend] = useState('stable'); 
  const [headlines, setHeadlines] = useState(["در حال همگام‌سازی..."]);
  const [currentHeadlineIndex, setCurrentHeadlineIndex] = useState(0);
  const [lastUpdated, setLastUpdated] = useState(null);
  
  // UI State
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [apiStatus, setApiStatus] = useState('idle');
  const [errorDetails, setErrorDetails] = useState('');
  
  // Auth State
  const [user, setUser] = useState(null);

  // --- Effects ---

  // 1. Firebase Auth
  useEffect(() => {
    if (!auth) return;
    const unsubscribe = onAuthStateChanged(auth, setUser);
    signInAnonymously(auth).catch(err => console.error("Auth Failed", err));
    return () => unsubscribe();
  }, []);

  // 2. Central Data Sync
  useEffect(() => {
    if (!db || !user) return;

    const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'iran_protests_live', 'current_status');

    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        // Ensure valid number to prevent glitches
        const validTotal = typeof data.total === 'number' && !isNaN(data.total) ? data.total : 0;
        setTotalActive(validTotal);
        setTrend(data.trend || 'stable');
        if (data.headlines && Array.isArray(data.headlines)) {
          setHeadlines(data.headlines);
        }
        if (data.timestamp) {
          setLastUpdated(new Date(data.timestamp));
        }
        setApiStatus('success');
      } else {
        setLastUpdated(new Date(0)); 
      }
    }, (error) => {
      console.error("Firestore Sync Error:", error);
    });

    return () => unsubscribe();
  }, [user]);

  // 3. Robust Animation Loop
  useEffect(() => {
    let animationFrame;
    const animate = () => {
      setDisplayNumber(prev => {
        // Safety check to prevent NaN
        const target = typeof totalActive === 'number' && !isNaN(totalActive) ? totalActive : 0;
        const current = typeof prev === 'number' && !isNaN(prev) ? prev : 0;
        
        const diff = target - current;
        if (Math.abs(diff) < 1) return target;
        return current + diff * 0.05; // 5% approach speed
      });
      
      // Keep running if there's a difference
      if (Math.abs(totalActive - displayNumber) > 0.5) {
        animationFrame = requestAnimationFrame(animate);
      }
    };
    animate();
    return () => cancelAnimationFrame(animationFrame);
  }, [totalActive, displayNumber]);

  // 4. Data Fetching
  useEffect(() => {
    const checkAndRunUpdate = async () => {
      const now = new Date();
      const stalenessThreshold = 60 * 1000; 
      const needsUpdate = !lastUpdated || (now - lastUpdated > stalenessThreshold);
      const isLocalMode = !db;

      if (needsUpdate || isLocalMode) {
        if (!isLocalMode && !user) return; 

        setApiStatus('loading');
        
        const prompt = `
          You are a REAL-TIME protest monitor for Iran.
          TASK: Search widely for protests in Iran (last 24h).
          SOURCES: Iran International, Manoto, @1500tasvir, @PahlaviReza.
          EXCLUDE: IR/Govt sites.
          
          METHODOLOGY:
          - If "large crowds", estimate 5,000-20,000.
          - If "scattered gatherings", estimate 500-2,000.
          - Do NOT return 0 unless absolute silence.
          
          OUTPUT JSON: { "total": number, "trend": "string", "headlines": ["string", ...] }
        `;

        try {
          const jsonStr = await callGemini(prompt, "You are a data extractor. Return ONLY raw JSON.", true);
          let data;
          try {
             data = JSON.parse(jsonStr);
          } catch(err) {
             console.error("JSON Parse failed", err);
             return; 
          }
          
          // Heavy Stabilization
          let incomingTotal = typeof data.total === 'number' ? data.total : 0;
          let stabilizedTotal = incomingTotal;

          if (totalActive > 0) {
             if (incomingTotal < totalActive) {
                // Drop protection: max 5% drop
                stabilizedTotal = Math.max(incomingTotal, Math.round(totalActive * 0.95));
             } else {
                // Rise smoothing: 10% weight to new
                stabilizedTotal = Math.round(totalActive * 0.9 + incomingTotal * 0.1);
             }
          } else if (incomingTotal > 0) {
             stabilizedTotal = incomingTotal;
          }

          if (isLocalMode) {
            setTotalActive(stabilizedTotal);
            if (data.trend) setTrend(data.trend);
            if (data.headlines) setHeadlines(data.headlines);
            setLastUpdated(new Date());
            setApiStatus('success');
          } else {
            const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'iran_protests_live', 'current_status');
            await setDoc(docRef, {
              total: stabilizedTotal,
              trend: data.trend,
              headlines: data.headlines,
              timestamp: Date.now(),
              updatedBy: user.uid
            });
          }
        } catch (e) {
          console.error("Update Sequence Failed:", e);
          setApiStatus('error');
          setErrorDetails(e.message);
        }
      }
    };

    checkAndRunUpdate();
    const interval = setInterval(checkAndRunUpdate, 10000);
    return () => clearInterval(interval);
  }, [user, lastUpdated, totalActive]); 

  // 5. Ticker
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentHeadlineIndex(prev => (prev + 1) % headlines.length);
    }, 15000);
    return () => clearInterval(interval);
  }, [headlines]);

  // --- Visuals ---
  const getPulseSpeed = () => {
    if (totalActive <= 0) return '4s'; 
    const baseSpeed = 2.5;
    const maxPeople = 100000; 
    const speed = Math.max(0.3, baseSpeed - ((totalActive / maxPeople) * 2));
    return `${speed}s`;
  };

  const targetPop = 3100000; 
  const displayProbability = totalActive > 0 
    ? Math.min(Math.round((Math.log10(totalActive) / Math.log10(targetPop)) * 100 * 0.6), 99) 
    : 0;

  const theme = isDarkMode 
    ? "bg-slate-950 text-white selection:bg-red-500/30" 
    : "bg-slate-50 text-slate-900 selection:bg-rose-200";
    
  const cardTheme = isDarkMode
    ? "bg-slate-900/50 border-slate-800"
    : "bg-white/60 border-slate-200 shadow-xl";

  return (
    <div className={`min-h-screen w-full flex flex-col transition-colors duration-500 font-sans relative overflow-hidden ${theme}`} dir="rtl">
      
      {/* Background */}
      <div className="absolute inset-0 pointer-events-none z-0">
        <div className={`absolute top-0 left-0 w-full h-full opacity-30 ${isDarkMode ? 'bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-800 via-slate-950 to-black' : 'bg-gradient-to-b from-rose-50 to-slate-100'}`}></div>
        <div className={`absolute bottom-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full blur-[120px] opacity-20 ${isDarkMode ? 'bg-blue-900/20' : 'bg-blue-300/30'}`}></div>
      </div>

      {/* Top Bar */}
      <header className={`relative z-10 flex items-center justify-between p-4 md:px-8 border-b ${isDarkMode ? 'border-slate-800/50 bg-slate-950/80' : 'border-slate-200/50 bg-white/80'} backdrop-blur-md`}>
        <div className="flex items-center gap-3 shrink-0">
          <div className="relative flex items-center justify-center w-10 h-10 bg-gradient-to-br from-red-600 to-rose-500 rounded-xl shadow-lg shadow-red-500/20">
            <Activity className="w-5 h-5 text-white" />
            <span className="absolute -top-1 -right-1 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-white"></span>
            </span>
          </div>
          <div className="hidden md:block">
            <h1 className="font-black text-xl tracking-tighter">نبض رهایی</h1>
            <p className={`text-[9px] font-bold uppercase tracking-widest ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>Freedom Pulse</p>
          </div>
        </div>

        {/* News Ticker */}
        <div className="flex-1 mx-4 md:mx-12 overflow-hidden relative h-10 flex items-center justify-center">
          <div key={currentHeadlineIndex} className="animate-in fade-in slide-in-from-bottom-2 duration-500 text-center w-full">
            <span className="bg-red-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full ml-2 align-middle">فوری</span>
            <span className={`text-sm md:text-base font-medium align-middle ${isDarkMode ? 'text-slate-200' : 'text-slate-700'}`}>
              {headlines[currentHeadlineIndex]}
            </span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3 shrink-0">
          <div className={`hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-mono border ${apiStatus === 'error' ? 'border-red-500/50 text-red-500' : isDarkMode ? 'border-slate-800 text-slate-500' : 'border-slate-200 text-slate-400'}`}>
            <Globe size={12} />
            {db ? 'Central Sync' : 'Local Mode'}
          </div>
          <button 
            onClick={() => setIsDarkMode(!isDarkMode)}
            className={`p-2.5 rounded-xl transition-all active:scale-95 ${isDarkMode ? 'bg-slate-800 text-yellow-400 hover:bg-slate-700' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'}`}
          >
            {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 relative z-10 flex flex-col items-center justify-center p-6 text-center">
        <div className="animate-in zoom-in duration-700 space-y-12 max-w-4xl w-full">
          
          <div className="space-y-2">
            <h2 className={`text-lg md:text-2xl font-medium tracking-wide ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
              تخمین جمعیت فعال در کف خیابان
            </h2>
            <div className={`inline-flex items-center gap-2 px-4 py-1 rounded-full text-xs font-bold border ${isDarkMode ? 'border-slate-800 bg-slate-900/50 text-slate-500' : 'border-slate-200 bg-white/50 text-slate-400'}`}>
              <Radio size={12} className="animate-pulse text-red-500" />
              تخمین میدانی (تعدیل شده برای سانسور)
            </div>
          </div>

          {/* THE BIG NUMBER & INTERACTIVE PULSE */}
          <div className="relative py-4 flex flex-col justify-center items-center">
            {/* Interactive Pulse */}
            <div 
              className={`absolute w-[250px] h-[250px] md:w-[350px] md:h-[350px] rounded-full blur-[80px] transition-all ${isDarkMode ? 'bg-red-600' : 'bg-red-500'}`}
              style={{ 
                opacity: totalActive > 0 ? 0.15 : 0.05, 
                animation: `pulse ${getPulseSpeed()} cubic-bezier(0.4, 0, 0.6, 1) infinite` 
              }}
            ></div>
            
            <h1 className={`relative z-10 text-[8rem] md:text-[12rem] leading-none font-black tracking-tighter transition-all duration-500 tabular-nums ${
              totalActive > 0 
                ? 'text-transparent bg-clip-text bg-gradient-to-b from-white to-slate-400 drop-shadow-[0_0_30px_rgba(255,255,255,0.1)]' 
                : (isDarkMode ? 'text-slate-800' : 'text-slate-200')
            }`}
            style={!isDarkMode && totalActive > 0 ? { color: '#dc2626', textShadow: '0 4px 20px rgba(220, 38, 38, 0.2)' } : {}}
            >
              {Math.round(displayNumber).toLocaleString('fa-IR')}
            </h1>

            {/* Regime Change Probability */}
            <div className="mt-6 flex flex-col items-center gap-2">
               <div className={`flex items-center gap-2 text-xl font-bold ${isDarkMode ? 'text-emerald-400' : 'text-emerald-600'}`}>
                  <Percent size={24} />
                  <span>احتمال تغییر رژیم: ٪{displayProbability.toLocaleString('fa-IR')}</span>
               </div>
               <div className="w-64 h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-l from-emerald-500 to-emerald-900 transition-all duration-1000 ease-out"
                    style={{ width: `${displayProbability}%` }}
                  ></div>
               </div>
               <p className={`text-[10px] ${isDarkMode ? 'text-slate-600' : 'text-slate-400'}`}>بر اساس مدل اریکا چنووت (آستانه ۳.۵٪ جمعیت)</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-8 w-full">
            <div className={`p-6 rounded-3xl border backdrop-blur-sm flex flex-col items-center justify-center gap-2 ${cardTheme}`}>
              <span className={`text-xs font-bold uppercase tracking-widest ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>وضعیت میدانی</span>
              <div className={`text-2xl font-black flex items-center gap-2 ${
                totalActive > 1000 ? 'text-red-500' : totalActive > 0 ? 'text-orange-500' : 'text-slate-500'
              }`}>
                {totalActive > 1000 ? <Zap className="fill-current" /> : <Minus />}
                {totalActive > 5000 ? "گسترده" : totalActive > 0 ? "پراکنده" : "آرام"}
              </div>
            </div>

            <div className={`p-6 rounded-3xl border backdrop-blur-sm flex flex-col items-center justify-center gap-2 ${cardTheme}`}>
              <span className={`text-xs font-bold uppercase tracking-widest ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>روند تغییرات</span>
              <div className={`text-2xl font-black flex items-center gap-2 ${
                trend === 'up' ? 'text-green-500' : trend === 'down' ? 'text-red-500' : 'text-slate-500'
              }`}>
                {trend === 'up' && <ArrowUp />}
                {trend === 'down' && <ArrowDown />}
                {trend === 'stable' && <Minus />}
                {trend === 'up' ? "صعودی" : trend === 'down' ? "نزولی" : "ثابت"}
              </div>
            </div>

            <div className={`p-6 rounded-3xl border backdrop-blur-sm flex flex-col items-center justify-center gap-2 ${cardTheme}`}>
              <span className={`text-xs font-bold uppercase tracking-widest ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>زمان آخرین خبر</span>
              <div className={`text-2xl font-black font-mono ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>
                {lastUpdated ? lastUpdated.toLocaleTimeString('fa-IR', {hour: '2-digit', minute:'2-digit'}) : '--:--'}
              </div>
            </div>
          </div>

        </div>
      </main>

      <footer className={`relative z-10 py-4 text-center text-[10px] ${isDarkMode ? 'text-slate-700' : 'text-slate-400'}`}>
        <div className="flex justify-center items-center gap-4">
          <span>Powered by Gemini 2.5 Grounding</span>
          <span>•</span>
          <span className={`${apiStatus === 'error' ? 'text-red-500' : ''}`}>
            Status: {apiStatus} {errorDetails && `(${errorDetails})`}
          </span>
        </div>
      </footer>

      <style>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 0.15; }
          50% { transform: scale(1.15); opacity: 0.25; }
        }
      `}</style>
    </div>
  );
}
