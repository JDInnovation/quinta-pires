import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { isInternalAdminEmail } from "../../config/internalAccess";
import { useAuth } from "../../context/AuthContext";

const ProtectedInternalRoute: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const { user, loading, signOut } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="auth-loading-screen">
        <div className="auth-loading-card">
          <p>A validar sessao...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (!isInternalAdminEmail(user.email)) {
    return (
      <div className="auth-loading-screen">
        <div className="auth-loading-card">
          <h2>Sem autorizacao</h2>
          <p>Este utilizador nao tem acesso a esta area interna.</p>
          <p>Email: {user.email || "(sem email)"}</p>
          <button type="button" className="btn-secondary" onClick={() => void signOut()}>
            Sair
          </button>
        </div>
      </div>
    );
  }

  return children;
};

export default ProtectedInternalRoute;
