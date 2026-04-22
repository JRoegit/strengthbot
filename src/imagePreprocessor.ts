import sharp from "sharp";

type RawImage = {
  data: Buffer;
  info: {
    width: number;
    height: number;
    channels: number;
  };
};

type CropBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type PreparedImageSet = {
  panel: string;
  username: string;
  packsOpenedRow: string;
  battlesWonRow: string;
  incomePerSecondRow: string;
  bestCardRow: string;
  totalCardLevelRow: string;
};

function isBluePanelPixel(r: number, g: number, b: number, a: number): boolean {
  if (a < 200) {
    return false;
  }

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = max - min;

  return b >= 55
    && g >= 35
    && b >= r + 12
    && b >= g
    && saturation >= 20;
}

function findBlueBounds(image: RawImage): CropBox | null {
  const { data, info } = image;
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  let count = 0;

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const index = (y * info.width + x) * info.channels;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const a = info.channels >= 4 ? data[index + 3] : 255;

      if (!isBluePanelPixel(r, g, b, a)) {
        continue;
      }

      count += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (count < 500 || maxX <= minX || maxY <= minY) {
    return null;
  }

  return {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1
  };
}

function expandCrop(crop: CropBox, width: number, height: number): CropBox {
  const marginX = Math.round(crop.width * 0.08);
  const marginTop = Math.round(crop.height * 0.08);
  const marginBottom = Math.round(crop.height * 0.08);

  const left = Math.max(0, crop.left - marginX);
  const top = Math.max(0, crop.top - marginTop);
  const right = Math.min(width, crop.left + crop.width + marginX);
  const bottom = Math.min(height, crop.top + crop.height + marginBottom);

  return {
    left,
    top,
    width: right - left,
    height: bottom - top
  };
}

function fallbackCenterCrop(width: number, height: number): CropBox {
  const cropWidth = Math.round(width * 0.88);
  const cropHeight = Math.round(height * 0.78);

  return {
    left: Math.max(0, Math.round((width - cropWidth) / 2)),
    top: Math.max(0, Math.round((height - cropHeight) / 2)),
    width: cropWidth,
    height: cropHeight
  };
}

function toDataUrl(buffer: Buffer): string {
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

async function buildVariantDataUrl(source: sharp.Sharp, width: number): Promise<string> {
  const buffer = await source
    .resize({ width, withoutEnlargement: false, fit: "inside" })
    .normalize()
    .sharpen({ sigma: 1.2 })
    .png()
    .toBuffer();

  return toDataUrl(buffer);
}

function relativeCrop(panelWidth: number, panelHeight: number, left: number, top: number, width: number, height: number): CropBox {
  return {
    left: Math.max(0, Math.round(panelWidth * left)),
    top: Math.max(0, Math.round(panelHeight * top)),
    width: Math.max(1, Math.round(panelWidth * width)),
    height: Math.max(1, Math.round(panelHeight * height))
  };
}

export async function buildPreparedImageSet(imageUrl: string): Promise<PreparedImageSet> {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
  }

  const inputBuffer = Buffer.from(await response.arrayBuffer());
  const normalized = sharp(inputBuffer).rotate();
  const metadata = await normalized.metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error("Unable to read image dimensions.");
  }

  const previewWidth = Math.min(metadata.width, 900);
  const rawPreview = await normalized
    .resize({ width: previewWidth, withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const previewCrop = findBlueBounds(rawPreview);
  const panelCrop = previewCrop
    ? expandCrop({
      left: Math.round(previewCrop.left * (metadata.width / rawPreview.info.width)),
      top: Math.round(previewCrop.top * (metadata.height / rawPreview.info.height)),
      width: Math.round(previewCrop.width * (metadata.width / rawPreview.info.width)),
      height: Math.round(previewCrop.height * (metadata.height / rawPreview.info.height))
    }, metadata.width, metadata.height)
    : fallbackCenterCrop(metadata.width, metadata.height);

  const panelBuffer = await normalized.extract(panelCrop).png().toBuffer();
  const panel = sharp(panelBuffer);
  const panelMetadata = await panel.metadata();

  if (!panelMetadata.width || !panelMetadata.height) {
    throw new Error("Unable to read cropped panel dimensions.");
  }

  const usernameCrop = relativeCrop(panelMetadata.width, panelMetadata.height, 0.18, 0.01, 0.68, 0.18);
  const packsCrop = relativeCrop(panelMetadata.width, panelMetadata.height, 0.02, 0.16, 0.96, 0.12);
  const battlesCrop = relativeCrop(panelMetadata.width, panelMetadata.height, 0.02, 0.28, 0.96, 0.12);
  const incomeCrop = relativeCrop(panelMetadata.width, panelMetadata.height, 0.02, 0.40, 0.96, 0.12);
  const bestCardCrop = relativeCrop(panelMetadata.width, panelMetadata.height, 0.02, 0.52, 0.96, 0.12);
  const totalCardLevelCrop = relativeCrop(panelMetadata.width, panelMetadata.height, 0.02, 0.64, 0.96, 0.12);

  return {
    panel: await buildVariantDataUrl(panel.clone(), 1600),
    username: await buildVariantDataUrl(panel.clone().extract(usernameCrop), 1400),
    packsOpenedRow: await buildVariantDataUrl(panel.clone().extract(packsCrop), 1600),
    battlesWonRow: await buildVariantDataUrl(panel.clone().extract(battlesCrop), 1600),
    incomePerSecondRow: await buildVariantDataUrl(panel.clone().extract(incomeCrop), 1600),
    bestCardRow: await buildVariantDataUrl(panel.clone().extract(bestCardCrop), 1600),
    totalCardLevelRow: await buildVariantDataUrl(panel.clone().extract(totalCardLevelCrop), 1600)
  };
}
