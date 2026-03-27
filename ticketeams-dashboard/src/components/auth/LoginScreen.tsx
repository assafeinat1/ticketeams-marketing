import { useState, type FormEvent } from 'react';
import { useAuth } from '../../context/AuthContext';

export default function LoginScreen() {
  const { login } = useAuth();
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const success = login(user, pass);
    if (!success) setError('שם משתמש או סיסמה שגויים');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <div className="glass rounded-2xl p-10 w-full max-w-md shadow-2xl shadow-black/20">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-pink via-orange to-purple flex items-center justify-center mx-auto mb-4 shadow-lg shadow-pink/20">
            <span className="text-2xl font-extrabold text-white">T</span>
          </div>
          <h1 className="text-2xl font-bold">
            <span className="bg-gradient-to-l from-pink via-orange to-purple bg-clip-text text-transparent">
              Ticketeams
            </span>
            {' '}
            <span className="text-text-dim font-medium">Command Center</span>
          </h1>
          <p className="text-text-dim text-sm mt-2">כניסה למערכת הניהול</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm text-text-dim mb-1">שם משתמש</label>
            <input
              type="text"
              value={user}
              onChange={(e) => { setUser(e.target.value); setError(''); }}
              className="w-full bg-bg border border-border rounded-xl px-4 py-3 text-text focus:border-pink focus:outline-none transition-colors"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm text-text-dim mb-1">סיסמה</label>
            <input
              type="password"
              value={pass}
              onChange={(e) => { setPass(e.target.value); setError(''); }}
              className="w-full bg-bg border border-border rounded-xl px-4 py-3 text-text focus:border-pink focus:outline-none transition-colors"
            />
          </div>

          {error && (
            <p className="text-red text-sm text-center">{error}</p>
          )}

          <button
            type="submit"
            className="w-full py-3 rounded-xl font-bold text-white bg-gradient-to-l from-pink via-orange to-purple hover:opacity-90 transition-opacity cursor-pointer shadow-lg shadow-pink/10"
          >
            כניסה
          </button>
        </form>
      </div>
    </div>
  );
}
