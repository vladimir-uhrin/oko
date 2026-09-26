// Shared limits only; image decoding and storage stay on the server.
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export function validatePhotoFile(file) {
  if (!file || !PHOTO_TYPES.includes(file.type)) return 'photo_format';
  if (!file.size || file.size > PHOTO_MAX_BYTES) return 'photo_size';
  return null;
}
