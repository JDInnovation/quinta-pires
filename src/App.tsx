import React from "react";
import { Routes, Route, NavLink, Navigate, useLocation } from "react-router-dom";
import DashboardPage from "./features/dashboard/DashboardPage";
import CustomersPage from "./features/customers/CustomersPage";
import OrdersPage from "./features/orders/OrdersPage";
import ProductsPage from "./features/products/ProductsPage";
import ListPage from "./features/list/ListPage";
import ImportOrdersPage from "./features/import/ImportOrdersPage";
import InsightsPage from "./features/insights/InsightsPage";
import LoginPage from "./features/auth/LoginPage";
import ProtectedInternalRoute from "./features/auth/ProtectedInternalRoute";
import AdminIdentityPage from "./features/auth/AdminIdentityPage";
import logo from "./assets/logo.png";
import { useAuth } from "./context/AuthContext";
import { isInternalAdminEmail } from "./config/internalAccess";

const navItems = [
  { to: "/", label: "Dashboard", icon: "📊" },
  { to: "/insights", label: "Insights", icon: "🔮" },
  { to: "/clientes", label: "Clientes", icon: "👥" },
  { to: "/encomendas", label: "Encomendas", icon: "📦" },
  { to: "/importar-encomendas", label: "Importar", icon: "🧠" },
  { to: "/produtos", label: "Produtos", icon: "🥬" },
  { to: "/lista", label: "Lista", icon: "📝" },
] as const;

const App: React.FC = () => {
  const location = useLocation();
  const { user, loading, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = React.useState(false);

  React.useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  if (loading) {
    return (
      <div className="auth-loading-screen">
        <div className="auth-loading-card">
          <p>A validar sessao...</p>
        </div>
      </div>
    );
  }

  const isAuthed = Boolean(user && isInternalAdminEmail(user.email));

  // Todo o site fica atras de login: sem sessao autorizada -> pagina de login.
  if (!isAuthed) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }

  const showAdminIdentity = Boolean(user && isInternalAdminEmail(user.email));

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <button
          type="button"
          className="app-burger"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label={menuOpen ? "Fechar menu" : "Abrir menu"}
          aria-expanded={menuOpen}
        >
          <span />
          <span />
          <span />
        </button>
        <div className="app-topbar-brand">
          <img src={logo} alt="Quinta Pires" className="app-topbar-logo" />
          <span>Quinta Pires</span>
        </div>
      </header>

      <div
        className={`app-backdrop${menuOpen ? " show" : ""}`}
        onClick={() => setMenuOpen(false)}
        aria-hidden="true"
      />

      <aside className={`app-sidebar${menuOpen ? " open" : ""}`} role="navigation" aria-label="Menu principal">
        <div className="app-logo">
          <img src={logo} alt="Quinta Pires" className="app-logo-img" />
          <span>Quinta Pires</span>
        </div>
        <nav className="app-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) => `nav-btn${isActive ? " active" : ""}`}
              aria-label={item.label}
              onClick={() => setMenuOpen(false)}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}

          {showAdminIdentity && (
            <NavLink
              to="/acesso-interno"
              className={({ isActive }) => `nav-btn${isActive ? " active" : ""}`}
              aria-label="Acesso interno"
              onClick={() => setMenuOpen(false)}
            >
              <span className="nav-icon">🔐</span>
              Acesso interno
            </NavLink>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            {user?.photoURL ? (
              <img
                src={user.photoURL}
                alt={user.displayName ?? "Utilizador"}
                className="sidebar-user-avatar"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="sidebar-user-avatar sidebar-user-avatar--fallback">
                {(user?.displayName ?? user?.email ?? "?").charAt(0).toUpperCase()}
              </span>
            )}
            <span className="sidebar-user-info">
              <span className="sidebar-user-name">
                {user?.displayName ?? "Utilizador"}
              </span>
              <span className="sidebar-user-email">{user?.email}</span>
            </span>
          </div>
          <button
            type="button"
            className="sidebar-logout"
            onClick={() => void signOut()}
          >
            <span className="nav-icon">🚪</span>
            Terminar sessão
          </button>
          <span className="sidebar-version">v1.0 — Quinta Pires</span>
        </div>
      </aside>

      <main className="app-main">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/insights" element={<InsightsPage />} />
          <Route path="/clientes" element={<CustomersPage />} />
          <Route path="/encomendas" element={<OrdersPage />} />
          <Route
            path="/importar-encomendas"
            element={
              <ProtectedInternalRoute>
                <ImportOrdersPage />
              </ProtectedInternalRoute>
            }
          />
          <Route path="/produtos" element={<ProductsPage />} />
          <Route path="/lista" element={<ListPage />} />
          <Route
            path="/acesso-interno"
            element={
              <ProtectedInternalRoute>
                <AdminIdentityPage />
              </ProtectedInternalRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
};

export default App;
