import React, { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import logo from "../../assets/logo.png";
import { isInternalAdminEmail } from "../../config/internalAccess";
import { useAuth } from "../../context/AuthContext";

const LoginPage: React.FC = () => {
  const { user, loading, signInWithGoogle, signOut } = useAuth();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const location = useLocation();
  const navigate = useNavigate();

  const fromPath = useMemo(() => {
    const state = location.state as { from?: { pathname?: string } } | null;
    return state?.from?.pathname || "/";
  }, [location.state]);

  if (loading) {
    return (
      <div className="auth-loading-screen">
        <div className="auth-loading-card">
          <p>A validar sessao...</p>
        </div>
      </div>
    );
  }

  if (user && isInternalAdminEmail(user.email)) {
    navigate(fromPath, { replace: true });
    return null;
  }

  const isUnauthorized = Boolean(user && !isInternalAdminEmail(user.email));

  return (
    <div className="login-page">
      <section className="login-card" aria-label="Acesso interno">
        <img src={logo} alt="Quinta Pires" className="login-logo" />
        <h1>Area Interna</h1>
        <p>
          Entra com Google para aceder as funcionalidades internas.
        </p>

        {isUnauthorized && (
          <div className="login-error-box">
            <strong>Sem autorizacao</strong>
            <p>Este utilizador nao esta na allowlist de administradores.</p>
            <p>Email: {user?.email || "(sem email)"}</p>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void signOut()}
            >
              Sair
            </button>
          </div>
        )}

        {!isUnauthorized && (
          <button
            type="button"
            className="btn-primary login-google-btn"
            disabled={submitting}
            onClick={async () => {
              setSubmitting(true);
              setErrorMessage(null);
              try {
                await signInWithGoogle();
              } catch (error) {
                const message =
                  error instanceof Error
                    ? error.message
                    : "Nao foi possivel autenticar com Google.";
                setErrorMessage(message);
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {submitting ? "A entrar..." : "Entrar com Google"}
          </button>
        )}

        {errorMessage && <p className="login-error">{errorMessage}</p>}
      </section>
    </div>
  );
};

export default LoginPage;
