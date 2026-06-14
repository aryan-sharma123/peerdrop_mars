# 📡 PeerDrop

P2P file transfer, straight from browser to browser. No servers storing your files, no accounts, no size limits from some company's storage bill. Drop a file, share a link, other person gets it. That's it.

Built this for MARS Open Projects 2026.

---

## Links

- **App** → https://peerdrop-mars.vercel.app/
- **Server** → https://peerdrop-mars.onrender.com/
- **Demo** → _add after recording_

The backend is on Render's free tier so the first connection might take ~30 seconds if the server went to sleep. Just wait a moment — it'll come up.

---

## How to run locally

Need two terminals open at the same time.

```bash
# terminal 1 — signaling server
cd server
npm install
npm run dev
```

```bash
# terminal 2 — frontend
cd client
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:5173` in two tabs. Drop a file in one, open the generated link in the other.

---

## What's actually happening

The signaling server (Node + Socket.io) only handles the WebRTC handshake — it passes tiny JSON messages between peers to help them find each other. Once connected, it's out of the picture entirely and the file goes directly browser to browser.

Every file gets encrypted with AES-256-GCM before it leaves your machine. The decryption key gets embedded in the URL fragment (the `#key=...` part). Browsers never send fragments to servers, so not even the signaling server can read your file. SHA-256 hash gets verified on the receiver side before the download triggers — if anything got corrupted in transit, it won't download.

TURN relay (Metered) handles cases where a direct connection isn't possible due to strict NAT — most corporate networks, different WiFi setups, etc.

---

## Stack

- React + Vite + Tailwind on the frontend
- Raw WebRTC — RTCDataChannel, FileReader API
- Web Crypto API for AES-256-GCM encryption and SHA-256 hashing
- Node.js + Express + Socket.io for signaling
- Vercel (frontend) + Render (backend)

---

## File structure

```
peerdrop/
├── server/
│   └── index.js        ← entire signaling server, ~74 lines
└── client/src/
    ├── App.jsx          ← sender and receiver UI
    ├── useWebRTC.js     ← all the WebRTC and socket logic
    └── utils.js         ← hashing, encryption, formatBytes
```

---

## Known issues / limitations

- 50MB file size limit — keeping the whole file in browser RAM while encrypting and chunking it
- 1-to-1 only, no multi-peer
- Both people need to be online at the same time
- Tested mainly on Chrome and Firefox — Safari works but WebRTC negotiation is sometimes slower
- Render free tier cold start (~30s on first connection after inactivity)

---

## Deployment notes

Backend on Render:
- root directory: `server`
- build: `npm install`, start: `npm start`

Frontend on Vercel:
- root directory: `client`
- env variable: `VITE_SERVER_URL` = your Render URL

