const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

export const cloudinaryReady = Boolean(cloudName && uploadPreset);

export class ImageUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageUploadError";
  }
}

export async function uploadImage(blob: Blob) {
  if (!cloudinaryReady) {
    throw new ImageUploadError("Photo uploads need Cloudinary setup. Add the two Cloudinary settings in GitHub and redeploy.");
  }

  const body = new FormData();
  body.append("file", blob, "challenge-photo.jpg");
  body.append("upload_preset", uploadPreset);

  let response: Response;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 30000);
  try {
    response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
      method: "POST",
      body,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ImageUploadError("The photo upload took too long. Check your connection and try again.");
    }
    throw new ImageUploadError("The image service could not be reached. Check your connection and try again.");
  } finally {
    window.clearTimeout(timeout);
  }

  const result = await response.json().catch(() => null) as {
    secure_url?: string;
    error?: { message?: string };
  } | null;

  if (!response.ok || !result?.secure_url) {
    const detail = result?.error?.message;
    throw new ImageUploadError(detail ? `Photo upload failed: ${detail}` : "Photo upload failed. Check the Cloudinary settings and try again.");
  }

  return result.secure_url;
}
