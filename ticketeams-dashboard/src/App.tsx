import { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import ToastProvider from './components/ui/ToastProvider';
import LoginScreen from './components/auth/LoginScreen';
import Header from './components/layout/Header';
import TabBar from './components/layout/TabBar';
import TabShell from './components/layout/TabShell';
import type { TabKey } from './types/api';

function Dashboard() {
  const [activeTab, setActiveTab] = useState<TabKey>('home');

  return (
    <div className="min-h-screen bg-bg">
      <Header />
      <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
      <TabShell activeTab={activeTab} />
    </div>
  );
}

function AuthGate() {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <Dashboard /> : <LoginScreen />;
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <AuthGate />
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
