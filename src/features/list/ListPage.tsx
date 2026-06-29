import React, { useState } from "react";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";

const ListPage: React.FC = () => {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleExport = async () => {
    if (!text.trim()) {
      setError("Cole a lista antes de exportar.");
      return;
    }

    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 12;
    const contentWidth = pageWidth - margin * 2;
    const pxPerMm = 96 / 25.4;
    const widthPx = Math.round(contentWidth * pxPerMm);
    const pageHeightPx = Math.round((pageHeight - margin * 2) * pxPerMm * 2);

    const wrapper = document.createElement("div");
    wrapper.style.position = "absolute";
    wrapper.style.left = "-9999px";
    wrapper.style.top = "0";
    wrapper.style.width = `${widthPx}px`;
    wrapper.style.padding = "10px";
    wrapper.style.background = "#ffffff";
    wrapper.style.color = "#000000";
    wrapper.style.fontSize = "13px";
    wrapper.style.lineHeight = "1.2";
    wrapper.style.fontFamily = "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji', sans-serif";
    wrapper.style.whiteSpace = "pre-wrap";
    wrapper.style.wordBreak = "break-word";
    wrapper.style.overflowWrap = "break-word";
    wrapper.style.boxSizing = "border-box";
    wrapper.style.border = "1px solid transparent";
    wrapper.textContent = `Lista de Impressão\n\n${lines.join("\n")}`;

    document.body.appendChild(wrapper);

    try {
      const canvas = await html2canvas(wrapper, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
      });

      const sliceHeightPx = pageHeightPx;
      let currentY = 0;
      let pageIndex = 0;

      while (currentY < canvas.height) {
        const sliceHeight = Math.min(sliceHeightPx, canvas.height - currentY);
        const pageCanvas = document.createElement("canvas");
        pageCanvas.width = canvas.width;
        pageCanvas.height = sliceHeight;
        const ctx = pageCanvas.getContext("2d");
        if (!ctx) throw new Error("Could not get canvas context");

        ctx.drawImage(canvas, 0, currentY, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);

        const pageImgData = pageCanvas.toDataURL("image/png");
        const imageHeightMm = pageCanvas.height / (2 * pxPerMm);

        if (pageIndex > 0) doc.addPage();
        doc.addImage(pageImgData, "PNG", margin, margin, contentWidth, imageHeightMm);

        currentY += sliceHeight;
        pageIndex += 1;
      }

      doc.save("lista.pdf");
    } finally {
      document.body.removeChild(wrapper);
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Lista</h1>
          <p className="page-subtitle">
            Cole a sua lista abaixo e exporte um PDF pronto para imprimir.
          </p>
        </div>
      </header>

      <section className="card form-card">
        <div className="field form-field-full">
          <label htmlFor="lista-input">Lista</label>
          <textarea
            id="lista-input"
            rows={18}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setError(null);
            }}
            placeholder={
              "Cole aqui a lista grande, com cada item em uma linha.\nExemplo:\nMaçãs 🍎\nPão 🥖\nLeite 🥛\n..."
            }
          />
        </div>

        {error ? (
          <p className="muted-hint" style={{ color: "var(--danger)", marginBottom: "1rem" }}>
            {error}
          </p>
        ) : null}

        <div className="form-actions">
          <button type="button" className="btn-primary" onClick={handleExport}>
            Exportar PDF
          </button>
        </div>
      </section>
    </div>
  );
};

export default ListPage;
