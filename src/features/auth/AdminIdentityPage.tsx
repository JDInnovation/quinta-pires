import React, { useState } from "react";
import { useAuth } from "../../context/AuthContext";

const AdminIdentityPage: React.FC = () => {
  const { user, signOut } = useAuth();
  const [copied, setCopied] = useState(false);

  if (!user) return null;

  return (
    <div className="page auth-admin-page">
      <header className="page-header">
        <div>
          <h1>Acesso interno</h1>
          <p className="page-subtitle">Dados da sessao para configurar ADMIN_UIDS no Worker.</p>
        </div>
      </header>

      {/* TEMP: ocultar ou remover esta pagina depois de concluir a configuracao dos admins. */}
      <section className="card auth-admin-card">
        <div className="auth-row">
          <strong>Email autenticado</strong>
          <span>{user.email || "(sem email)"}</span>
        </div>

        <div className="auth-row">
          <strong>Firebase UID</strong>
          <span>{user.uid}</span>
        </div>

        <div className="auth-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={async () => {
              await navigator.clipboard.writeText(user.uid);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "UID copiado" : "Copiar UID"}
          </button>

          <button type="button" className="btn-danger" onClick={() => void signOut()}>
            Logout
          </button>
        </div>
      </section>
    </div>
  );
};

export default AdminIdentityPage;
