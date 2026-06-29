import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles/global.css";
import { AppDataProvider } from "./context/AppDataContext";
import ToastProvider from "./components/ToastProvider";
import { ConfirmProvider } from "./components/ConfirmProvider";
import { AuthProvider } from "./context/AuthContext";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <AppDataProvider>
          <ConfirmProvider>
            <App />
            <ToastProvider />
          </ConfirmProvider>
        </AppDataProvider>
      </BrowserRouter>
    </AuthProvider>
  </React.StrictMode>
);
