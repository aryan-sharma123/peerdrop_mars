### Name - Aryan
### en no - 23112022
### email - aryan@ch.iitr.ac.in


#  PeerDrop

## **Heads up:** the backend is on Render's free tier so the first connection might take around 30 seconds if the server went to sleep. Just wait a moment and it'll come up fine.

---

### To enable share on different networks ( sender and receiver are on different wifi connections )  METERED credentials are used.



Direct browser-to-browser file transfer. No cloud storage, no middlemen — just a secure P2P connection between two browsers.



---

## Live Demo



 ###   App  https://peerdrop-mars.vercel.app/ 

---


### Server  https://peerdrop-mars.onrender.com/ 



---

## What it does

1. **Direct P2P transfer** — the file goes straight from your browser to theirs. Nothing gets stored on any server
2. **End-to-end encrypted** — every file is encrypted with AES-256-GCM before it leaves your machine. The decryption key only lives in the URL fragment (`#key=...`) which browsers never send to servers — so not even the signaling server can read your file
3. **Integrity verified** — a SHA-256 hash gets computed before sending and verified after the file is fully received. If even a single byte got corrupted somewhere in transit, the download gets blocked
4. **Works across different networks** — TURN relay (Metered) handles cases where a direct connection isn't possible, like different WiFi networks or strict corporate NATs
5. **Auto-downloads** — once the transfer is done and the hash checks out, the file downloads automatically on the receiver side

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite + Tailwind CSS |
| P2P | WebRTC (RTCDataChannel + FileReader API) |
| Encryption | Web Crypto API — AES-256-GCM |
| Integrity | SHA-256 via crypto.subtle |
| Signaling | Node.js + Express + Socket.io |
| TURN Relay | Metered.ca |
| Frontend Deploy | Vercel |
| Backend Deploy | Render |

---

## How it works

```
1. Sender drops a file → AES-256-GCM key gets generated → room created on signaling server
2. Share URL carries the room ID (query param) + decryption key (URL fragment)
3. The URL fragment never reaches the server — zero-knowledge by design
4. Receiver opens the link → WebRTC handshake happens via Socket.io signaling
5. Direct P2P DataChannel opens (or falls back to TURN relay if NAT blocks it)
6. File read via FileReader API → encrypted → sliced into 16KB chunks → sent over DataChannel
7. Receiver collects chunks → reassembles → decrypts → SHA-256 verified → auto-downloads
```

The signaling server only ever sees tiny JSON messages for the handshake. It never touches the actual file data.

---

## Running locally

You'll need two terminals open at the same time.

**Prerequisites:** Node.js 20+ (the `.nvmrc` file handles this if you use nvm)

**Terminal 1 — signaling server:**
```bash
cd server
npm install
npm run dev
# starts on http://localhost:3001
```

**Terminal 2 — frontend:**
```bash
cd client
npm install
cp .env.example .env.local
npm run dev
# starts on http://localhost:5173
```

Open `http://localhost:5173` in two browser tabs. Drop a file in the first tab, copy the generated link, open it in the second tab.

---

## Project structure

```
peerdrop/
├── server/
│   ├── index.js          ← entire signaling server (~74 lines)
│   └── package.json
└── client/
    ├── src/
    │   ├── App.jsx        ← all the UI — sender and receiver views
    │   ├── useWebRTC.js   ← WebRTC + socket logic
    │   ├── utils.js       ← hashing, encryption, formatBytes
    │   └── main.jsx
    ├── index.html
    └── package.json
```

---

## Deploying yourself

**Backend → Render:**
- Root directory: `server`
- Build command: `npm install`
- Start command: `npm start`

**Frontend → Vercel:**
- Root directory: `client`
- Framework preset: Vite
- Environment variable: `VITE_SERVER_URL` = your Render URL

---

## Known limitations

- 50MB file size limit — the whole file needs to fit in browser memory while encrypting and chunking
- One sender, one receiver per room — no multi-peer support
- Both people need to be online at the same time, no async delivery
- Tested on Chrome and Firefox — Safari works but WebRTC negotiation can be a bit slow sometimes
- Render free tier cold start (~30 seconds on first connection after a period of inactivity)

---

## Things that would be interesting to add

- Multi-peer mesh support so multiple receivers can download different chunks simultaneously
- Large file support using the Origin Private File System (OPFS) to bypass the RAM limit
- Auto-resume on connection drop — track the last verified chunk and pick up from there instead of restarting
