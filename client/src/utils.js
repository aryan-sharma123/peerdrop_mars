// ─── File Hashing ─────────────────────────────────────────────────────────────

// SHA-256 hash the full file buffer
// we run this on the original file before encryption (sender)
// and on the decrypted buffer after receiving (receiver)
// if they match, the file arrived intact
export async function hashFile(buffer) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ─── AES-GCM Encryption ───────────────────────────────────────────────────────

// generate a fresh AES-256-GCM key — called once per transfer session
export async function generateKey() {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true, // exportable so we can share it via the URL
    ['encrypt', 'decrypt']
  )
}

// export the key to a base64 string so it can go in the URL fragment
export async function exportKey(key) {
  const raw = await crypto.subtle.exportKey('raw', key)
  return btoa(String.fromCharCode(...new Uint8Array(raw)))
}

// import a base64 key string back into a CryptoKey object
export async function importKey(base64) {
  const raw = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt'])
}

// encrypt the whole file buffer in one go
// returns the encrypted ArrayBuffer + the IV (needed for decryption)
export async function encryptFile(buffer, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, buffer)
  return { encrypted, iv }
}

// decrypt the reassembled buffer on the receiver side
export async function decryptFile(buffer, key, iv) {
  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(iv) },
    key,
    buffer
  )
}

// ─── Formatting helpers ────────────────────────────────────────────────────────

// human readable file size — used in the transfer summary card
export function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`
}
