import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import RemotePage from "./pages/RemotePage";
import WorkstationDetail from "./pages/WorkstationDetail";
import Login from "./pages/Login";
import { getCurrentUser, type CurrentUser } from "./api/auth";

export default function App() {
  // undefined = still checking; null = not logged in; object = logged in
  const [user, setUser] = useState<CurrentUser | null | undefined>(undefined);

  useEffect(() => {
    getCurrentUser()
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  if (user === undefined) {
    return (
      <div className="app">
        <div className="empty">Đang tải...</div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={user ? <Navigate to="/" replace /> : <Login onLogin={setUser} />}
        />
        <Route
          path="/"
          element={
            user ? <Dashboard user={user} onLogout={() => setUser(null)} /> : <Navigate to="/login" replace />
          }
        />
        <Route
          path="/remote/:id"
          element={user ? <RemotePage /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/workstations/:id"
          element={user ? <WorkstationDetail /> : <Navigate to="/login" replace />}
        />
      </Routes>
    </BrowserRouter>
  );
}
