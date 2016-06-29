module.exports = SimplerPeer

var webrtc = require('get-browser-rtc')()
var inherits = require('inherits')
var EventEmitter = require('events').EventEmitter
var DataChannel = require('./data-channel')
var sessionVersionRegex = /\no=- [^ ]* ([^ ]*)/

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
  this._trickle = opts.trickle !== undefined ? opts.trickle : true

  this._onSetRemoteDescription = this._onSetRemoteDescription.bind(this)
  this._onSetLocalDescription = this._onSetLocalDescription.bind(this)
  this._onCreateOffer = this._onCreateOffer.bind(this)
  this._onCreateAnswer = this._onCreateAnswer.bind(this)
  this._onChannelOpen = this._onChannelOpen.bind(this)
  this._onChannelMessage = this._onChannelMessage.bind(this)
  this._onError = this._onError.bind(this)

  this.id = opts.id || (Math.random() + '').slice(2)
  this.connection = new webrtc.RTCPeerConnection(opts.config)
  this.connection.ondatachannel = this._onDataChannel.bind(this)
  this.connection.onicecandidate = this._onIceCandidate.bind(this)
  this.connection.oniceconnectionstatechange = this._onIceConnectionStateChange.bind(this)
  this.connection.onaddstream = this._onaddStream.bind(this)
  this.connection.onnegotiationneeded = this._onNegotiationNeeded.bind(this)

  if (opts.stream) {
    this.connection.addStream(opts.stream)
  }

  if (this._initiator) {
    this._channel = this.createDataChannel('internal')
    this._channel.once('open', this._onChannelOpen)
  }
}

SimplerPeer.prototype.signal = function (signal) {
  if (this.closed) {
    this._onError(new Error('cannot signal after connection has closed'))
  }

  if (typeof signal === 'string') {
    signal = JSON.parse(signal)
  }

  if (signal.sdp) {
    this._processRemoteSessionDescription(signal)
  } else if (signal.candidate) {
    this._processRemoteIceCandidate(signal.candidate)
  }
}

SimplerPeer.prototype.createDataChannel = function (label, opts) {
  debug(this.id, 'createDataChannel', label)

  return new DataChannel(this.connection.createDataChannel(label, opts))
}

SimplerPeer.prototype.addStream = function (stream) {
  debug(this.id, 'addStream', stream)

  this.connection.addStream(stream)
}

SimplerPeer.prototype.removeStream = function (stream) {
  debug(this.id, 'removeStream', stream)

  this.connection.removeStream(stream)
}

SimplerPeer.prototype.close = function () {
  if (this.closed) return
  this.closed = true
  this.connected = false

  debug(this.id, 'close')

  try {
    this._channel.close()
  } catch (err) {}

  try {
    this.connection.close()
  } catch (err) {}

  this.emit('close')
}

// private API below

SimplerPeer.prototype._onNegotiationNeeded = function () {
  debug(this.id, 'onNegotiationNeeded')

  this.emit('negotiationneeded')

  delete this._localOffer
  this.connection.createOffer(
    this._onCreateOffer,
    this._onError
  )
}

SimplerPeer.prototype._onCreateOffer = function (offer) {
  if (this.closed) return

  debug(this.id, 'onCreateOffer', offer)

  this._localOffer = offer

  if (this.connected) {
    this._channel.send(
      JSON.stringify(offer)
    )
  } else {
    this.connection.setLocalDescription(
      offer,
      this._onSetLocalDescription,
      this._onError
    )
  }
}

SimplerPeer.prototype._processRemoteSessionDescription = function (signal) {
  if (signal.type === 'offer') {
    this._processRemoteOffer(signal)
  } else if (signal.type === 'answer' && this._localOffer) {
    this._processRemoteAnswer(signal)
  }
}

SimplerPeer.prototype._processRemoteOffer = function (offer) {
  debug(this.id, 'got offer', offer)

  if (this._remoteOffer) {
    this._remoteOffer = offer
    return
  } else {
    this._remoteOffer = offer
  }

  this.connection.setRemoteDescription(
    new webrtc.RTCSessionDescription(offer),
    this._onSetRemoteDescription,
    this._onError
  )
}

SimplerPeer.prototype._processRemoteAnswer = function (answer) {
  var remoteSessionVersion = answer.sdp.match(sessionVersionRegex)[1]
  var localSessionVersion = this._localOffer.sdp.match(sessionVersionRegex)[1]
  if (remoteSessionVersion !== localSessionVersion) {
    return
  }

  debug(this.id, 'got answer', answer)

  this._remoteAnswer = new webrtc.RTCSessionDescription(answer)
  var offer = this._localOffer
  delete this._localOffer

  if (this.connected) {
    this.connection.setLocalDescription(
      offer,
      this._onSetLocalDescription,
      this._onError
    )
  } else {
    this._onSetLocalDescription()
  }
}

SimplerPeer.prototype._processRemoteIceCandidate = function (candidate) {
  debug(this.id, 'got candidate', candidate)

  this.connection.addIceCandidate(
    new webrtc.RTCIceCandidate(candidate),
    noop,
    this._onError
  )
}

SimplerPeer.prototype._hasLatestOffer = function () {
  var latestSessionVersion = this._remoteOffer.sdp.match(sessionVersionRegex)[1]
  var currentSessionVersion = this.connection.remoteDescription.sdp.match(sessionVersionRegex)[1]
  if (latestSessionVersion === currentSessionVersion) {
    return true
  }

  debug(this.id, 'found later offer', this._remoteOffer)

  var offer = this._remoteOffer
  delete this._remoteOffer
  this._processRemoteOffer(offer)
}

SimplerPeer.prototype._onSetRemoteDescription = function () {
  if (this.closed || !this._hasLatestOffer()) return

  debug(this.id, 'onSetRemoteDescription')

  this.connection.createAnswer(
    this._onCreateAnswer,
    this._onError
  )
}

SimplerPeer.prototype._onCreateAnswer = function (answer) {
  if (this.closed || !this._hasLatestOffer()) return
  delete this._remoteOffer

  debug(this.id, 'onCreateAnswer', answer)

  if (this.connected) {
    this._channel.send(
      JSON.stringify(answer)
    )
  } else if (this._trickle) {
    this.emit('signal', answer)
  }

  this.connection.setLocalDescription(
    answer,
    noop,
    this._onError
  )
}

SimplerPeer.prototype._onSetLocalDescription = function () {
  if (this.closed) return

  debug(this.id, 'onSetLocalDescription')

  if (this._remoteAnswer) {
    var answer = this._remoteAnswer
    delete this._remoteAnswer
    this.connection.setRemoteDescription(
      answer,
      noop,
      this._onError
    )
  } else if (this._trickle) {
    this.emit('signal', this.connection.localDescription)
  }
}

SimplerPeer.prototype._onIceCandidate = function (evt) {
  if (this.closed) return

  debug(this.id, 'onIceCandidate', evt)

  if (this._trickle) {
    if (evt.candidate) {
      this.emit('signal', evt)
    }
  } else {
    clearTimeout(this._iceGatheringTimeout)
    if (!evt.candidate) {
      this._onIceComplete()
    } else {
      this._iceGatheringTimeout = setTimeout(this._onIceComplete.bind(this), 250)
    }
  }
}

SimplerPeer.prototype._onIceConnectionStateChange = function (evt) {
  if (this.closed) return

  var state = this.connection.iceConnectionState

  debug(this.id, 'statechange', state)

  this.emit('statechange', state)

  if (state === 'completed' || state === 'connected') {
    this._onIceComplete()
  } else if (state === 'failed' || state === 'closed') {
    this.close()
  }
}

SimplerPeer.prototype._onIceComplete = function () {
  this.connection.onicecandidate = null
  this._onIceComplete = noop

  debug(this.id, 'onIceComplete')

  if (!this._trickle) {
    this.emit('signal', this.connection.localDescription)
  }
}

SimplerPeer.prototype._onDataChannel = function (evt) {
  if (this.closed) return

  var channel = new DataChannel(evt.channel)
  if (channel.label === 'internal' && !this._channel) {
    debug(this.id, 'onDataChannel (internal)', channel)

    this._channel = channel
    this._channel.on('open', this._onChannelOpen)
  } else {
    debug(this.id, 'onDataChannel', channel)

    this.emit('datachannel', channel)
  }
}

SimplerPeer.prototype._onChannelOpen = function () {
  if (this.closed) return

  debug(this.id, 'connect')

  this._channel.on('close', this.close.bind(this))
  this._channel.on('message', this._onChannelMessage)
  this.connected = true
  this.emit('connect')
}

SimplerPeer.prototype._onChannelMessage = function (evt) {
  if (this.closed) return

  debug(this.id, 'onChannelMessage', evt)

  this.signal(evt.data)
}

SimplerPeer.prototype._onaddStream = function (evt) {
  if (this.closed) return

  debug(this.id, 'onaddStream', evt.stream)

  this.emit('stream', evt.stream)
}

SimplerPeer.prototype._onError = function (err) {
  debug(this.id, 'error', err)

  this.emit('error', err)
}

function debug () {
  // console.log.apply(console, arguments)
}

function noop () {}
