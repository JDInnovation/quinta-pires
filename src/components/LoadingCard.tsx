import React from "react";

interface LoadingCardProps {
  message?: string;
  lines?: number;
}

const LoadingCard: React.FC<LoadingCardProps> = ({
  message = "A carregar...",
  lines = 3,
}) => (
  <div className="card loading-card">
    <p className="loading-message">{message}</p>
    <div className="skeleton-lines">
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          className="skeleton-line"
          style={{ width: `${85 - i * 15}%` }}
        />
      ))}
    </div>
  </div>
);

interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
}

const EmptyState: React.FC<EmptyStateProps> = ({ icon = "📭", title, description }) => (
  <div className="empty-state">
    <span className="empty-state-icon">{icon}</span>
    <h3 className="empty-state-title">{title}</h3>
    {description && <p className="empty-state-text">{description}</p>}
  </div>
);

export { LoadingCard, EmptyState };
