import { useState, useRef } from 'react'
import { io } from 'socket.io-client'
import { hashFile, encryptFile, decryptFile, generateKey, exportKey, importKey } from './utils'







const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001'

const CHUNK_SIZE = 16 * 1024        // 16KB per chunk — safe across all browsers
const MAX_BUFFER = 256 * 1024       // pause sending if outgoing buffer exceeds 256KB








const ICE_CONFIG = {




  iceServers: [
    {
      urls: 'stun:stun.relay.metered.ca:80',
    },
    {
      urls: 'turn:global.relay.metered.ca:80',
      username: '42552c796c92f02cee48a5cf',
      credential: 'MtqmTWvXFpEeevF4',
    },
    {
      urls: 'turn:global.relay.metered.ca:80?transport=tcp',
      username: '42552c796c92f02cee48a5cf',
      credential: 'MtqmTWvXFpEeevF4',
    },
    {
      urls: 'turn:global.relay.metered.ca:443',
      username: '42552c796c92f02cee48a5cf',
      credential: 'MtqmTWvXFpEeevF4',
    },
    {
      urls: 'turns:global.relay.metered.ca:443?transport=tcp',
      username: '42552c796c92f02cee48a5cf',
      credential: 'MtqmTWvXFpEeevF4',
    },
  ],
}


export function useWebRTC() {
  // ─── State ──────────────────────────────────────────────────────────────────
  const [connectionStatus, setConnectionStatus] = useState('idle')
  // idle | waiting | connecting | connected | disconnected




  const [connectionType, setConnectionType] = useState(null)
  // 'Direct P2P' | 'Relay' — detected from ICE candidate type after connect
  const [progress, setProgress] = useState(null)



  // { pct, speed } updated during transfer
  const [shareUrl, setShareUrl] = useState(null)
  const [transferSummary, setTransferSummary] = useState(null)
  const [error, setError] = useState(null)



  const [peerJoined, setPeerJoined] = useState(false)

  // ─── Refs (mutable, don't trigger re-renders) ────────────────────────────────
  const socketRef = useRef(null)
  const pcRef = useRef(null)
  const dcRef = useRef(null)
  const fileRef = useRef(null)
  const cryptoKeyRef = useRef(null)
  const roomIdRef = useRef(null)
  const pendingCandidates = useRef([])  // ICE candidates that arrived before remote desc was set

  // ─── Shared: set up RTCPeerConnection ────────────────────────────────────────
  function setupPeerConnection() {
    const pc = new RTCPeerConnection(ICE_CONFIG)

    // relay our ICE candidates to the other peer via signaling server
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        socketRef.current.emit('signal', {
          roomId: roomIdRef.current,
          signal: { type: 'candidate', candidate },
        })
      }
    }




    // watch connection state — this catches network drops, not just tab closes
    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState



      if (state === 'connected' || state === 'completed') {
        setConnectionStatus('connected')




        // figure out if we're going direct or through the TURN relay
        pc.getStats().then((stats) => {
          stats.forEach((report) => {
            if (report.type === 'candidate-pair' && report.state === 'succeeded') {
              const remote = [...stats.values()].find((r) => r.id === report.remoteCandidateId)
              if (remote) {

                setConnectionType(remote.candidateType === 'relay' ? 'Relay' : 'Direct P2P')
              }
            }
          })
        })
      }

      if (['disconnected', 'failed', 'closed'].includes(state)) {
        setConnectionStatus('disconnected')
      }
    }

    pcRef.current = pc
    return pc
  }

  // ─── Sender: initSender ───────────────────────────────────────────────────────
  // called when the sender drops a file
  async function initSender(file) {
    fileRef.current = file

    // generate encryption key for this session
    const key = await generateKey()


    cryptoKeyRef.current = key
    const base64Key = await exportKey(key)

    const socket = io(SERVER_URL)
    socketRef.current = socket



    socket.once('connect', () => {
      socket.emit('create-room')
    })

    socket.on('room-created', ({ roomId }) => {
      roomIdRef.current = roomId
      // key goes in the URL fragment — fragments are never sent to the server
      const url = `${window.location.origin}/?room=${roomId}#key=${base64Key}`
      setShareUrl(url)
      setConnectionStatus('waiting')

    })

    // receiver joined — now we kick off the WebRTC handshake
    socket.on('peer-joined', async () => {
      setPeerJoined(true)
      setConnectionStatus('connecting')

      const pc = setupPeerConnection()

      // sender creates the DataChannel
      const dc = pc.createDataChannel('fileTransfer')
      dcRef.current = dc

      dc.onopen = () => startTransfer()
      dc.onclose = () => setConnectionStatus('disconnected')

      // create offer and send it through the signaling server
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      socket.emit('signal', {
        roomId: roomIdRef.current,
        signal: { type: 'offer', sdp: offer },
      })
    })

    // handle incoming signals from receiver (answer + ICE candidates)
    socket.on('signal', async ({ signal }) => {
      const pc = pcRef.current
      if (!pc) return

      if (signal.type === 'answer') {
        await pc.setRemoteDescription(signal.sdp)
        // flush any ICE candidates that arrived before the answer
        for (const c of pendingCandidates.current) {
          await pc.addIceCandidate(c)
        }
        pendingCandidates.current = []
      }

      if (signal.type === 'candidate') {
        if (pc.remoteDescription) {
          await pc.addIceCandidate(signal.candidate)
        } else {
          // queue it — remote description isn't set yet
          pendingCandidates.current.push(signal.candidate)
        }
      }
    })

    socket.on('peer-left', () => setConnectionStatus('disconnected'))
    socket.on('room-error', ({ message }) => setError(message))
  }

  // ─── Sender: startTransfer ────────────────────────────────────────────────────
  // called automatically when the DataChannel opens
  async function startTransfer() {
    const file = fileRef.current
    const dc = dcRef.current
    const key = cryptoKeyRef.current
    if (!file || !dc || !key) return

    const startTime = Date.now()

    // read file using FileReader API (as required)
    const originalBuffer = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => resolve(e.target.result)
      reader.onerror = reject
      reader.readAsArrayBuffer(file)
    })

    // hash the original file BEFORE encryption
    // receiver will hash the decrypted file and compare
    const hash = await hashFile(originalBuffer)

    // encrypt the whole file in one shot
    const { encrypted, iv } = await encryptFile(originalBuffer, key)

    dc.send(
      JSON.stringify({
        type: 'meta',
        name: file.name,
        size: file.size,
        mimeType: file.type,
        hash,
        iv: Array.from(iv),
      })
    )

    // send the encrypted file in 16KB chunks
    let offset = 0
    let lastPct = -1

    while (offset < encrypted.byteLength) {
      // backpressure — if the buffer is backing up, wait for it to drain
      if (dc.bufferedAmount > MAX_BUFFER) {
        await new Promise((resolve) => {
          dc.bufferedAmountLowThreshold = MAX_BUFFER / 2
          dc.onbufferedamountlow = resolve
        })
      }

      const chunk = encrypted.slice(offset, offset + CHUNK_SIZE)
      dc.send(chunk)
      offset += chunk.byteLength

      // update progress UI — only when % actually changes to avoid hammering React
      const pct = Math.round((offset / encrypted.byteLength) * 100)
      if (pct !== lastPct) {
        lastPct = pct
        const elapsed = (Date.now() - startTime) / 1000 || 0.01
        const speed = (offset / elapsed / 1024 / 1024).toFixed(1)
        setProgress({ pct, speed })
      }
    }

    dc.send(JSON.stringify({ type: 'done' }))

    const duration = Math.max(0.1, (Date.now() - startTime) / 1000).toFixed(1)
    const avgSpeed = (file.size / parseFloat(duration) / 1024 / 1024).toFixed(1)
    setTransferSummary({ name: file.name, size: file.size, duration, avgSpeed })
  }

  // ─── Receiver: initReceiver ───────────────────────────────────────────────────
  // called on mount for anyone who opens a /?room=... link
  async function initReceiver(roomId, base64Key) {
    roomIdRef.current = roomId

    // import the decryption key from the URL fragment
    try {
      const key = await importKey(base64Key)
      cryptoKeyRef.current = key
    } catch {
      setError('Invalid share link — the encryption key is missing or corrupted.')
      return
    }

    const socket = io(SERVER_URL)
    socketRef.current = socket
    setConnectionStatus('connecting')

    socket.once('connect', () => {
      socket.emit('join-room', { roomId })
    })

    socket.on('joined-room', () => {
      const pc = setupPeerConnection()

      // receiver waits for the sender to create the DataChannel
      pc.ondatachannel = ({ channel }) => {
        dcRef.current = channel
        // must set this so binary data arrives as ArrayBuffer, not Blob
        channel.binaryType = 'arraybuffer'
        setupReceiveHandlers(channel)
      }
    })

    // handle incoming signals from sender (offer + ICE candidates)
    socket.on('signal', async ({ signal }) => {
      const pc = pcRef.current
      if (!pc) return

      if (signal.type === 'offer') {
        await pc.setRemoteDescription(signal.sdp)
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        socket.emit('signal', {
          roomId,
          signal: { type: 'answer', sdp: answer },
        })
        // flush queued ICE candidates
        for (const c of pendingCandidates.current) {
          await pc.addIceCandidate(c)
        }
        pendingCandidates.current = []
      }

      if (signal.type === 'candidate') {
        if (pc.remoteDescription) {
          await pc.addIceCandidate(signal.candidate)
        } else {
          pendingCandidates.current.push(signal.candidate)
        }
      }
    })

    socket.on('peer-left', () => setConnectionStatus('disconnected'))
    socket.on('room-error', ({ message }) => setError(message))
  }

  // ─── Receiver: handle incoming file data ─────────────────────────────────────
  function setupReceiveHandlers(dc) {
    const chunks = []
    let metadata = null
    let receivedBytes = 0
    let startTime = null

    dc.onmessage = async (event) => {
      // string messages = control messages (meta, done)
      if (typeof event.data === 'string') {
        const msg = JSON.parse(event.data)

        if (msg.type === 'meta') {
          metadata = msg
          chunks.length = 0
          receivedBytes = 0
          startTime = Date.now()
        }

        if (msg.type === 'done' && metadata) {
          const totalBytes = chunks.reduce((acc, c) => acc + c.byteLength, 0)
          const combined = new Uint8Array(totalBytes)
          let pos = 0
          for (const chunk of chunks) {
            combined.set(new Uint8Array(chunk), pos)
            pos += chunk.byteLength
          }

          // decrypt the file
          let decrypted
          try {
            decrypted = await decryptFile(combined.buffer, cryptoKeyRef.current, metadata.iv)
          } catch {
            setError('Decryption failed — the link may be invalid or the file was corrupted.')
            return
          }

          // verify integrity — hash the decrypted buffer and compare with sender's hash
          const receivedHash = await hashFile(decrypted)
          if (receivedHash !== metadata.hash) {
            setError('Integrity check failed — file hash does not match. Transfer may be corrupted.')
            return
          }

          const blob = new Blob([decrypted], { type: metadata.mimeType })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = metadata.name
          a.click()
          URL.revokeObjectURL(url)

          const duration = Math.max(0.1, (Date.now() - startTime) / 1000).toFixed(1)
          const avgSpeed = (metadata.size / parseFloat(duration) / 1024 / 1024).toFixed(1)
          setTransferSummary({
            name: metadata.name,
            size: metadata.size,
            duration,
            avgSpeed,
          })
          setProgress({ pct: 100, speed: avgSpeed })
        }
      } else {
        chunks.push(event.data)
        receivedBytes += event.data.byteLength

        if (metadata && startTime) {
          const pct = Math.min(99, Math.round((receivedBytes / metadata.size) * 100))
          const elapsed = (Date.now() - startTime) / 1000 || 0.01
          const speed = (receivedBytes / elapsed / 1024 / 1024).toFixed(1)
          setProgress({ pct, speed })
        }
      }
    }

    dc.onclose = () => setConnectionStatus('disconnected')
  }

  return {
    initSender,
    initReceiver,
    shareUrl,
    connectionStatus,
    connectionType,
    progress,
    transferSummary,
    error,
    peerJoined,
  }
}
