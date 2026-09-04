import React, { useState, useRef, useEffect } from 'react';
import { useAuth, countryCodes } from './AuthContext';
import { Mail, Lock, User, Phone, MapPin, ArrowRight, AlertCircle, Loader2, Instagram, Trash2, HelpCircle, ChevronDown } from 'lucide-react';
import { isValidPhoneNumber as isValidPhoneNumberForRegion } from 'libphonenumber-js';

const DELETE_REASONS = [
  'No longer trading / don\'t need this anymore',
  'Switching to a different trading journal',
  'Missing a feature I need',
  'Too confusing / hard to use',
  'Ran into bugs or technical issues',
  'Privacy or data concerns',
  'Just testing',
  'Other'
];

const DELETE_REASONS_NEEDING_DETAILS = ['Missing a feature I need', 'Other'];

// Normalize a pasted @handle or full profile URL down to a bare username,
// then check it against Instagram's actual username rules: 1-30 chars,
// letters/digits/periods/underscores, no leading/trailing/double periods.
const normalizeInstagramHandle = (raw) => {
  return (raw || '')
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/^@/, '')
    .replace(/\/.*$/, '');
};

const isValidInstagramHandle = (raw) => {
  const handle = normalizeInstagramHandle(raw);
  if (!handle) return false;
  return /^[a-zA-Z0-9._]{1,30}$/.test(handle) && !handle.includes('..') && !handle.startsWith('.') && !handle.endsWith('.');
};

// Strips everything but digits, plus a leading trunk "0" (common local-number
// convention that doesn't belong in the E.164 form used for validation).
const normalizePhoneNumber = (raw) => (raw || '').replace(/\D/g, '').replace(/^0+/, '');

// Real per-country validation (correct number of digits, valid area/prefix
// patterns, etc.) via libphonenumber-js - not just "is it digit-shaped".
// countryCode is the dial code we already collect, e.g. "+971".
const isValidPhoneNumber = (raw, countryCode) => {
  const digits = normalizePhoneNumber(raw);
  if (!digits) return false;
  try {
    return isValidPhoneNumberForRegion(`${countryCode}${digits}`);
  } catch {
    return false;
  }
};

// Google Icon Component
const GoogleIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
);

// Custom-styled country code dropdown - a native <select>'s open option list can't be
// reliably reskinned across browsers, so this replaces it with a fully brand-matched one.
const CountryCodeSelect = ({ name, value, onChange, darkMode = true, showCountryName = true }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selected = countryCodes.find(c => c.code === value);

  return (
    <div ref={ref} className="relative w-24 sm:w-28 flex-shrink-0">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`w-full px-2 sm:px-3 py-3 border rounded-lg text-sm text-left flex items-center justify-between gap-1 transition-colors ${darkMode ? 'bg-white/5 border-white/20 text-white hover:bg-white/10' : 'bg-white/50 border-stone-300 text-stone-900 hover:bg-white'} focus:outline-none focus:ring-2 focus:ring-orange-400`}
      >
        <span className="truncate">{selected ? selected.code : value}</span>
        <ChevronDown className={`w-4 h-4 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''} ${darkMode ? 'text-white/40' : 'text-stone-400'}`} />
      </button>
      {open && (
        <div className={`absolute z-50 mt-1 w-56 max-h-64 overflow-y-auto scrollbar-thin rounded-xl shadow-2xl shadow-black/50 border ${darkMode ? 'bg-[#1c1611] border-orange-300/20' : 'bg-white border-orange-200'}`}>
          {countryCodes.map(c => (
            <button
              key={c.iso}
              type="button"
              onClick={() => { onChange({ target: { name, value: c.code } }); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
                c.code === value
                  ? 'bg-orange-500/20 text-orange-400'
                  : darkMode ? 'text-white/80 hover:bg-orange-500/10' : 'text-stone-700 hover:bg-orange-50'
              }`}
            >
              <span className="font-medium flex-shrink-0">{c.code}</span>
              {showCountryName && <span className="opacity-70 truncate">{c.country}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// Login Screen
export const LoginScreen = ({ onSwitchToSignup, onSwitchToForgot, onBackToLanding }) => {
  const { signIn, signInWithGoogle } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleEmailLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error } = await signIn({ email, password });
    if (error) setError(error.message);
    setLoading(false);
  };

  const handleGoogleLogin = async () => {
    setError('');
    const { error } = await signInWithGoogle();
    if (error) setError(error.message);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-950 via-orange-950 to-stone-900 flex items-center justify-center relative overflow-hidden p-4">
      <div className="absolute -left-20 top-10 w-80 h-80 rounded-full pointer-events-none z-0" style={{background: 'radial-gradient(circle at 35% 30%, #FFC98A, #F2994A 55%, #D9642B 100%)', filter: 'blur(6px)', opacity: 0.55}}></div>
      <div className="absolute right-10 -top-16 w-56 h-56 rounded-full pointer-events-none z-0" style={{background: 'radial-gradient(circle at 35% 30%, #FFC98A, #F2994A 60%, #D9642B 100%)', filter: 'blur(4px)', opacity: 0.5}}></div>
      <div className="absolute right-24 -bottom-16 w-44 h-44 rounded-full pointer-events-none z-0" style={{background: 'radial-gradient(circle at 35% 30%, #FFC98A, #F2994A 55%, #D9642B 100%)', filter: 'blur(10px)', opacity: 0.45}}></div>
      <div className="relative z-10 bg-white/[0.06] backdrop-blur-xl border border-orange-300/25 rounded-3xl shadow-2xl shadow-black/50 w-full max-w-md p-6 sm:p-8">
        <div className="text-center mb-6">
          <button
            type="button"
            onClick={onBackToLanding}
            disabled={!onBackToLanding}
            className={`w-14 h-14 sm:w-16 sm:h-16 rounded-2xl overflow-hidden mx-auto mb-4 shadow-lg block ${onBackToLanding ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
          >
            <img src="/icon-192.png" alt="Shinobi" className="w-full h-full object-cover" />
          </button>
          <h1 className="text-xl sm:text-2xl font-bold text-white">Welcome Back</h1>
          <p className="text-white/50 mt-1 text-sm">Sign in to your Trading Journal</p>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-400/30 text-red-300 px-4 py-3 rounded-lg mb-4 flex items-center gap-2">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        <form onSubmit={handleEmailLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-white/80 mb-1">Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/20 autofill-dark rounded-lg text-white placeholder-white/40 focus:ring-2 focus:ring-orange-400 focus:bg-white/10 focus:border-orange-400/50 text-base" placeholder="you@example.com" required />
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-white/80 mb-1">Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/20 autofill-dark rounded-lg text-white placeholder-white/40 focus:ring-2 focus:ring-orange-400 focus:bg-white/10 focus:border-orange-400/50 text-base" placeholder="••••••••" required />
            </div>
          </div>
          
          <div className="flex items-center justify-end">
            <button type="button" onClick={onSwitchToForgot} className="text-sm text-orange-400 hover:text-orange-300">Forgot password?</button>
          </div>
          
          <button type="submit" disabled={loading} className="w-full bg-orange-600 text-white py-3 rounded-lg font-semibold hover:bg-orange-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50">
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <>Sign In <ArrowRight className="w-5 h-5" /></>}
          </button>
        </form>

        <div className="flex items-center gap-3 my-5">
          <div className="flex-1 h-px bg-white/20" />
          <span className="text-xs text-white/40 font-medium">OR</span>
          <div className="flex-1 h-px bg-white/20" />
        </div>

        <button type="button" onClick={handleGoogleLogin} className="w-full border border-white/20 text-white py-3 rounded-lg font-semibold hover:bg-white/10 backdrop-blur-sm transition-colors flex items-center justify-center gap-2">
          <GoogleIcon />
          Continue with Google
        </button>

        <div className="mt-6 text-center">
          <p className="text-white/70 text-sm">Don't have an account? <button onClick={onSwitchToSignup} className="text-orange-400 font-semibold hover:text-orange-300">Sign Up</button></p>
        </div>
      </div>
    </div>
  );
};

// Signup Screen
export const SignupScreen = ({ onSwitchToLogin, onSuccess, onBackToLanding }) => {
  const { signUp, signInWithGoogle } = useAuth();
  const [formData, setFormData] = useState({
    email: '', password: '', confirmPassword: '', fullName: '', phone: '', countryCode: '+971', location: '', instagram: ''
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!formData.phone.trim() || !formData.location.trim() || !formData.instagram.trim()) {
      setError('Phone, location, and Instagram handle are all required.');
      return;
    }
    if (!isValidPhoneNumber(formData.phone, formData.countryCode)) {
      setError('That doesn\'t look like a valid phone number for the selected country.');
      return;
    }
    if (!isValidInstagramHandle(formData.instagram)) {
      setError('That doesn\'t look like a real Instagram handle. Use letters, numbers, periods, or underscores only (e.g. @yourhandle).');
      return;
    }
    if (formData.password !== formData.confirmPassword) { setError('Passwords do not match'); return; }
    if (formData.password.length < 6) { setError('Password must be at least 6 characters'); return; }
    setLoading(true);
    const { error } = await signUp({ ...formData, instagram: normalizeInstagramHandle(formData.instagram) });
    if (error) setError(error.message);
    else onSuccess(formData.email);
    setLoading(false);
  };

  const handleGoogleSignup = async () => { setError(''); const { error } = await signInWithGoogle(); if (error) setError(error.message); };

  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-950 via-orange-950 to-stone-900 flex items-center justify-center relative overflow-hidden p-4">
      <div className="absolute -left-20 top-10 w-80 h-80 rounded-full pointer-events-none z-0" style={{background: 'radial-gradient(circle at 35% 30%, #FFC98A, #F2994A 55%, #D9642B 100%)', filter: 'blur(6px)', opacity: 0.55}}></div>
      <div className="absolute right-10 -top-16 w-56 h-56 rounded-full pointer-events-none z-0" style={{background: 'radial-gradient(circle at 35% 30%, #FFC98A, #F2994A 60%, #D9642B 100%)', filter: 'blur(4px)', opacity: 0.5}}></div>
      <div className="absolute right-24 -bottom-16 w-44 h-44 rounded-full pointer-events-none z-0" style={{background: 'radial-gradient(circle at 35% 30%, #FFC98A, #F2994A 55%, #D9642B 100%)', filter: 'blur(10px)', opacity: 0.45}}></div>
      <div className="relative z-10 bg-white/[0.06] backdrop-blur-xl border border-orange-300/25 rounded-3xl shadow-2xl shadow-black/50 w-full max-w-md p-6 sm:p-8 max-h-[95vh] overflow-y-auto scrollbar-thin">
        <div className="text-center mb-5">
          <button
            type="button"
            onClick={onBackToLanding}
            disabled={!onBackToLanding}
            className={`w-14 h-14 sm:w-16 sm:h-16 rounded-2xl overflow-hidden mx-auto mb-3 shadow-lg block ${onBackToLanding ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
          >
            <img src="/icon-192.png" alt="Shinobi" className="w-full h-full object-cover" />
          </button>
          <h1 className="text-xl sm:text-2xl font-bold text-white">Create Account</h1>
          <p className="text-white/50 mt-1 text-sm">Start tracking your trades today</p>
        </div>
        
        {error && (
          <div className="bg-red-500/10 border border-red-400/30 text-red-300 px-4 py-3 rounded-lg mb-4 flex items-center gap-2">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
        )}
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-white/80 mb-1">Full Name *</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
              <input type="text" name="fullName" value={formData.fullName} onChange={handleChange} className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/20 autofill-dark rounded-lg text-white placeholder-white/40 focus:ring-2 focus:ring-orange-400 focus:bg-white/10 text-base" placeholder="John Doe" required />
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-white/80 mb-1">Email *</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
              <input type="email" name="email" value={formData.email} onChange={handleChange} className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/20 autofill-dark rounded-lg text-white placeholder-white/40 focus:ring-2 focus:ring-orange-400 focus:bg-white/10 text-base" placeholder="you@example.com" required />
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-white/80 mb-1">Phone Number *</label>
            <div className="flex gap-2">
              <CountryCodeSelect name="countryCode" value={formData.countryCode} onChange={handleChange} />
              <div className="relative flex-1">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                <input type="tel" name="phone" value={formData.phone} onChange={handleChange} className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/20 autofill-dark rounded-lg text-white placeholder-white/40 focus:ring-2 focus:ring-orange-400 focus:bg-white/10 text-base" placeholder="50 123 4567" required />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-white/80 mb-1">Location *</label>
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
              <input type="text" name="location" value={formData.location} onChange={handleChange} className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/20 autofill-dark rounded-lg text-white placeholder-white/40 focus:ring-2 focus:ring-orange-400 focus:bg-white/10 text-base" placeholder="Dubai, UAE" required />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-white/80 mb-1">Instagram Handle *</label>
            <div className="relative">
              <Instagram className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-pink-500" />
              <input type="text" name="instagram" value={formData.instagram} onChange={handleChange} className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/20 autofill-dark rounded-lg text-white placeholder-white/40 focus:ring-2 focus:ring-orange-400 focus:bg-white/10 text-base" placeholder="@yourhandle" required />
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-white/80 mb-1">Password *</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
              <input type="password" name="password" value={formData.password} onChange={handleChange} className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/20 autofill-dark rounded-lg text-white placeholder-white/40 focus:ring-2 focus:ring-orange-400 focus:bg-white/10 text-base" placeholder="Min 6 characters" required />
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-white/80 mb-1">Confirm Password *</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
              <input type="password" name="confirmPassword" value={formData.confirmPassword} onChange={handleChange} className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/20 autofill-dark rounded-lg text-white placeholder-white/40 focus:ring-2 focus:ring-orange-400 focus:bg-white/10 text-base" placeholder="Confirm your password" required />
            </div>
          </div>
          
          <button type="submit" disabled={loading} className="w-full bg-orange-600 text-white py-3 rounded-lg font-semibold hover:bg-orange-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50">
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <>Create Account <ArrowRight className="w-5 h-5" /></>}
          </button>

          <p className="text-xs text-white/50 text-center">
            By creating an account, you agree to our{' '}
            <a href="/terms.html" target="_blank" rel="noopener noreferrer" className="text-orange-400 hover:text-orange-300 underline">Terms of Service</a>
            {' '}and{' '}
            <a href="/privacy.html" target="_blank" rel="noopener noreferrer" className="text-orange-400 hover:text-orange-300 underline">Privacy Policy</a>.
          </p>
        </form>

        <div className="flex items-center gap-3 my-5">
          <div className="flex-1 h-px bg-white/20" />
          <span className="text-xs text-white/40 font-medium">OR</span>
          <div className="flex-1 h-px bg-white/20" />
        </div>

        <button type="button" onClick={handleGoogleSignup} className="w-full border border-white/20 text-white py-3 rounded-lg font-semibold hover:bg-white/10 backdrop-blur-sm transition-colors flex items-center justify-center gap-2">
          <GoogleIcon />
          Continue with Google
        </button>

        <div className="mt-5 text-center">
          <p className="text-white/70 text-sm">Already have an account? <button onClick={onSwitchToLogin} className="text-orange-400 font-semibold hover:text-orange-300">Sign In</button></p>
        </div>
      </div>
    </div>
  );
};

// Email Verification Screen
export const VerifyScreen = ({ email, onBackToLogin }) => (
  <div className="min-h-screen bg-gradient-to-br from-stone-950 via-orange-950 to-stone-900 flex items-center justify-center relative overflow-hidden p-4">
      <div className="absolute -left-20 top-10 w-80 h-80 rounded-full pointer-events-none z-0" style={{background: 'radial-gradient(circle at 35% 30%, #FFC98A, #F2994A 55%, #D9642B 100%)', filter: 'blur(6px)', opacity: 0.55}}></div>
      <div className="absolute right-10 -top-16 w-56 h-56 rounded-full pointer-events-none z-0" style={{background: 'radial-gradient(circle at 35% 30%, #FFC98A, #F2994A 60%, #D9642B 100%)', filter: 'blur(4px)', opacity: 0.5}}></div>
      <div className="absolute right-24 -bottom-16 w-44 h-44 rounded-full pointer-events-none z-0" style={{background: 'radial-gradient(circle at 35% 30%, #FFC98A, #F2994A 55%, #D9642B 100%)', filter: 'blur(10px)', opacity: 0.45}}></div>
    <div className="relative z-10 bg-white/[0.06] backdrop-blur-xl border border-orange-300/25 rounded-3xl shadow-2xl shadow-black/50 w-full max-w-md p-6 sm:p-8 text-center">
      <div className="w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
        <Mail className="w-10 h-10 text-green-400" />
      </div>
      <h1 className="text-xl sm:text-2xl font-bold text-white mb-2">Check Your Email</h1>
      <p className="text-white/70 mb-6 text-sm sm:text-base">We've sent a verification link to<br /><span className="font-semibold text-white">{email}</span></p>
      <p className="text-sm text-white/50 mb-6">Click the link in the email to verify your account and start trading.</p>
      <button onClick={onBackToLogin} className="w-full bg-orange-600 text-white py-3 rounded-lg font-semibold hover:bg-orange-700 transition-colors">Back to Login</button>
    </div>
  </div>
);

// Forgot Password Screen
export const ForgotPasswordScreen = ({ onBackToLogin }) => {
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(''); setSuccess(''); setLoading(true);
    const { error } = await resetPassword(email);
    if (error) setError(error.message);
    else setSuccess('Password reset link sent to your email!');
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-950 via-orange-950 to-stone-900 flex items-center justify-center relative overflow-hidden p-4">
      <div className="absolute -left-20 top-10 w-80 h-80 rounded-full pointer-events-none z-0" style={{background: 'radial-gradient(circle at 35% 30%, #FFC98A, #F2994A 55%, #D9642B 100%)', filter: 'blur(6px)', opacity: 0.55}}></div>
      <div className="absolute right-10 -top-16 w-56 h-56 rounded-full pointer-events-none z-0" style={{background: 'radial-gradient(circle at 35% 30%, #FFC98A, #F2994A 60%, #D9642B 100%)', filter: 'blur(4px)', opacity: 0.5}}></div>
      <div className="absolute right-24 -bottom-16 w-44 h-44 rounded-full pointer-events-none z-0" style={{background: 'radial-gradient(circle at 35% 30%, #FFC98A, #F2994A 55%, #D9642B 100%)', filter: 'blur(10px)', opacity: 0.45}}></div>
      <div className="relative z-10 bg-white/[0.06] backdrop-blur-xl border border-orange-300/25 rounded-3xl shadow-2xl shadow-black/50 w-full max-w-md p-6 sm:p-8">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-white/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <Lock className="w-8 h-8 text-white/70" />
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">Reset Password</h1>
          <p className="text-white/50 mt-1 text-sm">Enter your email to receive a reset link</p>
        </div>
        
        {error && <div className="bg-red-500/10 border border-red-400/30 text-red-300 px-4 py-3 rounded-lg mb-4 text-sm">{error}</div>}
        {success && <div className="bg-green-500/10 border border-green-400/30 text-green-300 px-4 py-3 rounded-lg mb-4 text-sm">{success}</div>}
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-white/80 mb-1">Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/20 autofill-dark rounded-lg text-white placeholder-white/40 focus:ring-2 focus:ring-orange-400 focus:bg-white/10 text-base" placeholder="you@example.com" required />
            </div>
          </div>
          <button type="submit" disabled={loading} className="w-full bg-orange-600 text-white py-3 rounded-lg font-semibold hover:bg-orange-700 transition-colors disabled:opacity-50">
            {loading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : 'Send Reset Link'}
          </button>
        </form>
        
        <div className="mt-6 text-center">
          <button onClick={onBackToLogin} className="text-orange-400 font-semibold hover:text-orange-300 text-sm">Back to Login</button>
        </div>
      </div>
    </div>
  );
};

// Set New Password Screen - shown after the user clicks a password-reset email link
export const ResetPasswordScreen = () => {
  const { changePassword, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters'); return; }
    setLoading(true);
    const { error } = await changePassword(password);
    if (error) setError(error.message);
    else setSuccess(true);
    setLoading(false);
  };

  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-stone-950 via-orange-950 to-stone-900 flex items-center justify-center relative overflow-hidden p-4">
      <div className="absolute -left-20 top-10 w-80 h-80 rounded-full pointer-events-none z-0" style={{background: 'radial-gradient(circle at 35% 30%, #FFC98A, #F2994A 55%, #D9642B 100%)', filter: 'blur(6px)', opacity: 0.55}}></div>
      <div className="absolute right-10 -top-16 w-56 h-56 rounded-full pointer-events-none z-0" style={{background: 'radial-gradient(circle at 35% 30%, #FFC98A, #F2994A 60%, #D9642B 100%)', filter: 'blur(4px)', opacity: 0.5}}></div>
      <div className="absolute right-24 -bottom-16 w-44 h-44 rounded-full pointer-events-none z-0" style={{background: 'radial-gradient(circle at 35% 30%, #FFC98A, #F2994A 55%, #D9642B 100%)', filter: 'blur(10px)', opacity: 0.45}}></div>
        <div className="relative z-10 bg-white/[0.06] backdrop-blur-xl border border-orange-300/25 rounded-3xl shadow-2xl shadow-black/50 w-full max-w-md p-6 sm:p-8 text-center">
          <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <Lock className="w-8 h-8 text-green-400" />
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-white mb-2">Password Updated</h1>
          <p className="text-white/50 mb-6 text-sm">Your password has been changed successfully.</p>
          <button onClick={() => signOut()} className="w-full bg-orange-600 text-white py-3 rounded-lg font-semibold hover:bg-orange-700 transition-colors">Continue to Sign In</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-950 via-orange-950 to-stone-900 flex items-center justify-center relative overflow-hidden p-4">
      <div className="absolute -left-20 top-10 w-80 h-80 rounded-full pointer-events-none z-0" style={{background: 'radial-gradient(circle at 35% 30%, #FFC98A, #F2994A 55%, #D9642B 100%)', filter: 'blur(6px)', opacity: 0.55}}></div>
      <div className="absolute right-10 -top-16 w-56 h-56 rounded-full pointer-events-none z-0" style={{background: 'radial-gradient(circle at 35% 30%, #FFC98A, #F2994A 60%, #D9642B 100%)', filter: 'blur(4px)', opacity: 0.5}}></div>
      <div className="absolute right-24 -bottom-16 w-44 h-44 rounded-full pointer-events-none z-0" style={{background: 'radial-gradient(circle at 35% 30%, #FFC98A, #F2994A 55%, #D9642B 100%)', filter: 'blur(10px)', opacity: 0.45}}></div>
      <div className="relative z-10 bg-white/[0.06] backdrop-blur-xl border border-orange-300/25 rounded-3xl shadow-2xl shadow-black/50 w-full max-w-md p-6 sm:p-8">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-white/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <Lock className="w-8 h-8 text-white/70" />
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">Set New Password</h1>
          <p className="text-white/50 mt-1 text-sm">Choose a new password for your account</p>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-400/30 text-red-300 px-4 py-3 rounded-lg mb-4 flex items-center gap-2">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-white/80 mb-1">New Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/20 autofill-dark rounded-lg text-white placeholder-white/40 focus:ring-2 focus:ring-orange-400 focus:bg-white/10 focus:border-orange-400/50 text-base" placeholder="Min 6 characters" required />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-white/80 mb-1">Confirm New Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
              <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/20 autofill-dark rounded-lg text-white placeholder-white/40 focus:ring-2 focus:ring-orange-400 focus:bg-white/10 focus:border-orange-400/50 text-base" placeholder="Confirm your password" required />
            </div>
          </div>

          <button type="submit" disabled={loading} className="w-full bg-orange-600 text-white py-3 rounded-lg font-semibold hover:bg-orange-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50">
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Update Password'}
          </button>
        </form>
      </div>
    </div>
  );
};

// Complete Profile Screen - shown when phone/location/Instagram are missing
// (always the case for Google sign-ins, which never collect these)
export const CompleteProfileScreen = () => {
  const { profile, updateProfile, signOut } = useAuth();
  const [formData, setFormData] = useState({
    phone: profile?.phone || '',
    countryCode: profile?.country_code || '+971',
    location: profile?.location || '',
    instagram: profile?.instagram || ''
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!formData.phone.trim() || !formData.location.trim() || !formData.instagram.trim()) {
      setError('Please fill in all three fields to continue.');
      return;
    }
    if (!isValidPhoneNumber(formData.phone, formData.countryCode)) {
      setError('That doesn\'t look like a valid phone number for the selected country.');
      return;
    }
    if (!isValidInstagramHandle(formData.instagram)) {
      setError('That doesn\'t look like a real Instagram handle. Use letters, numbers, periods, or underscores only (e.g. @yourhandle).');
      return;
    }
    setLoading(true);
    const { error } = await updateProfile({
      phone: formData.phone,
      country_code: formData.countryCode,
      location: formData.location,
      instagram: normalizeInstagramHandle(formData.instagram)
    });
    if (error) setError(error.message);
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-950 via-orange-950 to-stone-900 flex items-center justify-center relative overflow-hidden p-4">
      <div className="absolute -left-20 top-10 w-80 h-80 rounded-full pointer-events-none z-0" style={{background: 'radial-gradient(circle at 35% 30%, #FFC98A, #F2994A 55%, #D9642B 100%)', filter: 'blur(6px)', opacity: 0.55}}></div>
      <div className="absolute right-10 -top-16 w-56 h-56 rounded-full pointer-events-none z-0" style={{background: 'radial-gradient(circle at 35% 30%, #FFC98A, #F2994A 60%, #D9642B 100%)', filter: 'blur(4px)', opacity: 0.5}}></div>
      <div className="absolute right-24 -bottom-16 w-44 h-44 rounded-full pointer-events-none z-0" style={{background: 'radial-gradient(circle at 35% 30%, #FFC98A, #F2994A 55%, #D9642B 100%)', filter: 'blur(10px)', opacity: 0.45}}></div>
      <div className="relative z-10 bg-white/[0.06] backdrop-blur-xl border border-orange-300/25 rounded-3xl shadow-2xl shadow-black/50 w-full max-w-md p-6 sm:p-8">
        <div className="text-center mb-6">
          <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl overflow-hidden mx-auto mb-4 shadow-lg">
            <img src="/icon-192.png" alt="Shinobi" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">Just One More Step</h1>
          <p className="text-white/50 mt-1 text-sm">We need a few more details before you can start journaling</p>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-400/30 text-red-300 px-4 py-3 rounded-lg mb-4 flex items-center gap-2">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-white/80 mb-1">Phone Number *</label>
            <div className="flex gap-2">
              <CountryCodeSelect name="countryCode" value={formData.countryCode} onChange={handleChange} />
              <div className="relative flex-1">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                <input type="tel" name="phone" value={formData.phone} onChange={handleChange} className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/20 autofill-dark rounded-lg text-white placeholder-white/40 focus:ring-2 focus:ring-orange-400 focus:bg-white/10 text-base" placeholder="50 123 4567" required />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-white/80 mb-1">Location *</label>
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
              <input type="text" name="location" value={formData.location} onChange={handleChange} className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/20 autofill-dark rounded-lg text-white placeholder-white/40 focus:ring-2 focus:ring-orange-400 focus:bg-white/10 text-base" placeholder="Dubai, UAE" required />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-white/80 mb-1">Instagram Handle *</label>
            <div className="relative">
              <Instagram className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-pink-500" />
              <input type="text" name="instagram" value={formData.instagram} onChange={handleChange} className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/20 autofill-dark rounded-lg text-white placeholder-white/40 focus:ring-2 focus:ring-orange-400 focus:bg-white/10 text-base" placeholder="@yourhandle" required />
            </div>
          </div>

          <button type="submit" disabled={loading} className="w-full bg-orange-600 text-white py-3 rounded-lg font-semibold hover:bg-orange-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50">
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <>Continue <ArrowRight className="w-5 h-5" /></>}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button onClick={() => signOut()} className="text-white/40 hover:text-white/70 text-sm">Sign out instead</button>
        </div>
      </div>
    </div>
  );
};

// Profile Screen with Email Verification for Changes
export const ProfileScreen = ({ onBack, onReplayTour, darkMode }) => {
  const { user, profile, updateProfile, signOut, sendPasswordResetEmail, requestAccountDeletion } = useAuth();
  const [formData, setFormData] = useState({
    full_name: profile?.full_name || '',
    phone: profile?.phone || '',
    country_code: profile?.country_code || '+971',
    location: profile?.location || '',
    instagram: profile?.instagram || ''
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteDetails, setDeleteDetails] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteSubmitted, setDeleteSubmitted] = useState(false);
  const deleteNeedsDetails = DELETE_REASONS_NEEDING_DETAILS.includes(deleteReason);

  const handleDeleteSubmit = async () => {
    setDeleteError('');
    if (!deleteReason) { setDeleteError('Please select a reason.'); return; }
    if (deleteNeedsDetails && !deleteDetails.trim()) { setDeleteError('Please tell us a bit more.'); return; }
    setDeleteLoading(true);
    const { error } = await requestAccountDeletion({ reason: deleteReason, details: deleteDetails });
    if (error) { setDeleteError(error.message); setDeleteLoading(false); return; }
    setDeleteSubmitted(true);
    setDeleteLoading(false);
  };

  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(''); setSuccess('');
    if (!formData.phone.trim() || !formData.location.trim() || !formData.instagram.trim()) {
      setError('Phone, location, and Instagram handle are all required.');
      return;
    }
    if (!isValidPhoneNumber(formData.phone, formData.country_code)) {
      setError('That doesn\'t look like a valid phone number for the selected country.');
      return;
    }
    if (!isValidInstagramHandle(formData.instagram)) {
      setError('That doesn\'t look like a real Instagram handle. Use letters, numbers, periods, or underscores only (e.g. @yourhandle).');
      return;
    }
    setLoading(true);

    const { error } = await updateProfile({ ...formData, instagram: normalizeInstagramHandle(formData.instagram) });
    if (error) setError(error.message);
    else setSuccess('Profile updated successfully!');
    setLoading(false);
  };

  const handlePasswordReset = async () => {
    setError(''); setSuccess(''); setPasswordLoading(true);
    const { error } = await sendPasswordResetEmail();
    if (error) setError(error.message);
    else setSuccess('Password reset link sent to your email! Check your inbox.');
    setPasswordLoading(false);
  };

  return (
    <div className={`min-h-screen ${darkMode ? 'bg-gradient-to-br from-stone-950 via-orange-950 to-stone-900' : 'bg-gradient-to-br from-orange-50 via-stone-50 to-orange-100'}`}>
      <header className={`${darkMode ? 'bg-stone-900/60 backdrop-blur-xl border-orange-500/10' : 'bg-white/60 backdrop-blur-xl border-orange-200/40'} border-b shadow-sm sticky top-0 z-40`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between">
            <button onClick={onBack} className="flex items-center gap-3 hover:opacity-80 transition-opacity">
              <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl overflow-hidden shadow-lg cursor-pointer">
                <img src="/icon-192.png" alt="Shinobi" className="w-full h-full object-cover" />
              </div>
              <div className="text-left">
                <h1 className={`text-lg sm:text-xl font-bold ${darkMode ? 'text-white' : 'text-stone-900'}`}>Profile Settings</h1>
                <p className={`text-xs ${darkMode ? 'text-stone-400' : 'text-stone-500'} hidden sm:block`}>Manage your account</p>
              </div>
            </button>
            <button onClick={onBack} className={`px-3 sm:px-4 py-2 rounded-lg font-medium text-sm ${darkMode ? 'bg-stone-800 text-white hover:bg-stone-600' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'}`}>Back</button>
          </div>
        </div>
      </header>
      
      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className={`${darkMode ? 'bg-stone-900/60 backdrop-blur-xl border-orange-500/10' : 'bg-white/60 backdrop-blur-xl border-orange-200/40'} rounded-2xl border p-6 sm:p-8 shadow-sm`}>
          <div className="flex flex-col sm:flex-row items-center gap-4 mb-8">
            <div className="w-20 h-20 bg-gradient-to-br from-orange-600 to-orange-700 rounded-2xl flex items-center justify-center shadow-lg">
              <span className="text-white font-bold text-2xl">{formData.full_name?.charAt(0) || 'U'}</span>
            </div>
            <div className="text-center sm:text-left">
              <h2 className={`text-xl sm:text-2xl font-bold ${darkMode ? 'text-white' : 'text-stone-900'}`}>{formData.full_name || 'User'}</h2>
              <p className={`${darkMode ? 'text-stone-400' : 'text-stone-500'} text-sm sm:text-base`}>{user?.email}</p>
            </div>
          </div>
          
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6 text-sm">{error}</div>}
          {success && <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-6 text-sm">{success}</div>}
          
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className={`p-4 rounded-lg ${darkMode ? 'bg-stone-800/30 backdrop-blur-sm' : 'bg-orange-50/60 backdrop-blur-sm'}`}>
              <h3 className={`text-sm font-semibold mb-4 ${darkMode ? 'text-stone-300' : 'text-stone-700'}`}>
                Personal Details
              </h3>
              
              <div className="space-y-4">
                <div>
                  <label className={`block text-sm font-medium mb-2 ${darkMode ? 'text-stone-300' : 'text-stone-700'}`}>Full Name</label>
                  <input type="text" name="full_name" value={formData.full_name} onChange={handleChange} className={`w-full px-4 py-3 border rounded-lg text-base ${darkMode ? 'bg-stone-800/50 border-stone-600/50 text-white autofill-dark' : 'border-stone-300 bg-white/50'} focus:ring-2 focus:ring-orange-500`} />
                </div>
                
                <div>
                  <label className={`block text-sm font-medium mb-2 ${darkMode ? 'text-stone-300' : 'text-stone-700'}`}>Phone Number *</label>
                  <div className="flex gap-2">
                    <CountryCodeSelect name="country_code" value={formData.country_code} onChange={handleChange} darkMode={darkMode} showCountryName={false} />
                    <input type="tel" name="phone" value={formData.phone} onChange={handleChange} className={`flex-1 px-4 py-3 border rounded-lg text-base ${darkMode ? 'bg-stone-800/50 border-stone-600/50 text-white autofill-dark' : 'border-stone-300 bg-white/50'} focus:ring-2 focus:ring-orange-500`} required />
                  </div>
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${darkMode ? 'text-stone-300' : 'text-stone-700'}`}>Location *</label>
                  <input type="text" name="location" value={formData.location} onChange={handleChange} className={`w-full px-4 py-3 border rounded-lg text-base ${darkMode ? 'bg-stone-800/50 border-stone-600/50 text-white autofill-dark' : 'border-stone-300 bg-white/50'} focus:ring-2 focus:ring-orange-500`} required />
                </div>
              </div>
            </div>

            <div className={`p-4 rounded-lg ${darkMode ? 'bg-stone-800/30 backdrop-blur-sm' : 'bg-orange-50/60 backdrop-blur-sm'}`}>
              <h3 className={`text-sm font-semibold mb-4 ${darkMode ? 'text-stone-300' : 'text-stone-700'}`}>Social Media</h3>
              <div className="relative">
                <Instagram className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-pink-500" />
                <input type="text" name="instagram" value={formData.instagram} onChange={handleChange} placeholder="@yourhandle" className={`w-full pl-10 pr-4 py-3 border rounded-lg text-base ${darkMode ? 'bg-stone-800 border-stone-600 text-white placeholder-stone-400' : 'border-stone-300'} focus:ring-2 focus:ring-orange-500`} required />
              </div>
            </div>
            
            <div className={`pt-4 border-t ${darkMode ? 'border-stone-800' : 'border-stone-200'}`}>
              <button type="submit" disabled={loading} className="w-full bg-orange-600 text-white py-3 rounded-lg font-semibold hover:bg-orange-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Save Changes'}
              </button>
            </div>
          </form>
          
          <div className={`mt-8 pt-8 border-t ${darkMode ? 'border-stone-800' : 'border-stone-200'}`}>
            <h3 className={`text-lg font-semibold mb-2 ${darkMode ? 'text-white' : 'text-stone-900'}`}>Change Password</h3>
            <p className={`text-sm mb-4 ${darkMode ? 'text-stone-400' : 'text-stone-500'}`}>We'll send a password reset link to your email for security verification.</p>
            <button onClick={handlePasswordReset} disabled={passwordLoading} className={`w-full py-3 rounded-lg font-semibold transition-colors disabled:opacity-50 ${darkMode ? 'bg-stone-800 text-white hover:bg-stone-600' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'}`}>
              {passwordLoading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : 'Send Password Reset Email'}
            </button>
          </div>
          
          <div className={`mt-8 pt-8 border-t ${darkMode ? 'border-stone-800' : 'border-stone-200'}`}>
            <button onClick={() => signOut()} className="w-full bg-red-50 text-red-600 py-3 rounded-lg font-semibold hover:bg-red-100 transition-colors">Sign Out</button>
          </div>

          {onReplayTour && (
            <div className={`mt-8 pt-8 border-t ${darkMode ? 'border-stone-800' : 'border-stone-200'}`}>
              <h3 className={`text-lg font-semibold mb-2 ${darkMode ? 'text-white' : 'text-stone-900'}`}>Tutorial</h3>
              <p className={`text-sm mb-4 ${darkMode ? 'text-stone-400' : 'text-stone-500'}`}>Replay the guided walkthrough of the Dashboard, Trades, and Journal pages.</p>
              <button
                onClick={onReplayTour}
                className={`w-full flex items-center justify-center gap-2 py-3 rounded-lg font-semibold transition-colors ${darkMode ? 'bg-stone-800 text-white hover:bg-stone-600' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'}`}
              >
                <HelpCircle className="w-5 h-5" />
                Replay Tutorial
              </button>
            </div>
          )}

          <div className={`mt-8 pt-8 border-t flex items-center justify-center gap-4 text-sm ${darkMode ? 'border-stone-800' : 'border-stone-200'}`}>
            <a href="/terms.html" target="_blank" rel="noopener noreferrer" className={`hover:underline ${darkMode ? 'text-stone-400 hover:text-white' : 'text-stone-500 hover:text-stone-900'}`}>Terms of Service</a>
            <span className={darkMode ? 'text-stone-700' : 'text-stone-300'}>&middot;</span>
            <a href="/privacy.html" target="_blank" rel="noopener noreferrer" className={`hover:underline ${darkMode ? 'text-stone-400 hover:text-white' : 'text-stone-500 hover:text-stone-900'}`}>Privacy Policy</a>
          </div>

          <div className={`mt-8 pt-8 border-t ${darkMode ? 'border-stone-800' : 'border-stone-200'}`}>
            <h3 className={`text-lg font-semibold mb-2 ${darkMode ? 'text-white' : 'text-stone-900'}`}>Delete Account</h3>
            <p className={`text-sm mb-4 ${darkMode ? 'text-stone-400' : 'text-stone-500'}`}>Permanently remove your account and trading data. This can't be undone.</p>
            <button
              onClick={() => { setShowDeleteModal(true); setDeleteReason(''); setDeleteDetails(''); setDeleteError(''); setDeleteSubmitted(false); }}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-lg font-semibold border-2 border-red-200 text-red-600 hover:bg-red-50 transition-colors"
            >
              <Trash2 className="w-5 h-5" />
              Delete My Account
            </button>
          </div>
        </div>
      </main>

      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className={`rounded-2xl shadow-2xl w-full max-w-md p-6 sm:p-8 backdrop-blur-xl border ${darkMode ? 'bg-stone-900/80 border-orange-500/10' : 'bg-white/80 border-orange-200/40'}`}>
            {deleteSubmitted ? (
              <div className="text-center">
                <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Trash2 className="w-8 h-8 text-green-500" />
                </div>
                <h2 className={`text-xl font-bold mb-2 ${darkMode ? 'text-white' : 'text-stone-900'}`}>Request Received</h2>
                <p className={`text-sm mb-6 ${darkMode ? 'text-stone-400' : 'text-stone-500'}`}>Thanks for letting us know. Your account will be removed shortly. You'll be signed out now.</p>
                <button onClick={() => signOut()} className="w-full bg-orange-600 text-white py-3 rounded-lg font-semibold hover:bg-orange-700 transition-colors">Sign Out</button>
              </div>
            ) : (
              <>
                <div className="mb-4">
                  <h2 className={`text-xl font-bold ${darkMode ? 'text-white' : 'text-stone-900'}`}>Delete Your Account</h2>
                  <p className={`text-sm mt-1 ${darkMode ? 'text-stone-400' : 'text-stone-500'}`}>Before you go, tell us why - it helps us fix things for everyone else.</p>
                </div>

                {deleteError && (
                  <div className="bg-red-500/10 border border-red-400/30 text-red-400 px-4 py-3 rounded-lg mb-4 flex items-center gap-2">
                    <AlertCircle className="w-5 h-5 flex-shrink-0" />
                    <span className="text-sm">{deleteError}</span>
                  </div>
                )}

                <div className="space-y-2 mb-4">
                  {DELETE_REASONS.map(reason => (
                    <label key={reason} className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors ${deleteReason === reason ? 'border-red-400 bg-red-500/10' : (darkMode ? 'border-stone-700 hover:border-stone-600' : 'border-stone-200 hover:border-stone-300')}`}>
                      <input
                        type="radio"
                        name="deleteReason"
                        checked={deleteReason === reason}
                        onChange={() => setDeleteReason(reason)}
                        className="w-4 h-4 text-red-600"
                      />
                      <span className={`text-sm ${darkMode ? 'text-stone-200' : 'text-stone-800'}`}>{reason}</span>
                    </label>
                  ))}
                </div>

                {deleteNeedsDetails && (
                  <div className="mb-4">
                    <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-stone-300' : 'text-stone-700'}`}>
                      {deleteReason === 'Missing a feature I need' ? 'What feature were you looking for?' : 'Tell us more'} *
                    </label>
                    <textarea
                      rows="3"
                      value={deleteDetails}
                      onChange={(e) => setDeleteDetails(e.target.value)}
                      className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-red-500 text-base resize-none ${darkMode ? 'bg-stone-800/50 border-stone-600/50 text-white' : 'border-stone-300 bg-white/50'}`}
                      placeholder={deleteReason === 'Missing a feature I need' ? 'e.g. exporting to a specific broker format' : 'Anything you want us to know'}
                    />
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={() => setShowDeleteModal(false)}
                    disabled={deleteLoading}
                    className={`flex-1 px-6 py-3 border-2 rounded-lg font-semibold transition-colors disabled:opacity-50 ${darkMode ? 'border-stone-600 text-white hover:bg-stone-800/50' : 'border-stone-300 hover:bg-stone-50'}`}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteSubmit}
                    disabled={deleteLoading}
                    className="flex-1 px-6 py-3 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {deleteLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Submit & Delete'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
