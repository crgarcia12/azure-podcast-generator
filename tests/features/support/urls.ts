const LOCAL_WEB_URL = 'http://localhost:3001';
const LOCAL_API_URL = 'http://localhost:5001';
const LILIPUT_BASE_PATH = '/dev/crgarcia12/azure-podcast-generator/liliput-task-903211f8';

function deployedPreviewUrl(): string | null {
  const publicUrl = process.env.LILIPUT_PUBLIC_URL?.trim().replace(/\/$/, '');
  if (!publicUrl) {
    return null;
  }

  const basePath = (
    process.env.BASE_PATH
    || process.env.NEXT_PUBLIC_BASE_PATH
    || LILIPUT_BASE_PATH
  ).trim().replace(/\/$/, '');

  return `${publicUrl}${basePath}`;
}

const previewUrl = deployedPreviewUrl();

export const WEB_URL = process.env.WEB_URL?.trim().replace(/\/$/, '')
  || previewUrl
  || LOCAL_WEB_URL;

export const API_URL = process.env.API_URL?.trim().replace(/\/$/, '')
  || previewUrl
  || LOCAL_API_URL;
