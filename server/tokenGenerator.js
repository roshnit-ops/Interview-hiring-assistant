import axios from 'axios';

/**
 * Generate a short-lived token for AssemblyAI Streaming WebSocket.
 * Client uses this token in the URL to connect without exposing the API key.
 */
export async function generateTempToken(expiresInSeconds = 600) {
  const url = `https://streaming.assemblyai.com/v3/token?expires_in_seconds=${expiresInSeconds}`;
  const response = await axios.get(url, {
    headers: {
      Authorization: process.env.ASSEMBLYAI_API_KEY,
    },
  });
  return response.data.token;
}
