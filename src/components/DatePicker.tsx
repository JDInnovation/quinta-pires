import React, { useMemo, useState } from "react";

interface DatePickerProps {
  value: string;                // "YYYY-MM-DD" ou ""
  onChange: (value: string) => void;
  required?: boolean;
}

function parseISO(value: string): Date {
  if (!value) return new Date();
  const [y, m, d] = value.split("-").map((v) => Number(v));
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d);
}

function toISO(year: number, monthIndex: number, day: number): string {
  const m = String(monthIndex + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}

function formatDisplay(value: string): string {
  if (!value) return "";
  const [y, m, d] = value.split("-");
  if (!y || !m || !d) return value;
  return `${d}/${m}/${y}`;
}

const weekdays = ["S", "T", "Q", "Q", "S", "S", "D"]; // cabeçalho curtinho

const DatePicker: React.FC<DatePickerProps> = ({ value, onChange, required }) => {
  const baseDate = useMemo(() => parseISO(value), [value]);
  const [isOpen, setIsOpen] = useState(false);
  const [viewYear, setViewYear] = useState(baseDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(baseDate.getMonth()); // 0-11

  const monthLabel = useMemo(
    () =>
      new Date(viewYear, viewMonth, 1).toLocaleDateString("pt-PT", {
        month: "long",
        year: "numeric",
      }),
    [viewYear, viewMonth]
  );

  // gera matriz de dias (6 linhas x 7 colunas)
  const weeks = useMemo(() => {
    const firstOfMonth = new Date(viewYear, viewMonth, 1);
    // Dia da semana (segunda=0 ... domingo=6)
    const startDow = (firstOfMonth.getDay() + 6) % 7;
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

    const rows: (number | null)[][] = [];
    let currentDay = 1;

    for (let week = 0; week < 6; week++) {
      const row: (number | null)[] = [];
      for (let d = 0; d < 7; d++) {
        if ((week === 0 && d < startDow) || currentDay > daysInMonth) {
          row.push(null);
        } else {
          row.push(currentDay++);
        }
      }
      rows.push(row);
    }

    return rows;
  }, [viewYear, viewMonth]);

  const handlePrevMonth = () => {
    const prev = new Date(viewYear, viewMonth - 1, 1);
    setViewYear(prev.getFullYear());
    setViewMonth(prev.getMonth());
  };

  const handleNextMonth = () => {
    const next = new Date(viewYear, viewMonth + 1, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  };

  const handleSelectDay = (day: number | null) => {
    if (!day) return;
    const iso = toISO(viewYear, viewMonth, day);
    onChange(iso);
    setIsOpen(false);
  };

  return (
    <div className="date-picker">
      <input
        type="text"
        className="date-picker-input"
        value={formatDisplay(value)}
        placeholder="dd/mm/aaaa"
        onClick={() => setIsOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setIsOpen((o) => !o);
          } else if (e.key === "Escape") {
            setIsOpen(false);
          }
        }}
        readOnly
        required={required}
        aria-label="Data selecionada"
        role="combobox"
        aria-expanded={isOpen}
      />
      <button
        type="button"
        className="date-picker-btn"
        onClick={() => setIsOpen((o) => !o)}
        aria-label="Abrir calendário"
      >
        📅
      </button>

      {isOpen && (
        <div className="date-picker-popup" role="dialog" aria-label="Calendário">
          <div className="date-picker-header">
            <button
              type="button"
              className="date-picker-nav"
              onClick={handlePrevMonth}
              aria-label="Mês anterior"
            >
              ◀
            </button>
            <span className="date-picker-month">{monthLabel}</span>
            <button
              type="button"
              className="date-picker-nav"
              onClick={handleNextMonth}
              aria-label="Mês seguinte"
            >
              ▶
            </button>
          </div>

          <div className="date-picker-grid">
            {weekdays.map((wd) => (
              <div key={wd} className="date-picker-weekday">
                {wd}
              </div>
            ))}

            {weeks.map((row, i) =>
              row.map((day, j) => {
                const key = `${i}-${j}`;
                if (!day) {
                  return <div key={key} className="date-picker-cell empty" />;
                }

                const iso = toISO(viewYear, viewMonth, day);
                const isSelected = value === iso;

                return (
                  <button
                    key={key}
                    type="button"
                    className={
                      "date-picker-cell" +
                      (isSelected ? " selected" : "")
                    }
                    onClick={() => handleSelectDay(day)}
                  >
                    {day}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default DatePicker;
