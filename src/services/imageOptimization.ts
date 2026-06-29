export interface OptimizedImageResult {
  dataUrl: string;
  width: number;
  height: number;
  bytes: number;
}

const DEFAULT_MAX_WIDTH = 1600;
const DEFAULT_QUALITY = 0.8;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Nao foi possivel ler a imagem."));
    };
    img.src = objectUrl;
  });
}

export async function optimizeImageForAi(
  file: File,
  options?: { maxWidth?: number; quality?: number },
): Promise<OptimizedImageResult> {
  const img = await loadImage(file);
  const maxWidth = options?.maxWidth ?? DEFAULT_MAX_WIDTH;
  const quality = options?.quality ?? DEFAULT_QUALITY;

  const scale = img.width > maxWidth ? maxWidth / img.width : 1;
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Nao foi possivel preparar canvas da imagem.");

  ctx.drawImage(img, 0, 0, width, height);
  const dataUrl = canvas.toDataURL("image/jpeg", quality);

  const base64Part = dataUrl.split(",")[1] ?? "";
  const bytes = Math.floor((base64Part.length * 3) / 4);

  return { dataUrl, width, height, bytes };
}
