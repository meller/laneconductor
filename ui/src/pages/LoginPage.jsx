// ui/src/pages/LoginPage.jsx
import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

export function LoginPage() {
    const { loginWithGoogle, loginWithGitHub } = useAuth();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);

    async function handleLogin(provider) {
        try {
            setBusy(true);
            setError(null);
            if (provider === 'google') await loginWithGoogle();
            else await loginWithGitHub();
        } catch (err) {
            console.error('Login error:', err, err.code, err.message);
            setError(err.code === 'auth/popup-closed-by-user' ? null : `Sign-in failed: ${err.message || err.code}`);
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="min-h-screen bg-[#050507] text-gray-100 flex flex-col relative overflow-hidden">
            {/* Ambient Background Glows */}
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/10 blur-[120px] rounded-full" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-indigo-600/10 blur-[120px] rounded-full" />

            {/* Navigation / Header */}
            <nav className="relative z-10 px-8 py-6 flex items-center justify-between border-b border-white/5 backdrop-blur-sm">
                <div className="flex items-center gap-3">
                    <img src="/logo.png" alt="LaneConductor" className="h-8" onError={e => e.target.style.display = 'none'} />
                    <span className="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">
                        LaneConductor
                    </span>
                </div>
                <div className="flex items-center gap-6">
                    <a href="https://github.com/meller/laneconductor" className="text-sm text-gray-400 hover:text-white transition-colors">Documentation</a>
                    <button
                        onClick={() => handleLogin('github')}
                        className="px-4 py-2 bg-white text-black text-sm font-semibold rounded-lg hover:bg-gray-200 transition-all shadow-lg shadow-white/5"
                    >
                        Get Started
                    </button>
                </div>
            </nav>

            {/* Hero Section */}
            <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 py-12 lg:flex-row lg:gap-16 max-w-7xl mx-auto w-full">
                <div className="flex-1 text-center lg:text-left space-y-8 max-w-2xl">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[11px] font-bold uppercase tracking-wider">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                        </span>
                        Next Generation Orchestration
                    </div>

                    <h1 className="text-5xl lg:text-7xl font-extrabold tracking-tight leading-[1.1]">
                        Google's enhanced <br />
                        <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400">
                            conductor pattern
                        </span>
                    </h1>

                    <p className="text-lg lg:text-xl text-gray-400 font-medium leading-relaxed">
                        Meets <span className="text-white">Claude skill</span> with a premium <br className="hidden lg:block" />
                        <span className="italic font-serif">Kanban UI interface</span> for maximum developer velocity.
                    </p>

                    <div className="flex flex-col sm:flex-row gap-4 pt-4 justify-center lg:justify-start">
                        <button
                            onClick={() => handleLogin('google')}
                            disabled={busy}
                            className="group flex items-center justify-center gap-3 px-8 py-4 bg-white text-black rounded-xl font-bold transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
                        >
                            <svg width="20" height="20" viewBox="0 0 48 48">
                                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.9c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.13-10.36 7.13-17.65z" />
                                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                            </svg>
                            {busy ? 'Orchestrating...' : 'Launch with Google'}
                        </button>
                        <button
                            onClick={() => handleLogin('github')}
                            disabled={busy}
                            className="flex items-center justify-center gap-3 px-8 py-4 bg-gray-900 border border-white/10 text-white rounded-xl font-bold transition-all hover:bg-gray-800 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
                            </svg>
                            {busy ? 'Authenticating...' : 'Sign in with GitHub'}
                        </button>
                    </div>

                    {error && (
                        <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm text-center lg:text-left">
                            {error}
                        </div>
                    )}

                    <div className="pt-8 border-t border-white/5">
                        <a
                            href="https://laneconductor.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-blue-400 transition-colors group"
                        >
                            <span>Explore all features & documentation</span>
                            <svg className="w-4 h-4 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                            </svg>
                        </a>
                    </div>
                </div>

                <div className="flex-1 mt-12 lg:mt-0 relative w-full max-w-md lg:max-w-xl group">
                    <div className="absolute inset-0 bg-blue-600/20 blur-[80px] rounded-full group-hover:bg-blue-600/30 transition-all duration-700" />
                    <div className="relative aspect-square rounded-2xl border border-white/10 overflow-hidden shadow-2xl bg-[#09090b]">
                        <img
                            src="/hero.png"
                            alt="Orchestration visualization"
                            className="w-full h-full object-cover opacity-80 group-hover:scale-105 transition-transform duration-1000"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-[#09090b] via-transparent to-transparent" />

                        {/* Floating elements for "Kanban" feel */}
                        <div className="absolute top-8 left-8 p-3 rounded-xl bg-white/5 border border-white/10 backdrop-blur-md shadow-xl animate-bounce-slow">
                            <div className="flex items-center gap-2 mb-2">
                                <div className="w-2 h-2 rounded-full bg-blue-400" />
                                <div className="text-[10px] font-bold text-blue-400 uppercase tracking-tighter">In Progress</div>
                            </div>
                            <div className="w-24 h-2 bg-white/10 rounded-full" />
                            <div className="w-16 h-2 bg-white/5 rounded-full mt-2" />
                        </div>

                        <div className="absolute bottom-12 right-8 p-4 rounded-xl bg-white/5 border border-white/10 backdrop-blur-md shadow-xl animate-float">
                            <div className="flex items-center gap-2 mb-2">
                                <div className="w-2 h-2 rounded-full bg-green-400" />
                                <div className="text-[10px] font-bold text-green-400 uppercase tracking-tighter">Verified</div>
                            </div>
                            <div className="text-[12px] font-semibold text-gray-200">Quality Gate Passed</div>
                        </div>
                    </div>
                </div>
            </main>

            {/* Footer */}
            <footer className="relative z-10 p-8 border-t border-white/5 text-center text-gray-600 text-[11px] uppercase tracking-widest">
                Built for Agile Teams & Agentic Realities • © 2026 LaneConductor
            </footer>

            <style>{`
                @keyframes bounce-slow {
                    0%, 100% { transform: translateY(0); }
                    50% { transform: translateY(-10px); }
                }
                @keyframes float {
                    0%, 100% { transform: translate(0, 0); }
                    50% { transform: translate(-5px, -15px); }
                }
                .animate-bounce-slow { animation: bounce-slow 4s ease-in-out infinite; }
                .animate-float { animation: float 6s ease-in-out infinite; }
            `}</style>
        </div>
    );
}
