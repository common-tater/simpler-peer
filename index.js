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

  this._onSetRemoteDescription = this._onSetRemoteDescription.bind(this)
  this._onCreateOffer = this._onCreateOffer.bind(this)
  this._onCreateAnswer = this._onCreateAnswer.bind(this)
  this._sendOffer = this._sendOffer.bind(this)
  this._sendAnswer = this._sendAnswer.bind(this)
  this._onDefaultChannelOpen = this._onDefaultChannelOpen.bind(this)
  this._onError = this._onError.bind(this)

  this.id = opts.id || (Math.random() + '').slice(2)
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
  debug(this.id, 'createDataChannel', label)

  return new DataChannel(this.connection.createDataChannel(label, opts || this._defaultChannelConfig))
}

SimplerPeer.prototype.signal = function (signal) {
  if (this.closed) {
    this._onError(new Error('cannot signal after connection has closed'))
  }

  if (typeof signal === 'string') {
    signal = JSON.parse(signal)
  }

  if (signal.sdp) {
    debug(this.id, 'setRemoteDescription', signal)

    this.connection.setRemoteDescription(
      new webrtc.RTCSessionDescription(signal),
      this._onSetRemoteDescription,
      this._onError
    )
  }

  if (signal.candidate) {
    this._addIceCandidate(signal.candidate)
  }
}

SimplerPeer.prototype.close = function () {
  if (this.closed) return
  this.closed = true

  debug(this.id, 'close')

  try {
    this.defaultChannel.close()
  } catch (err) {}

  try {
    this.connection.close()
  } catch (err) {}

  this.emit('close')
}

// private API below

SimplerPeer.prototype._addIceCandidate = function (candidate) {
  debug(this.id, 'addIceCandidate', candidate)

  this.connection.addIceCandidate(
    new webrtc.RTCIceCandidate(candidate),
    noop,
    this._onError
  )
}

SimplerPeer.prototype._onCreateOffer = function (offer) {
  if (this.closed) {
    return
  }

  debug(this.id, 'onCreateOffer', offer)

  this.connection.setLocalDescription(
    offer,
    this._trickle ? this._sendOffer : noop,
    this._onError
  )
}

SimplerPeer.prototype._sendOffer = function () {
  if (this._didSendOffer) {
    return
  } else {
    this._didSendOffer = true
  }

  var signal = this.connection.localDescription

  debug(this.id, 'sendOffer', signal)

  this.emit('signal', signal)
}

SimplerPeer.prototype._onCreateAnswer = function (answer) {
  if (this.closed) {
    return
  }

  debug(this.id, 'onCreateAnswer', answer)

  this.connection.setLocalDescription(
    answer,
    this._trickle ? this._sendAnswer : noop,
    this._onError
  )
}

SimplerPeer.prototype._sendAnswer = function () {
  if (this._didSendAnswer) {
    return
  } else {
    this._didSendAnswer = true
  }

  var signal = this.connection.localDescription

  debug(this.id, 'sendAnswer', signal)

  this.emit('signal', signal)
}

SimplerPeer.prototype._onSetRemoteDescription = function () {
  if (this.closed) {
    return
  }

  debug(this.id, 'onSetRemoteDescription')

  if (this.connection.remoteDescription.type === 'offer') {
    this.connection.createAnswer(
      this._onCreateAnswer,
      this._onError
    )
  }
}

SimplerPeer.prototype._onDataChannel = function (evt) {
  if (this.closed) {
    return
  }

  var channel = new DataChannel(evt.channel)

  if (channel.label === 'default' && !this.defaultChannel) {
    this.defaultChannel = channel
    this.defaultChannel.once('open', this._onDefaultChannelOpen)
  }

  debug(this.id, 'onDataChannel', channel)

  this.emit('datachannel', channel)
}

SimplerPeer.prototype._onIceCandidate = function (evt) {
  if (this.closed) {
    return
  }

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
  if (this.closed) {
    return
  }

  debug(this.id, 'statechange', this.state)

  this.emit('statechange', this.state)

  if (this.state === 'connected' ||
      this.state === 'completed') {
    this._onIceComplete()
    this._maybeConnect()
  } else if (this.state === 'disconnected' ||
             this.state === 'failed' ||
             this.state === 'closed') {
    this.close()
  }
}

SimplerPeer.prototype._onIceComplete = function () {
  this.connection.onicecandidate = null

  debug(this.id, 'onIceComplete')

  if (this._initiator) {
    this._sendOffer()
  } else {
    this._sendAnswer()
  }
}

SimplerPeer.prototype._onDefaultChannelOpen = function () {
  if (this.closed) {
    return
  }

  debug(this.id, 'onDefaultChannelOpen')

  this.defaultChannel.on('close', this.close.bind(this))
  this._maybeConnect()
}

SimplerPeer.prototype._maybeConnect = function () {
  if (this.defaultChannel && this.defaultChannel.readyState === 'open') {
    this._maybeConnect = noop

    debug(this.id, 'connect')

    this.emit('connect')
  }
}

SimplerPeer.prototype._onError = function (err) {
  this.emit('error', err)
}

function debug () {
  console.log.apply(console, arguments)
}

function noop () {}
