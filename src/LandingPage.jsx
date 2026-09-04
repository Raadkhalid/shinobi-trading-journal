import React from 'react';
import { Upload, Link2, TrendingUp, CalendarDays, Smartphone, BarChart3, ShieldCheck, ArrowRight } from 'lucide-react';

const FEATURES = [
  {
    icon: Upload,
    title: 'Import From Your Broker',
    description: 'Bring in trades straight from MT4 and MT5 statements or TradingView order logs - no manual re-typing every entry.',
  },
  {
    icon: Link2,
    title: 'Connect Your cTrader Account',
    description: 'Link cTrader once and every closed trade logs itself automatically, every 15 minutes - no importing, no manual entry, ever.',
  },
  {
    icon: TrendingUp,
    title: 'Risk:Reward & Profit Factor',
    description: 'Every trade gets an automatic risk:reward ratio, and your dashboard tracks profit factor across your whole history.',
  },
  {
    icon: CalendarDays,
    title: 'Calendar Journal',
    description: 'Double-click any date to log your mood, market bias, and notes for the day alongside the trades you took.',
  },
  {
    icon: BarChart3,
    title: 'Real Analytics',
    description: 'Win rate, drawdown, best sessions, and top pairs - see the patterns in your trading, not just a list of numbers.',
  },
  {
    icon: Smartphone,
    title: 'Install As An App',
    description: 'A full PWA that installs to your home screen on iPhone and Android, so your journal is always one tap away.',
  },
  {
    icon: ShieldCheck,
    title: 'Your Data, Protected',
    description: 'Row-level security means only you can ever read or write your own trades. We don\'t sell your data, ever.',
  },
];

const Orbs = () => (
  <>
    <div className="absolute -left-20 top-10 w-80 h-80 rounded-full pointer-events-none z-0" style={{background: 'radial-gradient(circle at 35% 30%, #FFC98A, #F2994A 55%, #D9642B 100%)', filter: 'blur(6px)', opacity: 0.4}}></div>
    <div className="absolute right-10 top-40 w-56 h-56 rounded-full pointer-events-none z-0" style={{background: 'radial-gradient(circle at 35% 30%, #FFC98A, #F2994A 60%, #D9642B 100%)', filter: 'blur(4px)', opacity: 0.35}}></div>
    <div className="absolute left-1/3 bottom-0 w-72 h-72 rounded-full pointer-events-none z-0" style={{background: 'radial-gradient(circle at 35% 30%, #FFC98A, #F2994A 55%, #D9642B 100%)', filter: 'blur(10px)', opacity: 0.3}}></div>
  </>
);

export const LandingScreen = ({ onSignIn, onSignUp }) => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-950 via-orange-950 to-stone-900 text-white overflow-x-hidden">
      {/* Header */}
      <header className="relative z-20 max-w-6xl mx-auto flex items-center justify-between px-4 sm:px-6 pb-5 pt-[calc(1.25rem+env(safe-area-inset-top))]">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl overflow-hidden shadow-lg flex-shrink-0">
            <img src="/icon-192.png" alt="Shinobi Trading Journal" className="w-full h-full object-cover" />
          </div>
          <span className="font-bold text-[9px] sm:text-sm uppercase tracking-tight sm:tracking-wide whitespace-nowrap">Shinobi Trading Journal</span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
          <button onClick={onSignIn} className="text-xs sm:text-sm font-medium text-white/80 hover:text-white transition-colors whitespace-nowrap">Sign In</button>
          <button onClick={onSignUp} className="bg-orange-600 hover:bg-orange-700 transition-colors text-white text-xs sm:text-sm font-semibold px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg whitespace-nowrap">
            Get Started Free
          </button>
        </div>
      </header>

      {/* Hero */}
      <section className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-10 sm:pt-16 pb-20 text-center">
        <Orbs />
        <div className="relative z-10">
          <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-3xl overflow-hidden mx-auto mb-8 shadow-2xl shadow-black/50">
            <img src="/icon-512.png" alt="Shinobi Trading Journal mascot" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-4xl sm:text-6xl font-bold tracking-tight text-balance">
            A Trading Journal<br className="hidden sm:block" /> Built For <span className="text-orange-400">Discipline</span>
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-white/60 max-w-2xl mx-auto">
            Log every trade, import statements straight from MT4, MT5, or TradingView, and see the real patterns behind your wins and losses - free to start.
          </p>
          <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
            <button onClick={onSignUp} className="w-full sm:w-auto bg-orange-600 hover:bg-orange-700 transition-colors text-white font-semibold px-7 py-3.5 rounded-xl flex items-center justify-center gap-2">
              Start Journaling Free <ArrowRight className="w-5 h-5" />
            </button>
            <button onClick={onSignIn} className="w-full sm:w-auto border border-white/20 hover:bg-white/10 transition-colors text-white font-semibold px-7 py-3.5 rounded-xl backdrop-blur-sm">
              Sign In
            </button>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 pb-20">
        <div className="text-center mb-12">
          <h2 className="text-2xl sm:text-3xl font-bold">Everything your trading journal should do</h2>
          <p className="mt-3 text-white/50 max-w-xl mx-auto">No spreadsheets, no manual math - just a clear record of every trade and what it's telling you.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="bg-white/[0.06] backdrop-blur-xl border border-orange-300/15 rounded-2xl p-6 hover:border-orange-300/30 transition-colors">
              <div className="w-11 h-11 rounded-xl bg-orange-500/15 flex items-center justify-center mb-4">
                <f.icon className="w-5.5 h-5.5 text-orange-400" />
              </div>
              <h3 className="font-semibold text-white mb-1.5">{f.title}</h3>
              <p className="text-sm text-white/55 leading-relaxed">{f.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="relative z-10 max-w-3xl mx-auto px-4 sm:px-6 pb-20 text-center">
        <div className="bg-white/[0.06] backdrop-blur-xl border border-orange-300/25 rounded-3xl shadow-2xl shadow-black/50 p-8 sm:p-12">
          <h2 className="text-2xl sm:text-3xl font-bold mb-3">Ready to trade with discipline?</h2>
          <p className="text-white/55 mb-7">Create your free account and log your first trade in under a minute.</p>
          <button onClick={onSignUp} className="bg-orange-600 hover:bg-orange-700 transition-colors text-white font-semibold px-8 py-3.5 rounded-xl inline-flex items-center gap-2">
            Get Started Free <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-white/40">
          <span>&copy; {new Date().getFullYear()} Shinobi Trading Journal</span>
          <div className="flex items-center gap-5">
            <a href="/privacy.html" className="hover:text-white/70 transition-colors">Privacy</a>
            <a href="/terms.html" className="hover:text-white/70 transition-colors">Terms</a>
          </div>
        </div>
      </footer>
    </div>
  );
};
