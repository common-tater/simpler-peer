module.exports = SimplerPeer

var webrtc = require('get-browser-rtc')()
var inherits = require('inherits')
var EventEmitter = require('events').EventEmitter
var DataChannel = require('./data-channel')

inherits(SimplerPeer, EventEmitter)

function SimplerPeer (opts) {
  if (!(this instanceof SimplerPeer)) {
    return new SimplerPeer(opts)
  }

  if (!webrtc) {
    throw new Error('your browser does not support WebRTC')
  }

  opts = opts || {}
  opts.config = opts.config || {
    iceServers: [
      {
        url: 'stun:23.21.150.121',
        urls: 'stun:23.21.150.121'
      }
    ]
  }

  EventEmitter.call(this)

  this._initiator = opts.initiator
  this._defaultChannelConfig = opts.channelConfig
  this._trickle = opts.trickle !== undefined ? opts.trickle : true
  this._candidates = []

  this._onSetRemoteDescription = this._onSetRemoteDescription.bind(this)
  this._onCreateOffer = this._onCreateOffer.bind(this)
  this._onCreateAnswer = this._onCreateAnswer.bind(this)
  this._onDefaultChannelOpen = this._onDefaultChannelOpen.bind(this)
  this._onError = this._onError.bind(this)

  this.connection = new webrtc.RTCPeerConnection(opts.config)
  this.connection.ondatachannel = this._onDataChannel.bind(this)
  this.connection.onicecandidate = this._onIceCandidate.bind(this)
  this.connection.oniceconnectionstatechange = this._onIceConnectionStateChange.bind(this)

  if (this._initiator) {
    this.defaultChannel = this.createDataChannel('default')
    this.defaultChannel.once('open', this._onDefaultChannelOpen)
    this.connection.createOffer(
      this._onCreateOffer,
      this._onError
    )
  }
}

Object.defineProperty(SimplerPeer.prototype, 'state', {
  get: function () {
    return this.connection.iceConnectionState
  }
})

SimplerPeer.prototype.createDataChannel = function (label, opts) {
  return new DataChannel(this.connection.createDataChannel(label, opts || this._defaultChannelConfig))
}

SimplerPeer.prototype.signal = function (signal) {
  if (this._didClose) {
    this._onError(new Error('cannot signal after connection has closed'))
  }

  if (typeof signal === 'string') {
    signal = JSON.parse(signal)
  }

  if (signal.sdp) {
    this.connection.setRemoteDescription(
      new webrtc.RTCSessionDescription(signal),
      this._onSetRemoteDescription,
      this._onError
    )
  }

  if (signal.candidate) {
    if (this.connection.remoteDescription) {
      this._addIceCandidate(signal.candidate)
    } else {
      this._candidates.push(signal.candidate)
    }
  }
}

SimplerPeer.prototype.close = function () {
  if (!this._didClose) {
    this._didClose = true
    this.emit('close')
  }
}

// private API below

SimplerPeer.prototype._addIceCandidate = function (candidate) {
  this.connection.addIceCandidate(
    new webrtc.RTCIceCandidate(candidate),
    noop,
    this._onError
  )
}

SimplerPeer.prototype._onCreateOffer = function (offer) {
  if (this._didClose) {
    return
  }

  this._offer = offer

  this.connection.setLocalDescription(
    offer,
    noop,
    this._onError
  )

  if (this._trickle || (this._didConnect && !this._didClose)) {
    this._sendOffer()
  }
}

SimplerPeer.prototype._sendOffer = function () {
  var signal = this.connection.localDescription || this._offer

  delete this._offer

  this.emit('signal', {
    type: signal.type,
    sdp: signal.sdp
  })
}

SimplerPeer.prototype._onCreateAnswer = function (answer) {
  if (this._didClose) {
    return
  }

  this._answer = answer

  this.connection.setLocalDescription(
    answer,
    noop,
    this._onError
  )

  if (this._trickle || (this._didConnect && !this._didClose)) {
    this._sendAnswer()
  }
}

SimplerPeer.prototype._sendAnswer = function () {
  var signal = this.connection.localDescription || this._answer

  delete this._answer

  this.emit('signal', {
    type: signal.type,
    sdp: signal.sdp
  })
}

SimplerPeer.prototype._onSetRemoteDescription = function () {
  if (this._didClose) {
    return
  }

  if (this.connection.remoteDescription.type === 'offer') {
    this.connection.createAnswer(
      this._onCreateAnswer,
      this._onError
    )
  }

  this._candidates.forEach(this._addIceCandidate.bind(this))
  this._candidates = []
}

SimplerPeer.prototype._onDataChannel = function (evt) {
  if (this._didClose) {
    return
  }

  var channel = new DataChannel(evt.channel)

  if (channel.label === 'default' && !this.defaultChannel) {
    this.defaultChannel = channel
    this.defaultChannel.once('open', this._onDefaultChannelOpen)
  }

  this.emit('datachannel', channel)
}

SimplerPeer.prototype._onIceCandidate = function (evt) {
  if (this._didClose) {
    return
  }

  if (this._trickle) {
    if (evt.candidate) {
      this.emit('signal', {
        candidate: {
          candidate: evt.candidate.candidate,
          sdpMLineIndex: evt.candidate.sdpMLineIndex,
          sdpMid: evt.candidate.sdpMid
        }
      })
    }
  } else {
    if (!evt.candidate) {
      if (this._initiator) {
        this._sendOffer()
      } else {
        this._sendAnswer()
      }
    }
  }
}

SimplerPeer.prototype._onIceConnectionStateChange = function (evt) {
  if (this._didClose) {
    return
  }

  this.emit('statechange', this.state)

  if (this.state === 'connected' ||
      this.state === 'completed') {
    if (!this._didConnect && this.defaultChannel && this.defaultChannel.readyState === 'open') {
      this._didConnect = true
      this.emit('connect')
    }
  } else if (this.state === 'disconnected' ||
             this.state === 'closed') {
    this.close()
  }
}

SimplerPeer.prototype._onDefaultChannelOpen = function () {
  if (this._didClose) {
    return
  }

  if (!this._didConnect && this.defaultChannel.readyState === 'open') {
    this._didConnect = true
    this.emit('connect')
  }
}

SimplerPeer.prototype._onError = function (err) {
  this.emit('error', err)
}

function noop () {}
