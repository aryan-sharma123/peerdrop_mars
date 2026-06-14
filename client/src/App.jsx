import { useState, useEffect, useRef } from 'react'
import { useWebRTC } from './useWebRTC'
import { formatBytes } from './utils'

// ─── Connection Status Badge ──────────────────────────────────────────────────

function StatusBadge({ status, connectionType }) {
  const configs = {
    idle:         { dot: 'bg-zinc-500',           label: 'Not connected' },
    waiting:      { dot: 'bg-yellow-400 pulse-dot', label: 'Waiting for peer...' },
    connecting:   { dot: 'bg-yellow-400 pulse-dot', label: 'Connecting...' },
    connected:    { dot: 'bg-violet-400',           label: connectionType || 'Connected' },
    disconnected: { dot: 'bg-red-500',              label: 'Peer disconnected' },
  }

  const { dot, label } = configs[status] || configs.idle

  return (
    <div className="flex items-center gap-2 text-sm text-zinc-400">
      <span className={`w-2 h-2 rounded-full ${dot}`} />
      <span>{label}</span>
    </div>
  )
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────

function ProgressBar({ progress }) {
  if (!progress) return null

  return (
    <div className="w-full space-y-2">
      <div className="flex justify-between text-sm">
        <span className="text-zinc-400">Transferring...</span>
        <span className="text-violet-400 font-mono">{progress.speed} MB/s</span>
      </div>
      <div className="w-full bg-zinc-800 rounded-full h-2 overflow-hidden">
        <div
          className="h-2 bg-violet-500 rounded-full transition-all duration-300"
          style={{ width: `${progress.pct}%` }}
        />
      </div>
      <div className="text-right text-xs text-zinc-500 font-mono">{progress.pct}%</div>
    </div>
  )
}

// ─── Transfer Summary Card ────────────────────────────────────────────────────

function SummaryCard({ summary, isReceiver }) {
  return (
    <div className="w-full border border-zinc-700 rounded-xl p-5 space-y-3 bg-zinc-900/50">
      <div className="flex items-center gap-2">
        <span className="text-green-400 text-lg">✓</span>
        <span className="text-white font-medium">
          {isReceiver ? 'File received successfully.' : 'Transfer complete.'}
        </span>
      </div>
      <div className="border-t border-zinc-800 pt-3 space-y-2 font-mono text-sm">
        <div className="flex justify-between">
          <span className="text-zinc-500">File</span>
          <span className="text-zinc-300 truncate max-w-[200px]">{summary.name}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">Size</span>
          <span className="text-zinc-300">{formatBytes(summary.size)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">Avg speed</span>
          <span className="text-zinc-300">{summary.avgSpeed} MB/s</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">Duration</span>
          <span className="text-zinc-300">{summary.duration}s</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">Integrity</span>
          <span className="text-green-400">SHA-256 verified ✓</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">Encryption</span>
          <span className="text-violet-400">AES-256-GCM ✓</span>
        </div>
      </div>
    </div>
  )
}

// ─── Drop Zone ────────────────────────────────────────────────────────────────

function DropZone({ onFile, disabled }) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef(null)

  const handleDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    if (disabled) return
    const file = e.dataTransfer.files[0]
    if (file) onFile(file)
  }

  const handleChange = (e) => {
    const file = e.target.files[0]
    if (file) onFile(file)
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => !disabled && inputRef.current?.click()}
      className={`
        w-full border-2 border-dashed rounded-xl p-10 text-center cursor-pointer
        transition-all duration-200 select-none
        ${disabled ? 'opacity-40 cursor-not-allowed border-zinc-700' : ''}
        ${dragging ? 'border-violet-400 bg-violet-500/5' : 'border-zinc-700 hover:border-zinc-500 hover:bg-zinc-800/30'}
      `}
    >
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={handleChange}
        disabled={disabled}
      />
      <div className="text-4xl mb-3">📁</div>
      <p className="text-zinc-300 font-medium">Drop your file here</p>
      <p className="text-zinc-500 text-sm mt-1">or click to browse</p>
      <p className="text-zinc-600 text-xs mt-3">Max 50MB · stays end-to-end encrypted</p>
    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [selectedFile, setSelectedFile] = useState(null)
  const [fileError, setFileError] = useState(null)
  const [copied, setCopied] = useState(false)

  const {
    initSender,
    initReceiver,
    shareUrl,
    connectionStatus,
    connectionType,
    progress,
    transferSummary,
    error,
    peerJoined,
  } = useWebRTC()

  // figure out if we're the receiver by checking the URL
  const params = new URLSearchParams(window.location.search)
  const roomId = params.get('room')
  const isReceiver = !!roomId

  // receiver: auto-connect on mount
  useEffect(() => {
    if (!isReceiver) return
    const base64Key = window.location.hash.startsWith('#key=')
      ? window.location.hash.slice(5)
      : null

    if (!base64Key) {
      // key is missing from the URL — link is broken
      return
    }

    initReceiver(roomId, base64Key)
  }, [])

  // sender: handle file drop
  const handleFile = (file) => {
    setFileError(null)

    if (file.size > 50 * 1024 * 1024) {
      setFileError(`"${file.name}" is ${formatBytes(file.size)} — max allowed is 50MB.`)
      return
    }

    setSelectedFile(file)
    initSender(file)
  }

  // copy share link to clipboard
  const copyLink = () => {
    navigator.clipboard.writeText(shareUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // ─── Sender UI ──────────────────────────────────────────────────────────────
  if (!isReceiver) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-md space-y-6">

          {/* header */}
          <div className="text-center space-y-1">
            <h1 className="text-2xl font-bold tracking-tight">
              📡 PeerDrop
            </h1>
            <p className="text-zinc-500 text-sm">
              Direct browser-to-browser file transfer. No servers, no storage.
            </p>
          </div>

          {/* status badge */}
          <div className="flex justify-center">
            <StatusBadge status={connectionStatus} connectionType={connectionType} />
          </div>

          {/* error from hook */}
          {(error || fileError) && (
            <div className="bg-red-950/50 border border-red-800 rounded-lg px-4 py-3 text-red-300 text-sm">
              {error || fileError}
            </div>
          )}

          {/* no key in URL warning for receiver who lands here */}
          {!isReceiver && !selectedFile && connectionStatus === 'idle' && (
            <DropZone onFile={handleFile} disabled={false} />
          )}

          {/* file selected, waiting for room to be created */}
          {selectedFile && connectionStatus === 'waiting' && !shareUrl && (
            <div className="text-center text-zinc-400 text-sm py-6 animate-pulse">
              Generating your secure link...
            </div>
          )}

          {/* share link ready */}
          {shareUrl && connectionStatus === 'waiting' && (
            <div className="space-y-4">
              <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-4 space-y-3">
                <p className="text-xs text-zinc-500 uppercase tracking-widest">Selected file</p>
                <p className="text-white font-medium truncate">{selectedFile.name}</p>
                <p className="text-zinc-400 text-sm">{formatBytes(selectedFile.size)}</p>
              </div>

              <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-4 space-y-3">
                <p className="text-xs text-zinc-500 uppercase tracking-widest">Share this link</p>
                <p className="text-violet-300 text-xs font-mono break-all leading-relaxed">
                  {shareUrl}
                </p>
                <button
                  onClick={copyLink}
                  className="w-full bg-violet-600 hover:bg-violet-500 active:bg-violet-700
                             text-white text-sm font-medium py-2 rounded-lg transition-colors"
                >
                  {copied ? 'Copied ✓' : 'Copy link'}
                </button>
              </div>

              <p className="text-center text-zinc-500 text-xs">
                Waiting for the other person to open this link...
              </p>
            </div>
          )}

          {/* peer joined, establishing WebRTC */}
          {peerJoined && connectionStatus === 'connecting' && (
            <div className="text-center text-zinc-400 text-sm py-4 animate-pulse">
              Peer joined — establishing direct connection...
            </div>
          )}

          {/* transfer in progress */}
          {connectionStatus === 'connected' && progress && !transferSummary && (
            <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 space-y-4">
              <p className="text-sm text-zinc-400">
                Sending <span className="text-white">{selectedFile?.name}</span>
              </p>
              <ProgressBar progress={progress} />
            </div>
          )}

          {/* done */}
          {transferSummary && (
            <SummaryCard summary={transferSummary} isReceiver={false} />
          )}

          {/* peer disconnected */}
          {connectionStatus === 'disconnected' && !transferSummary && (
            <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 text-center space-y-2">
              <p className="text-zinc-300 font-medium">Connection lost</p>
              <p className="text-zinc-500 text-sm">
                Looks like the other person left.{' '}
                <button
                  onClick={() => window.location.reload()}
                  className="text-violet-400 hover:text-violet-300 underline underline-offset-2"
                >
                  Start over
                </button>
              </p>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ─── Receiver UI ────────────────────────────────────────────────────────────
  const noKey = !window.location.hash.startsWith('#key=')

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">

        {/* header */}
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">📡 PeerDrop</h1>
          <p className="text-zinc-500 text-sm">Someone is sending you a file.</p>
        </div>

        {/* status */}
        <div className="flex justify-center">
          <StatusBadge status={connectionStatus} connectionType={connectionType} />
        </div>

        {/* broken link */}
        {noKey && (
          <div className="bg-red-950/50 border border-red-800 rounded-lg px-4 py-3 text-red-300 text-sm text-center">
            This link is missing the encryption key. Ask the sender to share the full link.
          </div>
        )}

        {/* hook error */}
        {error && (
          <div className="bg-red-950/50 border border-red-800 rounded-lg px-4 py-3 text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* connecting */}
        {!noKey && connectionStatus === 'connecting' && !error && (
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-8 text-center space-y-3">
            <div className="text-3xl animate-pulse">🔗</div>
            <p className="text-zinc-300">Connecting to sender...</p>
            <p className="text-zinc-500 text-xs">
              This usually takes a few seconds
            </p>
          </div>
        )}

        {/* connected, waiting for transfer to start */}
        {connectionStatus === 'connected' && !progress && !transferSummary && (
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-8 text-center space-y-3">
            <div className="text-3xl">⚡</div>
            <p className="text-zinc-300">Connected — receiving file...</p>
          </div>
        )}

        {/* transfer in progress */}
        {connectionStatus === 'connected' && progress && !transferSummary && (
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 space-y-4">
            <p className="text-sm text-zinc-400">Receiving file...</p>
            <ProgressBar progress={progress} />
            <p className="text-xs text-zinc-600 text-center">
              Decrypted and integrity-checked on arrival
            </p>
          </div>
        )}

        {/* done */}
        {transferSummary && (
          <SummaryCard summary={transferSummary} isReceiver={true} />
        )}

        {/* peer disconnected before transfer completed */}
        {connectionStatus === 'disconnected' && !transferSummary && (
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 text-center space-y-2">
            <p className="text-zinc-300 font-medium">Sender disconnected</p>
            <p className="text-zinc-500 text-sm">
              The transfer was interrupted. Ask the sender for a new link.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
