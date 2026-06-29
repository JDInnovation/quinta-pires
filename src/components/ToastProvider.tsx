import { Toaster } from "react-hot-toast";

const ToastProvider: React.FC = () => (
  <Toaster
    position="bottom-right"
    toastOptions={{
      duration: 3500,
      style: {
        background: "#1b1f29",
        color: "#e7e9ee",
        border: "1px solid rgba(255,255,255,0.14)",
        borderRadius: "14px",
        fontSize: "0.875rem",
        padding: "0.75rem 1rem",
        boxShadow: "0 16px 44px rgba(0,0,0,0.55)",
      },
      success: {
        iconTheme: { primary: "#34d399", secondary: "#04140b" },
      },
      error: {
        iconTheme: { primary: "#f05252", secondary: "#1b0a0a" },
        duration: 5000,
      },
    }}
  />
);

export default ToastProvider;
