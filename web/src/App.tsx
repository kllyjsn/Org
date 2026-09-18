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
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-slate-900 focus:shadow-lg"
      >
        Skip to main content
      </a>
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
    </>
  );
}
