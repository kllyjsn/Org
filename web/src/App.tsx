import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useSession } from './store';
import LoginPage from './pages/LoginPage';
import AccountsPage from './pages/AccountsPage';
import MapPage from './pages/MapPage';
import SharePage from './pages/SharePage';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, load } = useSession();
  useEffect(() => {
    if (loading) void load();
  }, [loading, load]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-slate-400">
        Loading…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/s/:token" element={<SharePage />} />
      <Route
        path="/app"
        element={
          <RequireAuth>
            <AccountsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/app/maps/:mapId"
        element={
          <RequireAuth>
            <MapPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}
